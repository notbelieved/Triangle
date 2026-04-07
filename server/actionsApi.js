
const { PublicKey, SystemProgram } = require('@solana/web3.js');
const {
  getSolanaConnection,
  buildUnsignedTx
} = require('./escrowProgram.js');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,48}$/;



const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#a78bfa"/>
      <stop offset="100%" stop-color="#5b21b6"/>
    </linearGradient>
  </defs>
  <rect width="256" height="256" rx="52" fill="url(#g)"/>
  <polygon points="128,44 222,196 34,196" fill="black" opacity="0.85"/>
  <polygon points="128,80 194,180 62,180" fill="url(#g)" opacity="0.4"/>
</svg>`;
const ICON_URI = `data:image/svg+xml;base64,${Buffer.from(ICON_SVG).toString('base64')}`;



function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Accept,Authorization,x-blockchain-ids,x-action-version');
  res.setHeader('x-action-version', '2.4');
  res.setHeader('x-blockchain-ids', 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1');
}



function fmtSol(lamports) {
  const n = Number(lamports) / 1e9;
  return (n % 1 === 0 ? `${n}` : n.toFixed(4).replace(/\.?0+$/, '')) + ' SOL';
}

function shortAddr(addr) {
  if (!addr || addr.length < 8) return addr || '—';
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function buildDescription(deal) {
  const parts = [];
  const es = deal.escrow_status;
  const isRwa = deal.escrow_kind === 'rwa';

  if (deal.creator_solana_address) parts.push(`Buyer: ${shortAddr(deal.creator_solana_address)}`);
  if (deal.acceptor_solana_address) parts.push(`Seller: ${shortAddr(deal.acceptor_solana_address)}`);
  if (!deal.acceptor_user_id) parts.push('Awaiting counterparty — share to accept');
  if (es === 'funded') parts.push('✓ Escrow funded');
  if (isRwa) {
    const paid = Number(deal.sol_paid_lamports || '0');
    const total = Number(deal.amount || 0) * 1e9;
    if (total > 0) parts.push(`Paid: ${fmtSol(paid)} / ${fmtSol(total)}`);
    if (deal.payment_deadline) {
      const d = new Date(deal.payment_deadline);
      parts.push(`Deadline: ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
    }
  }
  return parts.join('\n') || 'Secured escrow deal on Solana Devnet';
}

