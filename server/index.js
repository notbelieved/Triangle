const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });


{
  const orig = console.warn;
  console.warn = (...args) => {
    const s = typeof args[0] === 'string' ? args[0] : '';
    if (s.includes('bigint: Failed to load bindings')) return;
    orig.apply(console, args);
  };
}

const express = require('express');
const cors = require('cors');
const { PrivyClient } = require('@privy-io/node');
const { pool, initDb } = require('./db');
const { fetchPythHermesUsdE6, normalizeFeedHex } = require('./rwaOracle.js');

const appId = process.env.PRIVY_APP_ID;
const appSecret = process.env.PRIVY_APP_SECRET;
const port = Number(process.env.PORT || 3001);

const DEAL_NETWORK = 'solana-devnet';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,48}$/;
const SOLANA_TX_SIG_RE = /^[1-9A-HJ-NP-Za-km-z]{64,120}$/;

if (!appId || !appSecret) {
  console.error('Set PRIVY_APP_ID and PRIVY_APP_SECRET in server/.env');
  process.exit(1);
}

const privy = new PrivyClient({ appId, appSecret });

const { registerEscrowRoutes } = require('./escrowApi');
const { registerActionsRoutes } = require('./actionsApi.js');
const { getProgramId } = require('./escrowProgram.js');

function shortenSolanaAddress(addr) {
  if (!addr || typeof addr !== 'string') return '—';
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function normalizeSolanaAddress(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  if (!SOLANA_ADDRESS_RE.test(s)) return null;
  return s;
}

function participantFromUserRow(row) {
  if (!row?.id) return null;
  const addr = row.solana_address;
  if (!addr) return { id: row.id, label: '—', address: null };
  return { id: row.id, label: shortenSolanaAddress(addr), address: addr };
}

async function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Bearer access token required' });
  }
  const token = header.slice(7);
  try {
    const { user_id } = await privy.utils().auth().verifyAccessToken(token);
    req.privyUserId = user_id;
    next();
  } catch (e) {
    console.warn('Privy verify:', e.message);
    return res.status(401).json({ error: 'Invalid token' });
  }
}

async function upsertUser(privyUserId, email) {
  const r = await pool.query(
    `INSERT INTO users (privy_user_id, email)
     VALUES ($1, $2)
     ON CONFLICT (privy_user_id) DO UPDATE SET
       email = COALESCE(EXCLUDED.email, users.email)
     RETURNING id, privy_user_id, email, solana_address, created_at`,
    [privyUserId, email || null]
  );
  return r.rows[0];
}

async function setUserSolanaAddress(privyUserId, addressOrNull) {
  await pool.query(`UPDATE users SET solana_address = $1 WHERE privy_user_id = $2`, [
  addressOrNull,
  privyUserId]
  );
}

const SUPPORT_ADDRESSES = new Set([
'ENEjvWTjFnATyGsfh21AgbLvwrRukh6A7LsowoPEucF7',
'5VGAtw57Y7N9ovaPqA1vjhjSKRT5EyzSgyivgg3jc4HM']
);

function serializeUserSelf(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    solana_address: row.solana_address,
    solana_label: row.solana_address ? shortenSolanaAddress(row.solana_address) : null,
    is_support: Boolean(row.is_support)
  };
}

async function getUserByPrivyId(privyUserId) {
  const r = await pool.query('SELECT * FROM users WHERE privy_user_id = $1', [privyUserId]);
  return r.rows[0] || null;
}

async function supportRoleMiddleware(req, res, next) {
  try {
    const u = await getUserByPrivyId(req.privyUserId);
    if (!u) return res.status(404).json({ error: 'User not found' });
    if (!u.is_support) return res.status(403).json({ error: 'Support access required' });
    req.supportUser = u;
    next();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Support check failed' });
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
    [dealId]
  );
  return r.rows[0] || null;
}

function dealRole(deal, userId) {
  if (!deal || !userId) return 'viewer';
  if (deal.creator_user_id === userId) return 'creator';
  if (deal.acceptor_user_id === userId) return 'seller';
  return 'viewer';
}

