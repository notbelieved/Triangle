const bs58Pkg = require('bs58')
const bs58 = typeof bs58Pkg.decode === 'function' ? bs58Pkg : bs58Pkg.default
const {
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} = require('@solana/web3.js')
const {
  getProgramId,
  getSolanaConnection,
  escrowPda,
  configPda,
  isEscrowProgramConfigInitialized,
  getEscrowConfigAuthority,
  uuidToDealIdBytes,
  buildInitEscrowIx,
  buildDepositIx,
  buildBuyerReleaseIx,
  buildReleaseIx,
  buildRefundToIx,
  buildSetFrozenIx,
  buildInitializeIx,
  parseEscrowAccountData,
  buildUnsignedTx,
} = require('./escrowProgram.js')

function u8FromNumberArray(arr) {
  if (!Array.isArray(arr) || arr.length < 64) return null
  const u8 = Uint8Array.from(arr)
  try {
    return Keypair.fromSecretKey(u8)
  } catch {
    return null
  }
}

/**
 * Accepts: base58 (64- or 32-byte), 128-char hex, base64 of 64/32 bytes,
 * JSON array [uint8,...], or solana-keygen JSON { "secretKey": [...] } / id.json contents.
 */
function parseAuthorityPrivateKey(raw) {
  if (raw == null) return null
  let s = String(raw).trim().replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim()
  }
  if (!s) return null
  s = s.replace(/[\u200B-\u200D\uFEFF]/g, '')
  s = s.replace(/\\\r?\n/g, '')
  s = s.replace(/\\n/g, '')

  if (s.startsWith('{') || s.startsWith('[')) {
    try {
      const parsed = JSON.parse(s)
      if (Array.isArray(parsed)) {
        const kp = u8FromNumberArray(parsed)
        if (kp) return kp
      } else if (parsed && typeof parsed === 'object') {
        const sk =
          parsed.secretKey ??
          parsed.secret_key ??
          parsed.privateKey ??
          parsed.private_key
        if (Array.isArray(sk)) {
          const kp = u8FromNumberArray(sk)
          if (kp) return kp
        }
      }
    } catch {
      /* fall through */
    }
  }

  const hexCompact = s.replace(/^0x/i, '').replace(/[\s:,-]/g, '')
  if (/^[0-9a-fA-F]+$/.test(hexCompact) && hexCompact.length >= 128) {
    try {
      const b = Buffer.from(hexCompact.slice(0, 128), 'hex')
      if (b.length === 64) return Keypair.fromSecretKey(b)
    } catch {
      /* */
    }
  }

  const b64 = s.replace(/\s/g, '')
  if (/^[A-Za-z0-9+/]+=*$/.test(b64) && b64.length >= 44 && b64.length <= 120) {
    try {
      const b = Buffer.from(b64, 'base64')
      if (b.length === 64) return Keypair.fromSecretKey(b)
      if (b.length === 32) return Keypair.fromSeed(new Uint8Array(b))
    } catch {
      /* */
    }
  }

  const b58 = s.replace(/\s/g, '')
  try {
    const buf = bs58.decode(b58)
    if (buf.length === 64) return Keypair.fromSecretKey(buf)
    if (buf.length === 32) return Keypair.fromSeed(buf)
  } catch {
    /* */
  }

  const comma = s.replace(/\s/g, '')
  if (/^\d+(,\d+)+$/.test(comma)) {
    const arr = comma.split(',').map((x) => Number(x))
    if (arr.length >= 64 && arr.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
      const kp = u8FromNumberArray(arr)
      if (kp) return kp
    }
  }

  return null
}

function authorityKeypair() {
  return parseAuthorityPrivateKey(process.env.SOLANA_AUTHORITY_PRIVATE_KEY)
}