function getBaseUrl(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3001';
  const proto = req.headers['x-forwarded-proto'] || (host.includes('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}



function buildMetadata(deal, baseUrl) {
  const amount = Number(deal.amount || 0);
  const isRwa = deal.escrow_kind === 'rwa';
  const isSol = deal.escrow_kind === 'sol';
  const es = deal.escrow_status;
  const status = deal.status;

  const title = `${amount} SOL · Triangle Escrow`;
  const description = buildDescription(deal);


  if (status === 'cancelled') {
    return { icon: ICON_URI, title, description, label: 'Cancelled', disabled: true, error: 'This deal has been cancelled.' };
  }
  if (es === 'released') return { icon: ICON_URI, title, description, label: 'Deal Complete ✓', disabled: true };
  if (es === 'liquidated') return { icon: ICON_URI, title, description, label: 'Collateral Claimed', disabled: true };

  const actions = [];


  if (status === 'open') {
    actions.push({
      type: 'transaction',
      label: 'Accept Deal',
      href: `${baseUrl}/api/actions/deal/${deal.id}?action=accept`
    });
  }


  if (isSol && status === 'accepted' && (!es || es === 'awaiting_funds')) {
    actions.push({
      type: 'transaction',
      label: `Deposit ${amount} SOL`,
      href: `${baseUrl}/api/actions/deal/${deal.id}?action=deposit-sol`
    });
  }


  if (isSol && es === 'funded') {
    actions.push({
      type: 'transaction',
      label: `Release ${amount} SOL`,
      href: `${baseUrl}/api/actions/deal/${deal.id}?action=release-sol`
    });
  }


  if (isRwa && es === 'funded' && !deal.payment_defaulted) {
    const paidLamports = Number(deal.sol_paid_lamports || '0');
    const dealLamports = amount * 1e9;
    const remaining = dealLamports - paidLamports;
    if (remaining > 0) {
      actions.push({
        type: 'transaction',
        label: `Pay ${fmtSol(remaining)}`,
        href: `${baseUrl}/api/actions/deal/${deal.id}?action=pay-sol`,
        parameters: [{
          name: 'amount_sol',
          label: `Amount (max ${fmtSol(remaining)})`,
          required: false
        }]
      });
    }
    if (deal.payment_deadline) {
      const now = Date.now();
      const deadline = new Date(deal.payment_deadline).getTime();
      if (now > deadline && paidLamports < dealLamports) {
        actions.push({
          type: 'transaction',
          label: 'Claim Collateral (default)',
          href: `${baseUrl}/api/actions/deal/${deal.id}?action=claim-collateral`
        });
      }
    }
  }

  if (actions.length === 0) {
    actions.push({
      type: 'external-link',
      label: 'View Deal →',
      href: `${baseUrl}/deals/${deal.id}`
    });
  }

  return {
    icon: ICON_URI,
    title,
    description,
    label: actions[0]?.label ?? 'View Deal',
    links: { actions }
  };
}



function registerActionsRoutes(app, { getDealById, pool } = {}) {

  app.options('/api/actions/*', (_req, res) => {setCors(res);res.sendStatus(204);});
  app.options('/actions.json', (_req, res) => {res.setHeader('Access-Control-Allow-Origin', '*');res.sendStatus(204);});


  app.get('/actions.json', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const base = getBaseUrl(req);
    res.json({
      rules: [
      { pathPattern: '/deals/*', apiPath: `${base}/api/actions/deal/*` },
      { pathPattern: '/api/actions/**', apiVersion: '2' }]

    });
  });


  app.get('/api/actions/deal/:id', async (req, res) => {
    setCors(res);
    try {
      if (!UUID_RE.test(req.params.id)) return res.status(400).json({ message: 'Invalid deal id' });
      const deal = await getDealById(req.params.id);
      if (!deal) return res.status(404).json({ message: 'Deal not found' });
      res.json(buildMetadata(deal, getBaseUrl(req)));
    } catch (e) {
      console.error('[actions] GET metadata', e);
      res.status(500).json({ message: e.message || 'Internal error' });
    }
  });


  app.post('/api/actions/deal/:id', async (req, res) => {
    setCors(res);
    try {
      if (!UUID_RE.test(req.params.id)) return res.status(400).json({ message: 'Invalid deal id' });
      const deal = await getDealById(req.params.id);
      if (!deal) return res.status(404).json({ message: 'Deal not found' });

      const account = req.body?.account;
      if (!account || !SOLANA_ADDRESS_RE.test(account)) {
        return res.status(400).json({ message: 'Valid account public key required' });
      }
      const accountKey = new PublicKey(account);
      const action = String(req.query.action || 'view').toLowerCase();


      if (action === 'pay-sol') {
        if (deal.escrow_kind !== 'rwa') return res.status(400).json({ message: 'pay-sol only for RWA deals' });
        if (deal.escrow_status !== 'funded') return res.status(400).json({ message: 'Escrow not funded' });
        if (!deal.acceptor_solana_address) return res.status(400).json({ message: 'Seller address not set' });

        const dealLamports = BigInt(Math.round(Number(deal.amount || 0) * 1e9));
        const paidLamports = BigInt(deal.sol_paid_lamports || '0');
        const remaining = dealLamports - paidLamports;
        if (remaining <= 0n) return res.status(400).json({ message: 'SOL already fully paid' });

        const amountParam = req.body?.data?.amount_sol ?? req.query.amount_sol;
        let toLamports = remaining;
        if (amountParam) {
          const parsed = BigInt(Math.round(Number(amountParam) * 1e9));
          if (parsed > 0n) toLamports = parsed < remaining ? parsed : remaining;
        }

        const seller = new PublicKey(deal.acceptor_solana_address);
        const ix = SystemProgram.transfer({ fromPubkey: accountKey, toPubkey: seller, lamports: toLamports });
        const conn = await getSolanaConnection();
        const built = await buildUnsignedTx(conn, accountKey, ix);

        return res.json({
          transaction: built.transactionBase64,
          message: `Paying ${fmtSol(toLamports)} to seller`,
          links: {
            next: {
              type: 'post',
              href: `/api/actions/deal/${deal.id}/ack-pay-sol?amount_lamports=${toLamports.toString()}`
            }
          }
        });
      }


      if (action === 'accept') {

        const ix = SystemProgram.transfer({ fromPubkey: accountKey, toPubkey: accountKey, lamports: 0n });
        const conn = await getSolanaConnection();
        const built = await buildUnsignedTx(conn, accountKey, ix);
        const base = getBaseUrl(req);
        return res.json({
          transaction: built.transactionBase64,
          message: 'Sign in to Triangle to accept this deal',
          links: {
            next: {
              type: 'inline',
              action: {
                type: 'completed',
                icon: ICON_URI,
                title: 'Almost there!',
                label: 'Open Triangle to Accept',
                description: `Visit ${base}/deals/${deal.id} and sign in to complete accepting this deal.`
              }
            }
          }
        });
      }

      return res.status(400).json({ message: `Unknown action: ${action}` });
    } catch (e) {
      console.error('[actions] POST action', e);
      res.status(e.status || 500).json({ message: e.message || 'Internal error' });
    }
  });


  app.post('/api/actions/deal/:id/ack-pay-sol', async (req, res) => {
    setCors(res);
    try {
      if (!UUID_RE.test(req.params.id)) return res.status(400).json({ message: 'Invalid deal id' });
      const deal = await getDealById(req.params.id);
      if (!deal) return res.status(404).json({ message: 'Deal not found' });

      const signature = typeof req.body?.signature === 'string' ? req.body.signature.trim() : '';
      if (!signature) return res.status(400).json({ message: 'signature required' });

      const rawLamports = req.query.amount_lamports ?? req.body?.amount_lamports;
      if (!rawLamports) return res.status(400).json({ message: 'amount_lamports required' });
      const amountLamports = BigInt(String(rawLamports));

      const conn = await getSolanaConnection();
      try {await conn.confirmTransaction(signature, 'confirmed');} catch {
        return res.status(400).json({ message: 'Transaction not confirmed on chain' });
      }

      const dealLamports = BigInt(Math.round(Number(deal.amount || 0) * 1e9));
      const paidSoFar = BigInt(deal.sol_paid_lamports || '0');
      const capped = paidSoFar + amountLamports > dealLamports ? dealLamports : paidSoFar + amountLamports;

      await pool.query('UPDATE deals SET sol_paid_lamports = $1 WHERE id = $2', [String(capped), deal.id]);

      const remaining = dealLamports - capped;
      const message = remaining <= 0n ?
      `Payment complete ✓ — ${fmtSol(dealLamports)} received` :
      `${fmtSol(capped)} recorded · ${fmtSol(remaining)} remaining`;

      return res.json({ message });
    } catch (e) {
      console.error('[actions] ack-pay-sol', e);
      res.status(500).json({ message: e.message || 'Internal error' });
    }
  });
}

module.exports = { registerActionsRoutes };