function serializeLabToken(row) {
  if (!row) return null;
  return {
    id: row.id,
    mint: row.mint,
    signature: row.signature,
    displayName: row.display_name,
    symbol: row.symbol,
    decimals: Number(row.decimals),
    cluster: row.cluster,
    ata: row.ata,
    supplyRaw: row.supply_raw,
    createdAt: row.created_at,
    metadataUri: row.metadata_uri,
    metadataImageUrl: row.metadata_image_url,
    metadataPriceNote: row.metadata_price_note,
    pythFeedHex: row.metadata_pyth_feed_hex ?? null
  };
}

function serializeDeal(deal, currentUserId) {
  if (!deal) return null;
  const programId = getProgramId();
  const creator = participantFromUserRow({
    id: deal.creator_user_id,
    solana_address: deal.creator_solana_address
  });
  const seller = deal.acceptor_user_id ?
  participantFromUserRow({
    id: deal.acceptor_user_id,
    solana_address: deal.acceptor_solana_address
  }) :
  null;
  return {
    id: deal.id,
    amount: deal.amount,
    asset: deal.asset,
    currency: deal.currency,
    network: deal.network,
    status: deal.status,
    support_requested: Boolean(deal.support_requested),
    created_at: deal.created_at,
    escrow_kind: deal.escrow_kind || 'sol',
    escrow_pda: deal.escrow_pda || null,
    escrow_status: deal.escrow_status || null,
    escrow_frozen: Boolean(deal.escrow_frozen),
    escrow_expected_lamports: deal.escrow_expected_lamports || null,
    escrow_program_configured: Boolean(programId),
    escrow_program_id: programId ? programId.toBase58() : null,

    rwa_mint: deal.rwa_mint || null,
    rwa_oracle_mode: deal.rwa_oracle_mode || null,
    rwa_pyth_feed_hex: deal.rwa_pyth_feed_hex || null,
    rwa_expected_tokens_raw: deal.rwa_expected_tokens_raw || null,
    rwa_deposited_raw: deal.rwa_deposited_raw || null,
    rwa_initial_price_usd_e6: deal.rwa_initial_price_usd_e6 || null,
    rwa_escrow_pda: deal.rwa_escrow_pda || null,
    rwa_vault_ata: deal.rwa_vault_ata || null,
    rwa_health: deal.rwa_health || 'ok',
    rwa_notional_usd_e6: deal.rwa_notional_usd_e6 || null,
    rwa_collateral_decimals: deal.rwa_collateral_decimals != null ? Number(deal.rwa_collateral_decimals) : 6,
    rwa_collateral_ratio_bps: deal.rwa_collateral_ratio_bps != null ? Number(deal.rwa_collateral_ratio_bps) : 11000,

    sol_paid_lamports: deal.sol_paid_lamports != null ? String(deal.sol_paid_lamports) : '0',
    payment_deadline: deal.payment_deadline || null,
    payment_defaulted: Boolean(deal.payment_defaulted),
    payment_deadline_minutes: deal.payment_deadline_minutes != null ? Number(deal.payment_deadline_minutes) : 2,
    creator,
    seller,
    role: dealRole(deal, currentUserId)
  };
}

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});


app.get('/api/rwa-price', async (req, res) => {
  try {
    const feedHex = typeof req.query.feed === 'string' ? req.query.feed.trim() : '';
    const norm = normalizeFeedHex(feedHex);
    if (!norm) return res.status(400).json({ error: 'feed query param must be 64 hex chars (Pyth feed id)' });
    const data = await fetchPythHermesUsdE6(norm);
    res.setHeader('Cache-Control', 'public, max-age=15');
    res.json({
      priceUsdE6: data.priceUsdE6,
      priceUsd: data.priceUsdE6 / 1e6,
      publishTime: data.publishTime,
      feedHex: norm
    });
  } catch (e) {
    res.status(502).json({ error: e.message || 'Could not fetch Pyth price' });
  }
});