function jsonEscrowConfigNotInitialized(programId, connection) {
  const [cfg] = configPda(programId)
  const out = {
    error:
      'Escrow program `config` account is not initialized on this cluster (Anchor AccountNotInitialized / 3012).',
    code: 'ESCROW_CONFIG_NOT_INITIALIZED',
    configPda: cfg.toBase58(),
    programId: programId.toBase58(),
    hint:
      'On Support page click "Initialize escrow program", or POST /api/support/program/initialize. ' +
      'Authority wallet needs SOL on the same network as SOLANA_RPC_URL (usually devnet).',
  }
  if (connection?.rpcEndpoint) out.rpcEndpoint = connection.rpcEndpoint
  return out
}

async function ensureEscrowConfigInitialized(connection, programId, res) {
  const ok = await isEscrowProgramConfigInitialized(connection, programId)
  if (ok) return true
  res.status(503).json(jsonEscrowConfigNotInitialized(programId, connection))
  return false
}

async function ensureSupportAuthorityMatchesConfig(connection, programId, kp, res) {
  const onChain = await getEscrowConfigAuthority(connection, programId)
  if (!onChain || onChain.equals(kp.publicKey)) return true
  res.status(503).json({
    error:
      'SOLANA_AUTHORITY_PRIVATE_KEY does not match on-chain config.authority (must be the wallet that ran initialize).',
    code: 'ESCROW_AUTHORITY_MISMATCH',
    configAuthority: onChain.toBase58(),
    signerAuthority: kp.publicKey.toBase58(),
  })
  return false
}

function isAnchorConfigNotInitializedMessage(e) {
  const m = String(e?.message || e || '')
  return (
    m.includes('AccountNotInitialized') ||
    m.includes('3012') ||
    m.includes('0xbc4') ||
    m.includes('expected this account to be already initialized')
  )
}

function respondIfConfigNotInitialized(res, e, programId) {
  if (!isAnchorConfigNotInitializedMessage(e)) return false
  res.status(503).json(jsonEscrowConfigNotInitialized(programId, null))
  return true
}

/** Clear message for support escrow routes when env is wrong */
function supportEscrowConfigError() {
  let programId
  try {
    programId = getProgramId()
  } catch {
    return 'TRIANGLE_ESCROW_PROGRAM_ID is not a valid Solana program id (check for typos).'
  }
  if (!programId) {
    return 'TRIANGLE_ESCROW_PROGRAM_ID is missing or empty in server/.env.'
  }
  const raw = process.env.SOLANA_AUTHORITY_PRIVATE_KEY
  if (raw == null || !String(raw).trim()) {
    return 'SOLANA_AUTHORITY_PRIVATE_KEY is empty in server/.env.'
  }
  if (!authorityKeypair()) {
    return (
      'SOLANA_AUTHORITY_PRIVATE_KEY could not be parsed. Use base58 (64-byte secret), 128-char hex, or JSON [uint8,...] length 64+. Strip wrapping quotes.'
    )
  }
  return null
}

function solToLamports(amount) {
  const n = Number(amount)
  if (!Number.isFinite(n) || n <= 0) throw new Error('Invalid SOL amount')
  return BigInt(Math.round(n * 1e9))
}

