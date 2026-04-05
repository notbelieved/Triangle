const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '.env') })

const express = require('express')
const cors = require('cors')
const { PrivyClient } = require('@privy-io/node')
const { pool, initDb } = require('./db')

const appId = process.env.PRIVY_APP_ID
const appSecret = process.env.PRIVY_APP_SECRET
const port = Number(process.env.PORT || 3001)

const DEAL_NETWORK = 'solana-devnet'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,48}$/

if (!appId || !appSecret) {
  console.error('Set PRIVY_APP_ID and PRIVY_APP_SECRET in server/.env')
  process.exit(1)
}

const privy = new PrivyClient({ appId, appSecret })

const { registerEscrowRoutes } = require('./escrowApi')
const { getProgramId } = require('./escrowProgram.js')

function shortenSolanaAddress(addr) {
  if (!addr || typeof addr !== 'string') return '—'
  if (addr.length <= 12) return addr
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`
}

function normalizeSolanaAddress(v) {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s) return null
  if (!SOLANA_ADDRESS_RE.test(s)) return null
  return s
}

function participantFromUserRow(row) {
  if (!row?.id) return null
  const addr = row.solana_address
  if (!addr) return { id: row.id, label: '—', address: null }
  return { id: row.id, label: shortenSolanaAddress(addr), address: addr }
}

async function authMiddleware(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Bearer access token required' })
  }
  const token = header.slice(7)
  try {
    const { user_id } = await privy.utils().auth().verifyAccessToken(token)
    req.privyUserId = user_id
    next()
  } catch (e) {
    console.warn('Privy verify:', e.message)
    return res.status(401).json({ error: 'Invalid token' })
  }
}

async function upsertUser(privyUserId, email) {
  const r = await pool.query(
    `INSERT INTO users (privy_user_id, email)
     VALUES ($1, $2)
     ON CONFLICT (privy_user_id) DO UPDATE SET
       email = COALESCE(EXCLUDED.email, users.email)
     RETURNING id, privy_user_id, email, solana_address, created_at`,
    [privyUserId, email || null],
  )
  return r.rows[0]
}

async function setUserSolanaAddress(privyUserId, addressOrNull) {
  await pool.query(`UPDATE users SET solana_address = $1 WHERE privy_user_id = $2`, [
    addressOrNull,
    privyUserId,
  ])
}

const SUPPORT_ADDRESSES = new Set([
  'ENEjvWTjFnATyGsfh21AgbLvwrRukh6A7LsowoPEucF7',
  '5VGAtw57Y7N9ovaPqA1vjhjSKRT5EyzSgyivgg3jc4HM',
])

function serializeUserSelf(row) {
  if (!row) return null
  return {
    id: row.id,
    email: row.email,
    solana_address: row.solana_address,
    solana_label: row.solana_address ? shortenSolanaAddress(row.solana_address) : null,
    is_support: Boolean(row.is_support),
  }
}

async function getUserByPrivyId(privyUserId) {
  const r = await pool.query('SELECT * FROM users WHERE privy_user_id = $1', [privyUserId])
  return r.rows[0] || null
}

async function supportRoleMiddleware(req, res, next) {
  try {
    const u = await getUserByPrivyId(req.privyUserId)
    if (!u) return res.status(404).json({ error: 'User not found' })
    if (!u.is_support) return res.status(403).json({ error: 'Support access required' })
    req.supportUser = u
    next()
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Support check failed' })
  }
}

async function getDealById(dealId) {
  const r = await pool.query(
    `SELECT d.*,
            c.solana_address AS creator_solana_address,
            a.solana_address AS acceptor_solana_address
     FROM deals d
     JOIN users c ON c.id = d.creator_user_id
     LEFT JOIN users a ON a.id = d.acceptor_user_id
     WHERE d.id = $1`,
    [dealId],
  )
  return r.rows[0] || null
}

function dealRole(deal, userId) {
  if (!deal || !userId) return 'viewer'
  if (deal.creator_user_id === userId) return 'creator'
  if (deal.acceptor_user_id === userId) return 'seller'
  return 'viewer'
}

function serializeDeal(deal, currentUserId) {
  if (!deal) return null
  const programId = getProgramId()
  const creator = participantFromUserRow({
    id: deal.creator_user_id,
    solana_address: deal.creator_solana_address,
  })
  const seller = deal.acceptor_user_id
    ? participantFromUserRow({
        id: deal.acceptor_user_id,
        solana_address: deal.acceptor_solana_address,
      })
    : null
  return {
    id: deal.id,
    amount: deal.amount,
    asset: deal.asset,
    currency: deal.currency,
    network: deal.network,
    status: deal.status,
    support_requested: Boolean(deal.support_requested),
    created_at: deal.created_at,
    escrow_pda: deal.escrow_pda || null,
    escrow_status: deal.escrow_status || null,
    escrow_frozen: Boolean(deal.escrow_frozen),
    escrow_expected_lamports: deal.escrow_expected_lamports || null,
    escrow_program_configured: Boolean(programId),
    escrow_program_id: programId ? programId.toBase58() : null,
    creator,
    seller,
    role: dealRole(deal, currentUserId),
  }
}

const app = express()
app.use(cors({ origin: true }))
app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.post('/api/auth/sync', authMiddleware, async (req, res) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim() || null : null
    await upsertUser(req.privyUserId, email)

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'solana_address')) {
      const raw = req.body.solana_address
      const norm =
        raw == null || raw === ''
          ? null
          : normalizeSolanaAddress(typeof raw === 'string' ? raw : String(raw))
      if (raw != null && raw !== '' && !norm) {
        return res.status(400).json({ error: 'Invalid Solana address' })
      }
      await setUserSolanaAddress(req.privyUserId, norm)
    }

    const user = await getUserByPrivyId(req.privyUserId)

    if (user?.solana_address && SUPPORT_ADDRESSES.has(user.solana_address) && !user.is_support) {
      await pool.query(`UPDATE users SET is_support = true WHERE id = $1`, [user.id])
      user.is_support = true
    }

    res.json({ user: serializeUserSelf(user) })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Sync failed' })
  }
})

app.get('/api/deals', authMiddleware, async (req, res) => {
  try {
    const u = await getUserByPrivyId(req.privyUserId)
    if (!u) return res.status(404).json({ error: 'User not found' })
    const r = await pool.query(
      `SELECT d.*,
              c.solana_address AS creator_solana_address,
              a.solana_address AS acceptor_solana_address
       FROM deals d
       JOIN users c ON c.id = d.creator_user_id
       LEFT JOIN users a ON a.id = d.acceptor_user_id
       ORDER BY d.created_at DESC`,
    )
    res.json({
      deals: r.rows.map((row) => serializeDeal(row, u.id)),
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Database error' })
  }
})

app.post('/api/deals/:id/request-support', authMiddleware, async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid deal id' })
    const u = await getUserByPrivyId(req.privyUserId)
    if (!u) return res.status(404).json({ error: 'User not found' })
    const deal = await getDealById(req.params.id)
    if (!deal) return res.status(404).json({ error: 'Deal not found' })
    if (deal.creator_user_id !== u.id && deal.acceptor_user_id !== u.id) {
      return res.status(403).json({ error: 'Not a participant' })
    }
    await pool.query(`UPDATE deals SET support_requested = true WHERE id = $1`, [req.params.id])
    const updated = await getDealById(req.params.id)
    res.json({ deal: serializeDeal(updated, u.id) })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Database error' })
  }
})

app.get('/api/deals/:id', authMiddleware, async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid deal id' })
    const u = await getUserByPrivyId(req.privyUserId)
    if (!u) return res.status(404).json({ error: 'User not found' })
    const deal = await getDealById(req.params.id)
    if (!deal) return res.status(404).json({ error: 'Deal not found' })
    res.json({ deal: serializeDeal(deal, u.id) })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Database error' })
  }
})

app.post('/api/deals', authMiddleware, async (req, res) => {
  try {
    const network =
      typeof req.body?.network === 'string' ? req.body.network.trim() : DEAL_NETWORK
    if (network !== DEAL_NETWORK) {
      return res.status(400).json({ error: 'Only Solana Devnet is supported' })
    }

    const assetRaw =
      typeof req.body?.asset === 'string' && req.body.asset.trim()
        ? req.body.asset.trim().toUpperCase()
        : 'SOL'
    if (assetRaw !== 'SOL') {
      return res.status(400).json({ error: 'Asset must be SOL' })
    }

    let amount = null
    if (req.body?.amount != null && req.body.amount !== '') {
      const n = Number(req.body.amount)
      if (Number.isFinite(n) && n > 0) amount = n
      else return res.status(400).json({ error: 'Amount must be a positive number' })
    } else {
      return res.status(400).json({ error: 'Amount is required' })
    }

    const u = await upsertUser(req.privyUserId, null)
    const ins = await pool.query(
      `INSERT INTO deals (creator_user_id, amount, currency, network, asset, status)
       VALUES ($1, $2, $3, $4, $5, 'open')
       RETURNING id, creator_user_id, acceptor_user_id, amount, currency, network, asset, status, created_at`,
      [u.id, amount, assetRaw, DEAL_NETWORK, assetRaw],
    )
    const full = await getDealById(ins.rows[0].id)
    res.status(201).json({ deal: serializeDeal(full, u.id) })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not create deal' })
  }
})

app.post('/api/deals/:id/accept', authMiddleware, async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid deal id' })
    const u = await getUserByPrivyId(req.privyUserId)
    if (!u) return res.status(404).json({ error: 'User not found' })

    const deal = await getDealById(req.params.id)
    if (!deal) return res.status(404).json({ error: 'Deal not found' })
    if (deal.status === 'cancelled') {
      return res.status(400).json({ error: 'Deal is cancelled' })
    }
    if (deal.status !== 'open' || deal.acceptor_user_id) {
      return res.status(400).json({ error: 'Deal is not open for acceptance' })
    }
    if (deal.creator_user_id === u.id) {
      return res.status(400).json({ error: 'You cannot accept your own deal' })
    }

    const upd = await pool.query(
      `UPDATE deals SET acceptor_user_id = $1, status = 'accepted'
       WHERE id = $2 AND status = 'open' AND acceptor_user_id IS NULL
       RETURNING id`,
      [u.id, req.params.id],
    )
    if (upd.rowCount === 0) {
      return res.status(409).json({ error: 'Deal was already accepted' })
    }

    const full = await getDealById(req.params.id)
    res.json({ deal: serializeDeal(full, u.id) })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not accept deal' })
  }
})

app.get('/api/deals/:id/messages', authMiddleware, async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid deal id' })
    const u = await getUserByPrivyId(req.privyUserId)
    if (!u) return res.status(404).json({ error: 'User not found' })

    const deal = await getDealById(req.params.id)
    if (!deal) return res.status(404).json({ error: 'Deal not found' })
    if (!deal.acceptor_user_id) {
      return res.status(403).json({ error: 'Chat is available after the deal is accepted' })
    }
    const isParticipant = deal.creator_user_id === u.id || deal.acceptor_user_id === u.id
    const isSupportChat = u.is_support && deal.support_requested
    if (!isParticipant && !isSupportChat) {
      return res.status(403).json({ error: 'Not a participant' })
    }

    const r = await pool.query(
      `SELECT m.id, m.body, m.created_at, m.author_user_id, u.solana_address AS author_solana_address,
              COALESCE(u.is_support, false) AS author_is_support
       FROM deal_messages m
       JOIN users u ON u.id = m.author_user_id
       WHERE m.deal_id = $1
       ORDER BY m.created_at ASC`,
      [req.params.id],
    )
    res.json({
      messages: r.rows.map((m) => ({
        id: m.id,
        body: m.body,
        created_at: m.created_at,
        author: participantFromUserRow({
          id: m.author_user_id,
          solana_address: m.author_solana_address,
        }),
        author_is_support: Boolean(m.author_is_support),
        is_me: m.author_user_id === u.id,
      })),
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not load messages' })
  }
})

app.post('/api/deals/:id/messages', authMiddleware, async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid deal id' })
    const u = await getUserByPrivyId(req.privyUserId)
    if (!u) return res.status(404).json({ error: 'User not found' })

    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : ''
    if (!body) return res.status(400).json({ error: 'Message cannot be empty' })
    if (body.length > 4000) return res.status(400).json({ error: 'Message too long' })

    const deal = await getDealById(req.params.id)
    if (!deal) return res.status(404).json({ error: 'Deal not found' })
    if (deal.status === 'cancelled') {
      return res.status(400).json({ error: 'Chat is closed for cancelled deals' })
    }
    if (!deal.acceptor_user_id) {
      return res.status(403).json({ error: 'Chat is available after the deal is accepted' })
    }
    const isParticipant = deal.creator_user_id === u.id || deal.acceptor_user_id === u.id
    const isSupportChat = u.is_support && deal.support_requested
    if (!isParticipant && !isSupportChat) {
      return res.status(403).json({ error: 'Not a participant' })
    }

    const ins = await pool.query(
      `INSERT INTO deal_messages (deal_id, author_user_id, body)
       VALUES ($1, $2, $3)
       RETURNING id, body, created_at, author_user_id`,
      [req.params.id, u.id, body],
    )
    const row = ins.rows[0]
    res.status(201).json({
      message: {
        id: row.id,
        body: row.body,
        created_at: row.created_at,
        author: participantFromUserRow(u),
        author_is_support: Boolean(u.is_support),
        is_me: true,
      },
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not send message' })
  }
})

app.post('/api/support/deals/:id/status', authMiddleware, supportRoleMiddleware, async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid deal id' })
    const next = typeof req.body?.status === 'string' ? req.body.status.trim().toLowerCase() : ''
    const allowed = new Set(['cancelled', 'disputed', 'accepted'])
    if (!allowed.has(next)) {
      return res.status(400).json({ error: 'Invalid status (use cancelled, disputed, or accepted)' })
    }
    const deal = await getDealById(req.params.id)
    if (!deal) return res.status(404).json({ error: 'Deal not found' })
    if (!deal.support_requested) {
      return res.status(403).json({ error: 'Support was not requested for this deal' })
    }
    const cur = deal.status
    if (next === 'disputed') {
      if (cur !== 'accepted') {
        return res.status(400).json({ error: 'Can only mark as disputed from accepted' })
      }
    } else if (next === 'accepted') {
      if (cur !== 'disputed') {
        return res.status(400).json({ error: 'Can only restore accepted from disputed' })
      }
    } else if (next === 'cancelled') {
      if (!['open', 'accepted', 'disputed'].includes(cur)) {
        return res.status(400).json({ error: 'Cannot cancel from this status' })
      }
    }
    await pool.query(`UPDATE deals SET status = $1 WHERE id = $2`, [next, req.params.id])
    const supportUser = req.supportUser
    const full = await getDealById(req.params.id)
    res.json({ deal: serializeDeal(full, supportUser.id) })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not update status' })
  }
})

registerEscrowRoutes(app, {
  pool,
  authMiddleware,
  supportRoleMiddleware,
  getUserByPrivyId,
  getDealById,
  UUID_RE,
  normalizeSolanaAddress,
  serializeDeal,
})

function logDbError(err) {
  console.error('PostgreSQL: connection or schema failed.')
  if (err?.name === 'AggregateError' && Array.isArray(err.errors)) {
    err.errors.forEach((e, i) => console.error(`  [${i}]`, e?.message || e))
  } else {
    console.error(err?.message || err)
  }
  if (err?.code) console.error('code:', err.code)
  if (err?.cause) console.error('cause:', err.cause)
  console.error(
    '\nEnsure PostgreSQL is running and DATABASE_URL in server/.env is correct (try 127.0.0.1).\n',
  )
}

initDb()
  .then(() => {
    app.listen(port, () => {
      console.log(`API http://localhost:${port}`)
    })
  })
  .catch((err) => {
    logDbError(err)
    process.exit(1)
  })