app.post('/api/auth/sync', authMiddleware, async (req, res) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim() || null : null;
    await upsertUser(req.privyUserId, email);

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'solana_address')) {
      const raw = req.body.solana_address;
      const norm =
      raw == null || raw === '' ?
      null :
      normalizeSolanaAddress(typeof raw === 'string' ? raw : String(raw));
      if (raw != null && raw !== '' && !norm) {
        return res.status(400).json({ error: 'Invalid Solana address' });
      }
      await setUserSolanaAddress(req.privyUserId, norm);
    }

    const user = await getUserByPrivyId(req.privyUserId);

    if (user?.solana_address && SUPPORT_ADDRESSES.has(user.solana_address) && !user.is_support) {
      await pool.query(`UPDATE users SET is_support = true WHERE id = $1`, [user.id]);
      user.is_support = true;
    }

    res.json({ user: serializeUserSelf(user) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Sync failed' });
  }
});

app.get('/api/deals', authMiddleware, async (req, res) => {
  try {
    const u = await getUserByPrivyId(req.privyUserId);
    if (!u) return res.status(404).json({ error: 'User not found' });
    const r = await pool.query(
      `SELECT d.*,
              c.solana_address AS creator_solana_address,
              a.solana_address AS acceptor_solana_address
       FROM deals d
       JOIN users c ON c.id = d.creator_user_id
       LEFT JOIN users a ON a.id = d.acceptor_user_id
       ORDER BY d.created_at DESC`
    );
    res.json({
      deals: r.rows.map((row) => serializeDeal(row, u.id))
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Database error' });
  }
});


app.get('/api/p/t/:mint', async (req, res) => {
  try {
    const mint = normalizeSolanaAddress(
      typeof req.params.mint === 'string' ? req.params.mint : ''
    );
    if (!mint) return res.status(400).json({ error: 'Invalid mint' });

    res.setHeader('Access-Control-Allow-Origin', '*');

    const r = await pool.query(
      `SELECT display_name, symbol, image_url, price_note, pyth_feed_hex FROM public_lab_token_meta WHERE mint = $1`,
      [mint]
    );
    if (r.rowCount === 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    const row = r.rows[0];
    const name = row.display_name && String(row.display_name).trim() || 'Token';
    const symbol = row.symbol && String(row.symbol).trim().toUpperCase() || '?';
    const doc = { name: name.slice(0, 32), symbol: symbol.slice(0, 10) };
    const img = row.image_url && String(row.image_url).trim();
    if (img) doc.image = img;

    const feedHex = row.pyth_feed_hex && String(row.pyth_feed_hex).trim();
    let pythLine = '';
    if (feedHex) {
      try {
        const { priceUsdE6 } = await fetchPythHermesUsdE6(feedHex);
        const usd = priceUsdE6 / 1e6;
        const s = usd.toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 6
        });
        pythLine = `Pyth oracle ~$${s} USD (ref only, not this token’s market)`;
      } catch {
        pythLine = 'Pyth price unavailable';
      }
      res.setHeader('Cache-Control', 'public, max-age=45');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=120');
    }

    const note = row.price_note && String(row.price_note).trim();
    let description = '';
    if (pythLine && note) description = `${pythLine} · ${note}`;else
    if (pythLine) description = pythLine;else
    if (note) description = `Reference price (not on-chain / not a market): ${note}`;
    if (description) doc.description = description.slice(0, 200);

    res.type('application/json').json(doc);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/lab-tokens/publish-meta', authMiddleware, async (req, res) => {
  try {
    const u = await getUserByPrivyId(req.privyUserId);
    if (!u) return res.status(404).json({ error: 'User not found' });

    const mint = normalizeSolanaAddress(req.body?.mint);
    if (!mint) return res.status(400).json({ error: 'Invalid mint address' });

    const displayName =
    typeof req.body?.displayName === 'string' ?
    req.body.displayName.trim().slice(0, 200) || null :
    null;
    const symbol =
    typeof req.body?.symbol === 'string' ?
    req.body.symbol.trim().toUpperCase().slice(0, 16) || null :
    null;
    const imageUrl =
    typeof req.body?.imageUrl === 'string' ?
    req.body.imageUrl.trim().slice(0, 2000) || null :
    null;
    const priceNote =
    typeof req.body?.priceNote === 'string' ?
    req.body.priceNote.trim().slice(0, 500) || null :
    null;

    let pythFeedHex = null;
    if (req.body?.pythFeedHex != null && String(req.body.pythFeedHex).trim()) {
      const norm = normalizeFeedHex(req.body.pythFeedHex);
      if (!norm) return res.status(400).json({ error: 'Invalid Pyth feed id (64 hex chars, optional 0x)' });
      pythFeedHex = norm;
    }

    if (imageUrl && !/^https:\/\//i.test(imageUrl)) {
      return res.status(400).json({ error: 'Avatar URL must start with https://' });
    }

    const existing = await pool.query(
      `SELECT user_id FROM public_lab_token_meta WHERE mint = $1`,
      [mint]
    );
    if (existing.rows.length && existing.rows[0].user_id !== u.id) {
      return res.status(403).json({ error: 'This mint is registered to another account' });
    }

    await pool.query(
      `INSERT INTO public_lab_token_meta (mint, user_id, display_name, symbol, image_url, price_note, pyth_feed_hex)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (mint) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         symbol = EXCLUDED.symbol,
         image_url = EXCLUDED.image_url,
         price_note = EXCLUDED.price_note,
         pyth_feed_hex = EXCLUDED.pyth_feed_hex,
         updated_at = now()`,
      [mint, u.id, displayName, symbol, imageUrl, priceNote, pythFeedHex]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not publish metadata' });
  }
});

app.get('/api/lab-tokens', authMiddleware, async (req, res) => {
  try {
    const u = await getUserByPrivyId(req.privyUserId);
    if (!u) return res.status(404).json({ error: 'User not found' });
    const r = await pool.query(
      `SELECT u.id, u.mint, u.signature, u.display_name, u.symbol, u.decimals, u.cluster, u.ata, u.supply_raw, u.created_at,
              u.metadata_uri, u.metadata_image_url, u.metadata_price_note,
              p.pyth_feed_hex AS metadata_pyth_feed_hex
       FROM user_lab_tokens u
       LEFT JOIN public_lab_token_meta p ON p.mint = u.mint
       WHERE u.user_id = $1
       ORDER BY u.created_at DESC`,
      [u.id]
    );
    res.json({ tokens: r.rows.map(serializeLabToken) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/lab-tokens', authMiddleware, async (req, res) => {
  try {
    const u = await getUserByPrivyId(req.privyUserId);
    if (!u) return res.status(404).json({ error: 'User not found' });

    const mint = normalizeSolanaAddress(req.body?.mint);
    if (!mint) return res.status(400).json({ error: 'Invalid mint address' });

    let signature = null;
    if (req.body?.signature != null && req.body.signature !== '') {
      const s = typeof req.body.signature === 'string' ? req.body.signature.trim() : '';
      if (s && !SOLANA_TX_SIG_RE.test(s)) {
        return res.status(400).json({ error: 'Invalid transaction signature' });
      }
      signature = s || null;
    }

    const decimals = Number(req.body?.decimals);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 9) {
      return res.status(400).json({ error: 'Invalid decimals' });
    }

    const cluster =
    typeof req.body?.cluster === 'string' && req.body.cluster.trim() ?
    req.body.cluster.trim().slice(0, 32) :
    'devnet';

    const displayName =
    typeof req.body?.displayName === 'string' ?
    req.body.displayName.trim().slice(0, 200) || null :
    null;
    const symbol =
    typeof req.body?.symbol === 'string' ?
    req.body.symbol.trim().toUpperCase().slice(0, 16) || null :
    null;

    let ata = null;
    if (req.body?.ata) {
      ata = normalizeSolanaAddress(
        typeof req.body.ata === 'string' ? req.body.ata : String(req.body.ata)
      );
      if (!ata) return res.status(400).json({ error: 'Invalid ATA address' });
    }

    const supplyRaw =
    typeof req.body?.supplyRaw === 'string' && /^\d+$/.test(req.body.supplyRaw) ?
    req.body.supplyRaw :
    '0';

    const metadataUri =
    typeof req.body?.metadataUri === 'string' ? req.body.metadataUri.trim().slice(0, 500) || null : null;
    const metadataImageUrl =
    typeof req.body?.metadataImageUrl === 'string' ?
    req.body.metadataImageUrl.trim().slice(0, 2000) || null :
    null;
    const metadataPriceNote =
    typeof req.body?.metadataPriceNote === 'string' ?
    req.body.metadataPriceNote.trim().slice(0, 500) || null :
    null;

    await pool.query(
      `INSERT INTO user_lab_tokens (user_id, mint, signature, display_name, symbol, decimals, cluster, ata, supply_raw,
         metadata_uri, metadata_image_url, metadata_price_note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (user_id, mint) DO UPDATE SET
         signature = EXCLUDED.signature,
         display_name = EXCLUDED.display_name,
         symbol = EXCLUDED.symbol,
         decimals = EXCLUDED.decimals,
         cluster = EXCLUDED.cluster,
         ata = EXCLUDED.ata,
         supply_raw = EXCLUDED.supply_raw,
         metadata_uri = EXCLUDED.metadata_uri,
         metadata_image_url = EXCLUDED.metadata_image_url,
         metadata_price_note = EXCLUDED.metadata_price_note`,
      [
      u.id,
      mint,
      signature,
      displayName,
      symbol,
      decimals,
      cluster,
      ata,
      supplyRaw,
      metadataUri,
      metadataImageUrl,
      metadataPriceNote]

    );

    const saved = await pool.query(
      `SELECT id, mint, signature, display_name, symbol, decimals, cluster, ata, supply_raw, created_at,
              metadata_uri, metadata_image_url, metadata_price_note
       FROM user_lab_tokens WHERE user_id = $1 AND mint = $2`,
      [u.id, mint]
    );
    res.status(201).json({ token: serializeLabToken(saved.rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not save token' });
  }
});

app.delete('/api/lab-tokens', authMiddleware, async (req, res) => {
  try {
    const mint = normalizeSolanaAddress(
      typeof req.query.mint === 'string' ? req.query.mint : ''
    );
    if (!mint) return res.status(400).json({ error: 'Invalid mint address' });

    const u = await getUserByPrivyId(req.privyUserId);
    if (!u) return res.status(404).json({ error: 'User not found' });

    const r = await pool.query(
      `DELETE FROM user_lab_tokens WHERE user_id = $1 AND mint = $2 RETURNING id`,
      [u.id, mint]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    await pool.query(`DELETE FROM public_lab_token_meta WHERE mint = $1`, [mint]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/deals/:id/request-support', authMiddleware, async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid deal id' });
    const u = await getUserByPrivyId(req.privyUserId);
    if (!u) return res.status(404).json({ error: 'User not found' });
    const deal = await getDealById(req.params.id);
    if (!deal) return res.status(404).json({ error: 'Deal not found' });
    if (deal.creator_user_id !== u.id && deal.acceptor_user_id !== u.id) {
      return res.status(403).json({ error: 'Not a participant' });
    }
    await pool.query(`UPDATE deals SET support_requested = true WHERE id = $1`, [req.params.id]);
    const updated = await getDealById(req.params.id);
    res.json({ deal: serializeDeal(updated, u.id) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/deals/:id', authMiddleware, async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid deal id' });
    const u = await getUserByPrivyId(req.privyUserId);
    if (!u) return res.status(404).json({ error: 'User not found' });
    const deal = await getDealById(req.params.id);
    if (!deal) return res.status(404).json({ error: 'Deal not found' });
    res.json({ deal: serializeDeal(deal, u.id) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/deals', authMiddleware, async (req, res) => {
  try {
    const network =
    typeof req.body?.network === 'string' ? req.body.network.trim() : DEAL_NETWORK;
    if (network !== DEAL_NETWORK) {
      return res.status(400).json({ error: 'Only Solana Devnet is supported' });
    }

    const escrowKind = req.body?.escrow_kind === 'rwa' ? 'rwa' : 'sol';

    let amount = null;
    if (req.body?.amount != null && req.body.amount !== '') {
      const n = Number(req.body.amount);
      if (Number.isFinite(n) && n > 0) amount = n;else
      return res.status(400).json({ error: 'Amount must be a positive number' });
    } else {
      return res.status(400).json({ error: 'Amount is required' });
    }

    const u = await upsertUser(req.privyUserId, null);

    if (escrowKind === 'rwa') {

      const rwaMint = normalizeSolanaAddress(req.body?.rwa_mint);
      if (!rwaMint) return res.status(400).json({ error: 'rwa_mint address required for RWA deal' });

      const assetRaw =
      typeof req.body?.asset === 'string' && req.body.asset.trim() ?
      req.body.asset.trim().slice(0, 20) :
      'rwaGOLD';

      let rwaPythFeedHex = null;
      if (req.body?.rwa_pyth_feed_hex) {
        const norm = normalizeFeedHex(req.body.rwa_pyth_feed_hex);
        if (!norm) return res.status(400).json({ error: 'Invalid rwa_pyth_feed_hex (must be 64 hex chars)' });
        rwaPythFeedHex = norm;
      }


      const solUsdMockPrice = Number(process.env.SOL_USD_MOCK_PRICE) || 100;
      const notionalUsdE6 = String(Math.round(amount * solUsdMockPrice * 1e6));

      const rwaCollateralDecimals =
      req.body?.rwa_collateral_decimals != null ?
      Number(req.body.rwa_collateral_decimals) :
      6;
      if (!Number.isInteger(rwaCollateralDecimals) || rwaCollateralDecimals < 0 || rwaCollateralDecimals > 9) {
        return res.status(400).json({ error: 'rwa_collateral_decimals must be 0-9' });
      }

      const rwaCollateralRatioBps =
      req.body?.rwa_collateral_ratio_bps != null ?
      Number(req.body.rwa_collateral_ratio_bps) :
      11000;
      if (!Number.isInteger(rwaCollateralRatioBps) || rwaCollateralRatioBps < 10000 || rwaCollateralRatioBps > 50000) {
        return res.status(400).json({ error: 'rwa_collateral_ratio_bps must be 10000–50000' });
      }

      const paymentDeadlineMinutes =
      req.body?.payment_deadline_minutes != null ?
      Number(req.body.payment_deadline_minutes) :
      2;
      if (!Number.isInteger(paymentDeadlineMinutes) || paymentDeadlineMinutes < 1 || paymentDeadlineMinutes > 10080) {
        return res.status(400).json({ error: 'payment_deadline_minutes must be 1–10080' });
      }

      const ins = await pool.query(
        `INSERT INTO deals
           (creator_user_id, amount, currency, network, asset, status, escrow_kind,
            rwa_mint, rwa_oracle_mode, rwa_pyth_feed_hex, rwa_notional_usd_e6, rwa_collateral_decimals, rwa_collateral_ratio_bps, payment_deadline_minutes)
         VALUES ($1,$2,'SOL',$3,$4,'open','rwa',$5,'mock',$6,$7,$8,$9,$10)
         RETURNING id`,
        [u.id, amount, DEAL_NETWORK, assetRaw, rwaMint, rwaPythFeedHex, notionalUsdE6, rwaCollateralDecimals, rwaCollateralRatioBps, paymentDeadlineMinutes]
      );
      const full = await getDealById(ins.rows[0].id);
      return res.status(201).json({ deal: serializeDeal(full, u.id) });
    }


    const assetRaw =
    typeof req.body?.asset === 'string' && req.body.asset.trim() ?
    req.body.asset.trim().toUpperCase() :
    'SOL';
    if (assetRaw !== 'SOL') {
      return res.status(400).json({ error: 'New listings use SOL only for sol escrow_kind' });
    }

    const ins = await pool.query(
      `INSERT INTO deals (creator_user_id, amount, currency, network, asset, status, escrow_kind)
       VALUES ($1, $2, $3, $4, $5, 'open', 'sol')
       RETURNING id`,
      [u.id, amount, 'SOL', DEAL_NETWORK, 'SOL']
    );
    const full = await getDealById(ins.rows[0].id);
    res.status(201).json({ deal: serializeDeal(full, u.id) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not create deal' });
  }
});

app.post('/api/deals/:id/accept', authMiddleware, async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid deal id' });
    const u = await getUserByPrivyId(req.privyUserId);
    if (!u) return res.status(404).json({ error: 'User not found' });

    const deal = await getDealById(req.params.id);
    if (!deal) return res.status(404).json({ error: 'Deal not found' });
    if (deal.status === 'cancelled') {
      return res.status(400).json({ error: 'Deal is cancelled' });
    }
    if (deal.status !== 'open' || deal.acceptor_user_id) {
      return res.status(400).json({ error: 'Deal is not open for acceptance' });
    }
    if (deal.creator_user_id === u.id) {
      return res.status(400).json({ error: 'You cannot accept your own deal' });
    }

    const upd = await pool.query(
      `UPDATE deals SET acceptor_user_id = $1, status = 'accepted'
       WHERE id = $2 AND status = 'open' AND acceptor_user_id IS NULL
       RETURNING id`,
      [u.id, req.params.id]
    );
    if (upd.rowCount === 0) {
      return res.status(409).json({ error: 'Deal was already accepted' });
    }

    const full = await getDealById(req.params.id);
    res.json({ deal: serializeDeal(full, u.id) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not accept deal' });
  }
});

app.get('/api/deals/:id/messages', authMiddleware, async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid deal id' });
    const u = await getUserByPrivyId(req.privyUserId);
    if (!u) return res.status(404).json({ error: 'User not found' });

    const deal = await getDealById(req.params.id);
    if (!deal) return res.status(404).json({ error: 'Deal not found' });
    if (!deal.acceptor_user_id) {
      return res.status(403).json({ error: 'Chat is available after the deal is accepted' });
    }
    const isParticipant = deal.creator_user_id === u.id || deal.acceptor_user_id === u.id;
    const isSupportChat = u.is_support && deal.support_requested;
    if (!isParticipant && !isSupportChat) {
      return res.status(403).json({ error: 'Not a participant' });
    }

    const r = await pool.query(
      `SELECT m.id, m.body, m.created_at, m.author_user_id, u.solana_address AS author_solana_address,
              COALESCE(u.is_support, false) AS author_is_support
       FROM deal_messages m
       JOIN users u ON u.id = m.author_user_id
       WHERE m.deal_id = $1
       ORDER BY m.created_at ASC`,
      [req.params.id]
    );
    res.json({
      messages: r.rows.map((m) => ({
        id: m.id,
        body: m.body,
        created_at: m.created_at,
        author: participantFromUserRow({
          id: m.author_user_id,
          solana_address: m.author_solana_address
        }),
        author_is_support: Boolean(m.author_is_support),
        is_me: m.author_user_id === u.id
      }))
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not load messages' });
  }
});

app.post('/api/deals/:id/messages', authMiddleware, async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid deal id' });
    const u = await getUserByPrivyId(req.privyUserId);
    if (!u) return res.status(404).json({ error: 'User not found' });

    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (!body) return res.status(400).json({ error: 'Message cannot be empty' });
    if (body.length > 4000) return res.status(400).json({ error: 'Message too long' });

    const deal = await getDealById(req.params.id);
    if (!deal) return res.status(404).json({ error: 'Deal not found' });
    if (deal.status === 'cancelled') {
      return res.status(400).json({ error: 'Chat is closed for cancelled deals' });
    }
    if (!deal.acceptor_user_id) {
      return res.status(403).json({ error: 'Chat is available after the deal is accepted' });
    }
    const isParticipant = deal.creator_user_id === u.id || deal.acceptor_user_id === u.id;
    const isSupportChat = u.is_support && deal.support_requested;
    if (!isParticipant && !isSupportChat) {
      return res.status(403).json({ error: 'Not a participant' });
    }

    const ins = await pool.query(
      `INSERT INTO deal_messages (deal_id, author_user_id, body)
       VALUES ($1, $2, $3)
       RETURNING id, body, created_at, author_user_id`,
      [req.params.id, u.id, body]
    );
    const row = ins.rows[0];
    res.status(201).json({
      message: {
        id: row.id,
        body: row.body,
        created_at: row.created_at,
        author: participantFromUserRow(u),
        author_is_support: Boolean(u.is_support),
        is_me: true
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not send message' });
  }
});

app.post('/api/support/deals/:id/status', authMiddleware, supportRoleMiddleware, async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid deal id' });
    const next = typeof req.body?.status === 'string' ? req.body.status.trim().toLowerCase() : '';
    const allowed = new Set(['cancelled', 'disputed', 'accepted']);
    if (!allowed.has(next)) {
      return res.status(400).json({ error: 'Invalid status (use cancelled, disputed, or accepted)' });
    }
    const deal = await getDealById(req.params.id);
    if (!deal) return res.status(404).json({ error: 'Deal not found' });
    if (!deal.support_requested) {
      return res.status(403).json({ error: 'Support was not requested for this deal' });
    }
    const cur = deal.status;
    if (next === 'disputed') {
      if (cur !== 'accepted') {
        return res.status(400).json({ error: 'Can only mark as disputed from accepted' });
      }
    } else if (next === 'accepted') {
      if (cur !== 'disputed') {
        return res.status(400).json({ error: 'Can only restore accepted from disputed' });
      }
    } else if (next === 'cancelled') {
      if (!['open', 'accepted', 'disputed'].includes(cur)) {
        return res.status(400).json({ error: 'Cannot cancel from this status' });
      }
    }
    await pool.query(`UPDATE deals SET status = $1 WHERE id = $2`, [next, req.params.id]);
    const supportUser = req.supportUser;
    const full = await getDealById(req.params.id);
    res.json({ deal: serializeDeal(full, supportUser.id) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not update status' });
  }
});


app.post('/api/support/purge', authMiddleware, supportRoleMiddleware, async (_req, res) => {
  try {
    await pool.query('BEGIN');
    const rMeta = await pool.query('DELETE FROM public_lab_token_meta');
    const rTokens = await pool.query('DELETE FROM user_lab_tokens');

    const rDeals = await pool.query('DELETE FROM deals');
    await pool.query('COMMIT');
    res.json({
      ok: true,
      deleted: {
        deals: rDeals.rowCount,
        labTokens: rTokens.rowCount,
        labTokenMeta: rMeta.rowCount
      }
    });
  } catch (e) {
    await pool.query('ROLLBACK').catch(() => {});
    console.error(e);
    res.status(500).json({ error: 'Could not purge data' });
  }
});

registerEscrowRoutes(app, {
  pool,
  authMiddleware,
  supportRoleMiddleware,
  getUserByPrivyId,
  getDealById,
  UUID_RE,
  normalizeSolanaAddress,
  serializeDeal
});

registerActionsRoutes(app, { getDealById, pool });

function logDbError(err) {
  console.error('PostgreSQL: connection or schema failed.');
  if (err?.name === 'AggregateError' && Array.isArray(err.errors)) {
    err.errors.forEach((e, i) => console.error(`  [${i}]`, e?.message || e));
  } else {
    console.error(err?.message || err);
  }
  if (err?.code) console.error('code:', err.code);
  if (err?.cause) console.error('cause:', err.cause);
  console.error(
    '\nEnsure PostgreSQL is running and DATABASE_URL in server/.env is correct (try 127.0.0.1).\n'
  );
}

initDb().
then(() => {
  app.listen(port, () => {
    console.log(`API http://localhost:${port}`);
  });
}).
catch((err) => {
  logDbError(err);
  process.exit(1);
});