function registerEscrowRoutes(app, deps) {
  const {
    pool,
    authMiddleware,
    supportRoleMiddleware,
    getUserByPrivyId,
    getDealById,
    UUID_RE,
    normalizeSolanaAddress,
    serializeDeal,
  } = deps

  function assertNotCancelled(deal, res) {
    if (deal.status === 'cancelled') {
      res.status(400).json({ error: 'Deal is cancelled' })
      return false
    }
    return true
  }

  app.get('/api/deals/:id/escrow', authMiddleware, async (req, res) => {
    try {
      if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid deal id' })
      const u = await getUserByPrivyId(req.privyUserId)
      if (!u) return res.status(404).json({ error: 'User not found' })
      const deal = await getDealById(req.params.id)
      if (!deal) return res.status(404).json({ error: 'Deal not found' })
      const isParticipant = deal.creator_user_id === u.id || deal.acceptor_user_id === u.id
      const isSupportView = u.is_support && deal.support_requested
      if (!isParticipant && !isSupportView) {
        return res.status(403).json({ error: 'Not a participant' })
      }

      const programId = getProgramId()
      res.json({
        programConfigured: Boolean(programId),
        programId: programId ? programId.toBase58() : null,
        escrowPda: deal.escrow_pda,
        escrowStatus: deal.escrow_status,
        escrowFrozen: deal.escrow_frozen,
        escrowExpectedLamports: deal.escrow_expected_lamports,
        asset: deal.asset,
        chainNote: null,
      })
    } catch (e) {
      console.error(e)
      res.status(500).json({ error: 'Escrow info failed' })
    }
  })

  app.post('/api/deals/:id/escrow/prepare-init', authMiddleware, async (req, res) => {
    try {
      const programId = getProgramId()
      if (!programId) return res.status(503).json({ error: 'TRIANGLE_ESCROW_PROGRAM_ID not set' })

      if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid deal id' })
      const u = await getUserByPrivyId(req.privyUserId)
      if (!u) return res.status(404).json({ error: 'User not found' })
      const deal = await getDealById(req.params.id)
      if (!deal) return res.status(404).json({ error: 'Deal not found' })
      if (deal.creator_user_id !== u.id) {
        return res.status(403).json({ error: 'Only the deal creator can fund escrow' })
      }
      if (!assertNotCancelled(deal, res)) return
      if (!['accepted', 'disputed'].includes(deal.status) || !deal.acceptor_user_id) {
        return res.status(400).json({ error: 'Deal must be accepted before escrow' })
      }
      if (deal.asset !== 'SOL') {
        return res.status(400).json({ error: 'Program escrow supports SOL only' })
      }
      if (!u.solana_address || !deal.creator_solana_address) {
        return res.status(400).json({ error: 'Creator Solana address required' })
      }
      if (!deal.acceptor_solana_address) {
        return res.status(400).json({ error: 'Seller Solana address required' })
      }

      const buyer = new PublicKey(u.solana_address)
      const seller = new PublicKey(deal.acceptor_solana_address)
      const dealBytes = uuidToDealIdBytes(deal.id)
      const [pdaKey] = escrowPda(programId, dealBytes)
      const expectedLamports = solToLamports(deal.amount)

      const ix = buildInitEscrowIx(programId, buyer, seller, pdaKey, dealBytes, expectedLamports)
      const connection = await getSolanaConnection()
      const built = await buildUnsignedTx(connection, buyer, ix)

      res.json({
        ...built,
        escrowPda: pdaKey.toBase58(),
        expectedLamports: expectedLamports.toString(),
      })
    } catch (e) {
      console.error(e)
      res.status(500).json({ error: e.message || 'prepare-init failed' })
    }
  })

  app.post('/api/deals/:id/escrow/ack-init', authMiddleware, async (req, res) => {
    try {
      const programId = getProgramId()
      if (!programId) return res.status(503).json({ error: 'Program not configured' })
      if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid deal id' })
      const u = await getUserByPrivyId(req.privyUserId)
      if (!u) return res.status(404).json({ error: 'User not found' })
      const deal = await getDealById(req.params.id)
      if (!deal) return res.status(404).json({ error: 'Deal not found' })
      if (deal.creator_user_id !== u.id) return res.status(403).json({ error: 'Forbidden' })
      if (!assertNotCancelled(deal, res)) return

      const sig =
        typeof req.body?.signature === 'string' ? req.body.signature.trim() : ''
      if (!sig) return res.status(400).json({ error: 'signature required' })

      const connection = await getSolanaConnection()
      try {
        await connection.confirmTransaction(sig, 'confirmed')
      } catch (e) {
        return res.status(400).json({ error: 'Transaction not confirmed on chain' })
      }

      const dealBytes = uuidToDealIdBytes(deal.id)
      const [pdaKey] = escrowPda(programId, dealBytes)
      const info = await connection.getAccountInfo(pdaKey)
      if (!info || !info.owner.equals(programId)) {
        return res.status(400).json({ error: 'Escrow PDA not found after transaction' })
      }

      const expectedLamports = solToLamports(deal.amount)
      await pool.query(
        `UPDATE deals SET escrow_pda = $1, escrow_status = 'awaiting_funds',
         escrow_expected_lamports = $2, escrow_frozen = false WHERE id = $3`,
        [pdaKey.toBase58(), expectedLamports.toString(), deal.id],
      )

      const full = await getDealById(deal.id)
      res.json({ ok: true, deal: deps.serializeDeal(full, u.id) })
    } catch (e) {
      console.error(e)
      res.status(500).json({ error: e.message || 'ack-init failed' })
    }
  })

  app.post('/api/deals/:id/escrow/prepare-deposit', authMiddleware, async (req, res) => {
    try {
      const programId = getProgramId()
      if (!programId) return res.status(503).json({ error: 'Program not configured' })
      if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid deal id' })
      const u = await getUserByPrivyId(req.privyUserId)
      if (!u) return res.status(404).json({ error: 'User not found' })
      const deal = await getDealById(req.params.id)
      if (!deal) return res.status(404).json({ error: 'Deal not found' })
      if (deal.creator_user_id !== u.id) return res.status(403).json({ error: 'Forbidden' })
      if (!assertNotCancelled(deal, res)) return
      if (!deal.escrow_pda) return res.status(400).json({ error: 'Escrow not initialized' })
      if (!u.solana_address) return res.status(400).json({ error: 'Solana address required' })

      const buyer = new PublicKey(u.solana_address)
      const escrowKey = new PublicKey(deal.escrow_pda)
      const expectedFromDb = BigInt(deal.escrow_expected_lamports || '0')

      const connection = await getSolanaConnection()
      const info = await connection.getAccountInfo(escrowKey)
      if (!info) return res.status(400).json({ error: 'Escrow account missing on chain' })

      const parsedEarly = parseEscrowAccountData(info.data)
      const expectedOnChain = parsedEarly?.expectedLamports ?? 0n
      const expected = expectedOnChain > 0n ? expectedOnChain : expectedFromDb

      const rent = await connection.getMinimumBalanceForRentExemption(info.data.length)
      const bal = BigInt(info.lamports)
      const spendable = bal - BigInt(rent)
      let remaining = expected > spendable ? expected - spendable : 0n
      if (typeof req.body?.lamports === 'string' || typeof req.body?.lamports === 'number') {
        remaining = BigInt(req.body.lamports)
      }
      const parsed = parsedEarly
      if (parsed?.frozen) {
        return res.status(400).json({ error: 'Escrow is frozen' })
      }
      if (remaining <= 0n) {
        if (parsed && parsed.status === 0 && expected > 0n && spendable >= expected) {
          remaining = 1n
        } else if (!parsed && expected > 0n && spendable >= expected && info.owner.equals(programId)) {
          remaining = 1n
        } else {
          return res.status(400).json({ error: 'Escrow already fully funded' })
        }
      }

      const ix = buildDepositIx(programId, buyer, escrowKey, remaining)
      const built = await buildUnsignedTx(connection, buyer, ix)
      res.json({
        ...built,
        lamports: remaining.toString(),
        escrowPda: deal.escrow_pda,
      })
    } catch (e) {
      console.error(e)
      res.status(500).json({ error: e.message || 'prepare-deposit failed' })
    }
  })

  app.post('/api/deals/:id/escrow/prepare-release', authMiddleware, async (req, res) => {
    try {
      const programId = getProgramId()
      if (!programId) return res.status(503).json({ error: 'Program not configured' })
      if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid deal id' })
      const u = await getUserByPrivyId(req.privyUserId)
      if (!u) return res.status(404).json({ error: 'User not found' })
      const deal = await getDealById(req.params.id)
      if (!deal) return res.status(404).json({ error: 'Deal not found' })
      if (deal.creator_user_id !== u.id) {
        return res.status(403).json({ error: 'Only the deal creator can pay out to the seller' })
      }
      if (!assertNotCancelled(deal, res)) return
      if (deal.status === 'disputed') {
        return res.status(400).json({ error: 'Deal is in dispute — support handles escrow payout' })
      }
      if (!deal.escrow_pda) return res.status(400).json({ error: 'No escrow' })
      if (deal.escrow_frozen) {
        return res.status(400).json({ error: 'Escrow is frozen — support must handle payout or refund' })
      }
      if (!u.solana_address || !deal.acceptor_solana_address) {
        return res.status(400).json({ error: 'Creator and seller Solana addresses required' })
      }

      const connection = await getSolanaConnection()
      const escrowKey = new PublicKey(deal.escrow_pda)
      const info = await connection.getAccountInfo(escrowKey)
      if (!info || !info.owner.equals(programId)) {
        return res.status(400).json({ error: 'Escrow not found on chain' })
      }
      const parsed = parseEscrowAccountData(info.data)
      if (!parsed || parsed.status !== 1) {
        return res.status(400).json({ error: 'Escrow must be fully funded on-chain before payout' })
      }
      if (parsed.frozen) return res.status(400).json({ error: 'Escrow is frozen' })

      const buyer = new PublicKey(u.solana_address)
      const seller = new PublicKey(deal.acceptor_solana_address)
      const ix = buildBuyerReleaseIx(programId, buyer, escrowKey, seller)
      const built = await buildUnsignedTx(connection, buyer, ix)
      res.json({ ...built, escrowPda: deal.escrow_pda })
    } catch (e) {
      console.error(e)
      res.status(500).json({ error: e.message || 'prepare-release failed' })
    }
  })

  app.post('/api/deals/:id/escrow/ack-release', authMiddleware, async (req, res) => {
    try {
      const programId = getProgramId()
      if (!programId) return res.status(503).json({ error: 'Program not configured' })
      if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid deal id' })
      const u = await getUserByPrivyId(req.privyUserId)
      if (!u) return res.status(404).json({ error: 'User not found' })
      const deal = await getDealById(req.params.id)
      if (!deal) return res.status(404).json({ error: 'Deal not found' })
      if (deal.creator_user_id !== u.id) return res.status(403).json({ error: 'Forbidden' })
      if (!assertNotCancelled(deal, res)) return
      if (deal.status === 'disputed') {
        return res.status(400).json({ error: 'Deal is in dispute — support handles escrow payout' })
      }

      const sig = typeof req.body?.signature === 'string' ? req.body.signature.trim() : ''
      if (!sig) return res.status(400).json({ error: 'signature required' })

      const connection = await getSolanaConnection()
      try {
        await connection.confirmTransaction(sig, 'confirmed')
      } catch (e) {
        return res.status(400).json({ error: 'Transaction not confirmed on chain' })
      }

      const escrowKey = new PublicKey(deal.escrow_pda)
      const info = await connection.getAccountInfo(escrowKey)
      if (info) {
        return res.status(400).json({ error: 'Escrow still on-chain — transaction may have failed' })
      }

      await pool.query(
        `UPDATE deals SET escrow_status = 'released', escrow_pda = NULL, escrow_frozen = false WHERE id = $1`,
        [deal.id],
      )
      const full = await getDealById(deal.id)
      res.json({ ok: true, deal: deps.serializeDeal(full, u.id) })
    } catch (e) {
      console.error(e)
      res.status(500).json({ error: e.message || 'ack-release failed' })
    }
  })

  app.post('/api/deals/:id/escrow/sync', authMiddleware, async (req, res) => {
    try {
      const programId = getProgramId()
      if (!programId) return res.status(503).json({ error: 'Program not configured' })
      if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid deal id' })
      const u = await getUserByPrivyId(req.privyUserId)
      if (!u) return res.status(404).json({ error: 'User not found' })
      const deal = await getDealById(req.params.id)
      if (!deal) return res.status(404).json({ error: 'Deal not found' })
      const isParticipant = deal.creator_user_id === u.id || deal.acceptor_user_id === u.id
      const isSupportView = u.is_support && deal.support_requested
      if (!isParticipant && !isSupportView) {
        return res.status(403).json({ error: 'Not a participant' })
      }
      if (!deal.escrow_pda) {
        return res.json({ deal: deps.serializeDeal(deal, u.id), chain: null })
      }

      const connection = await getSolanaConnection()
      const escrowKey = new PublicKey(deal.escrow_pda)
      const info = await connection.getAccountInfo(escrowKey)
      if (!info) {
        const closedAs =
          deal.escrow_status === 'funded' || deal.escrow_status === 'awaiting_confirm'
            ? 'released'
            : 'account_closed'
        await pool.query(
          `UPDATE deals SET escrow_status = $1, escrow_pda = NULL, escrow_frozen = false WHERE id = $2`,
          [closedAs, deal.id],
        )
        const full = await getDealById(deal.id)
        return res.json({ deal: deps.serializeDeal(full, u.id), chain: { exists: false } })
      }

      const parsed = parseEscrowAccountData(info.data)
      const rent = await connection.getMinimumBalanceForRentExemption(info.data.length)
      const spendable = BigInt(info.lamports) - BigInt(rent)
      const expectedFromDb = BigInt(deal.escrow_expected_lamports || '0')
      const expectedOnChain = parsed?.expectedLamports ?? 0n
      const expected =
        expectedOnChain > 0n ? expectedOnChain : expectedFromDb

      let nextStatus = deal.escrow_status
      if (parsed) {
        if (parsed.status === 1) {
          nextStatus = 'funded'
        } else if (expected > 0n && spendable >= expected) {
          nextStatus = 'awaiting_confirm'
        } else if (parsed.status === 0) {
          nextStatus = 'awaiting_funds'
        }
      } else if (info.owner.equals(programId) && expectedFromDb > 0n && spendable >= expectedFromDb) {
        nextStatus = 'awaiting_confirm'
      }

      await pool.query(
        `UPDATE deals SET escrow_status = $1, escrow_frozen = $2 WHERE id = $3`,
        [nextStatus, parsed?.frozen ?? deal.escrow_frozen, deal.id],
      )
      const full = await getDealById(deal.id)
      res.json({
        deal: deps.serializeDeal(full, u.id),
        chain: {
          exists: true,
          lamports: info.lamports,
          spendableLamports: spendable.toString(),
          expectedLamports: expected.toString(),
          accountDataLen: info.data?.length ?? 0,
          parsed: Boolean(parsed),
          onChainStatus: parsed?.status,
          frozen: parsed?.frozen ?? false,
        },
      })
    } catch (e) {
      console.error(e)
      res.status(500).json({ error: e.message || 'sync failed' })
    }
  })

  app.get('/api/support/deals', authMiddleware, supportRoleMiddleware, async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT d.*,
                c.solana_address AS creator_solana_address,
                a.solana_address AS acceptor_solana_address
         FROM deals d
         JOIN users c ON c.id = d.creator_user_id
         LEFT JOIN users a ON a.id = d.acceptor_user_id
         WHERE d.support_requested = true
         ORDER BY d.created_at DESC
         LIMIT 200`,
      )
      const uid = req.supportUser.id
      res.json({ deals: r.rows.map((row) => serializeDeal(row, uid)) })
    } catch (e) {
      console.error(e)
      res.status(500).json({ error: 'Could not list deals' })
    }
  })

  app.post('/api/support/escrow/release', authMiddleware, supportRoleMiddleware, async (req, res) => {
    try {
      const cfgErr = supportEscrowConfigError()
      if (cfgErr) return res.status(503).json({ error: cfgErr })
      const programId = getProgramId()
      const kp = authorityKeypair()
      const dealId = typeof req.body?.dealId === 'string' ? req.body.dealId : ''
      if (!UUID_RE.test(dealId)) return res.status(400).json({ error: 'Invalid dealId' })

      const deal = await getDealById(dealId)
      if (!deal) return res.status(404).json({ error: 'Deal not found' })
      if (!deal.support_requested) {
        return res.status(403).json({ error: 'Support was not requested for this deal' })
      }
      if (!deal.escrow_pda) return res.status(400).json({ error: 'No escrow for deal' })
      if (!deal.acceptor_solana_address) {
        return res.status(400).json({ error: 'Seller has no Solana address' })
      }

      const connection = await getSolanaConnection()
      if (!(await ensureEscrowConfigInitialized(connection, programId, res))) return
      if (!(await ensureSupportAuthorityMatchesConfig(connection, programId, kp, res))) return
      const [cfg] = configPda(programId)
      const escrowKey = new PublicKey(deal.escrow_pda)
      const seller = new PublicKey(deal.acceptor_solana_address)

      const ix = buildReleaseIx(programId, kp.publicKey, cfg, escrowKey, seller)
      const tx = new Transaction().add(ix)
      const sig = await sendAndConfirmTransaction(connection, tx, [kp], {
        commitment: 'confirmed',
      })

      await pool.query(
        `UPDATE deals SET escrow_status = 'released', escrow_pda = NULL, escrow_frozen = false WHERE id = $1`,
        [dealId],
      )
      res.json({ ok: true, signature: sig })
    } catch (e) {
      console.error(e)
      if (respondIfConfigNotInitialized(res, e, getProgramId())) return
      res.status(500).json({ error: e.message || 'release failed' })
    }
  })

  app.post('/api/support/escrow/refund', authMiddleware, supportRoleMiddleware, async (req, res) => {
    try {
      const cfgErr = supportEscrowConfigError()
      if (cfgErr) return res.status(503).json({ error: cfgErr })
      const programId = getProgramId()
      const kp = authorityKeypair()
      const dealId = typeof req.body?.dealId === 'string' ? req.body.dealId : ''
      const recipientRaw = typeof req.body?.recipient === 'string' ? req.body.recipient.trim() : ''
      if (!UUID_RE.test(dealId)) return res.status(400).json({ error: 'Invalid dealId' })
      const recipient = normalizeSolanaAddress(recipientRaw)
      if (!recipient) return res.status(400).json({ error: 'Invalid recipient' })

      const deal = await getDealById(dealId)
      if (!deal) return res.status(404).json({ error: 'Deal not found' })
      if (!deal.support_requested) {
        return res.status(403).json({ error: 'Support was not requested for this deal' })
      }
      if (!deal.escrow_pda) return res.status(400).json({ error: 'No escrow for deal' })
      if (!deal.escrow_frozen) {
        return res.status(400).json({ error: 'Escrow must be frozen before refund' })
      }

      const connection = await getSolanaConnection()
      if (!(await ensureEscrowConfigInitialized(connection, programId, res))) return
      if (!(await ensureSupportAuthorityMatchesConfig(connection, programId, kp, res))) return
      const [cfg] = configPda(programId)
      const escrowKey = new PublicKey(deal.escrow_pda)
      const recv = new PublicKey(recipient)

      const ix = buildRefundToIx(programId, kp.publicKey, cfg, escrowKey, recv)
      const tx = new Transaction().add(ix)
      const sig = await sendAndConfirmTransaction(connection, tx, [kp], {
        commitment: 'confirmed',
      })

      await pool.query(
        `UPDATE deals SET escrow_status = 'refunded', escrow_pda = NULL, escrow_frozen = false WHERE id = $1`,
        [dealId],
      )
      res.json({ ok: true, signature: sig })
    } catch (e) {
      console.error(e)
      if (respondIfConfigNotInitialized(res, e, getProgramId())) return
      res.status(500).json({ error: e.message || 'refund failed' })
    }
  })

  app.post('/api/support/escrow/freeze', authMiddleware, supportRoleMiddleware, async (req, res) => {
    try {
      const cfgErr = supportEscrowConfigError()
      if (cfgErr) return res.status(503).json({ error: cfgErr })
      const programId = getProgramId()
      const kp = authorityKeypair()
      const dealId = typeof req.body?.dealId === 'string' ? req.body.dealId : ''
      const frozen = Boolean(req.body?.frozen)
      if (!UUID_RE.test(dealId)) return res.status(400).json({ error: 'Invalid dealId' })

      const deal = await getDealById(dealId)
      if (!deal) return res.status(404).json({ error: 'Deal not found' })
      if (!deal.support_requested) {
        return res.status(403).json({ error: 'Support was not requested for this deal' })
      }
      if (!deal.escrow_pda) return res.status(400).json({ error: 'No escrow for deal' })

      const connection = await getSolanaConnection()
      if (!(await ensureEscrowConfigInitialized(connection, programId, res))) return
      if (!(await ensureSupportAuthorityMatchesConfig(connection, programId, kp, res))) return
      const [cfg] = configPda(programId)
      const dealBytes = uuidToDealIdBytes(dealId)
      const [escrowKey] = escrowPda(programId, dealBytes)
      if (escrowKey.toBase58() !== deal.escrow_pda) {
        return res.status(400).json({ error: 'Escrow PDA mismatch' })
      }

      const ix = buildSetFrozenIx(programId, kp.publicKey, cfg, escrowKey, dealBytes, frozen)
      const tx = new Transaction().add(ix)
      const sig = await sendAndConfirmTransaction(connection, tx, [kp], {
        commitment: 'confirmed',
      })

      await pool.query(`UPDATE deals SET escrow_frozen = $1 WHERE id = $2`, [frozen, dealId])
      res.json({ ok: true, signature: sig, frozen })
    } catch (e) {
      console.error(e)
      if (respondIfConfigNotInitialized(res, e, getProgramId())) return
      res.status(500).json({ error: e.message || 'freeze failed' })
    }
  })

  app.get('/api/support/program/status', authMiddleware, supportRoleMiddleware, async (_req, res) => {
    try {
      const cfgErr = supportEscrowConfigError()
      if (cfgErr) return res.status(503).json({ error: cfgErr })
      const programId = getProgramId()
      const connection = await getSolanaConnection()
      const [cfg] = configPda(programId)
      const configInitialized = await isEscrowProgramConfigInitialized(connection, programId)
      const configAuthority = configInitialized
        ? (await getEscrowConfigAuthority(connection, programId))?.toBase58() ?? null
        : null
      res.json({
        programId: programId.toBase58(),
        configPda: cfg.toBase58(),
        configInitialized,
        configAuthority,
        rpcEndpoint: connection.rpcEndpoint,
      })
    } catch (e) {
      console.error(e)
      res.status(500).json({ error: e.message || 'status failed' })
    }
  })

  app.post('/api/support/program/initialize', authMiddleware, supportRoleMiddleware, async (_req, res) => {
    try {
      const cfgErr = supportEscrowConfigError()
      if (cfgErr) return res.status(503).json({ error: cfgErr })
      const programId = getProgramId()
      const kp = authorityKeypair()
      const connection = await getSolanaConnection()
      const [cfg] = configPda(programId)
      if (await isEscrowProgramConfigInitialized(connection, programId)) {
        return res.json({
          ok: true,
          alreadyInitialized: true,
          configPda: cfg.toBase58(),
          rpcEndpoint: connection.rpcEndpoint,
        })
      }
      const ix = buildInitializeIx(programId, kp.publicKey, cfg)
      const tx = new Transaction().add(ix)
      const sig = await sendAndConfirmTransaction(connection, tx, [kp], {
        commitment: 'confirmed',
      })
      res.json({
        ok: true,
        signature: sig,
        configPda: cfg.toBase58(),
        rpcEndpoint: connection.rpcEndpoint,
      })
    } catch (e) {
      console.error(e)
      res.status(500).json({ error: e.message || 'initialize failed (maybe already initialized)' })
    }
  })
}

module.exports = { registerEscrowRoutes }
