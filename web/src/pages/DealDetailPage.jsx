import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { usePrivy } from '@privy-io/react-auth';
import { Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { useSignAndSendTransaction, useWallets as useSolanaWallets } from '@privy-io/react-auth/solana';
import { useAuthApi } from '../useAuthApi.js';
import { PageChrome } from '../components/PageChrome.jsx';
import { useTriangleSolanaAddress } from '../useTriangleSolanaAddress.js';
import { formatDealAmount } from '../formatAmount.js';
import SupportModal from '../components/SupportModal.jsx';
import CopyTextButton from '../components/CopyTextButton.jsx';
import { useIsSupport } from '../useIsSupport.js';
import { formatWalletTxError } from '../walletTxError.js';

const NETWORK_LABEL = { 'solana-devnet': 'Solana Devnet' };
const POLL_MS = 2800;



function fmtTokens(rawStr, decimals) {
  if (!rawStr) return '0';
  try {
    const n = Number(BigInt(rawStr)) / Math.pow(10, decimals);
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  } catch {return '0';}
}

function fmtUsd(e6) {
  if (!e6) return '$0';
  const n = Number(e6) / 1e6;
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtSol(lamports) {
  if (!lamports) return '0 SOL';
  const n = Number(lamports) / 1e9;
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) + ' SOL';
}


function RwaProgressBar({ depositedRaw, expectedRaw, decimals }) {
  const deposited = BigInt(depositedRaw || '0');
  const expected = BigInt(expectedRaw || '0');
  const pct = expected > 0n ? Math.min(100, Number(deposited * 10000n / expected) / 100) : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-(--text-tertiary)">
          Collateral deposited
        </span>
        <span className="text-xs font-semibold text-(--text-secondary)">
          {fmtTokens(depositedRaw, decimals)} / {fmtTokens(expectedRaw, decimals)} rwaGOLD
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            background: pct >= 100 ? '#10b981' : 'hsl(260 25% 50%)'
          }} />
        
      </div>
      <p className="mt-0.5 text-right text-[10px] text-(--text-tertiary)">{pct.toFixed(1)}%</p>
    </div>);

}


function RwaPriceStrip({ feedHex }) {
  const api = useAuthApi();
  const [price, setPrice] = useState(null);
  const [ts, setTs] = useState(null);

  useEffect(() => {
    if (!feedHex) return;
    let cancelled = false;
    const load = async () => {
      try {

        const r = await fetch(`/api/rwa-price?feed=${feedHex}`);
        if (!r.ok) return;
        const d = await r.json();
        if (!cancelled) {
          setPrice(d.priceUsd);
          setTs(d.publishTime ? new Date(d.publishTime * 1000).toLocaleTimeString() : null);
        }
      } catch {}
    };
    load();
    const t = setInterval(load, 30_000);
    return () => {cancelled = true;clearInterval(t);};
  }, [feedHex]);

  if (!price) return null;
  return (
    <div className="flex items-center justify-between rounded-[14px] border border-amber-100 bg-amber-50 px-3 py-2">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-amber-700">
          XAU/USD · Pyth
        </span>
      </div>
      <div className="text-right">
        <p className="text-sm font-semibold text-amber-800">
          ${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
        {ts && <p className="text-[10px] text-amber-600">{ts}</p>}
      </div>
    </div>);

}


function RwaHealthBadge({ health }) {
  if (!health || health === 'ok') return null;
  const cfg = health === 'liquidatable' ?
  { cls: 'bg-rose-100 text-rose-800', label: 'Liquidatable' } :
  { cls: 'bg-amber-100 text-amber-700', label: 'Warning' };
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${cfg.cls}`}>
      {cfg.label}
    </span>);

}


function RwaEscrowBlock({ deal, escrowComplete }) {
  if (escrowComplete) {
    return (
      <div className="mt-5 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3.5 animate-reveal">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-emerald-600">✓</span>
          <p className="text-xs font-semibold text-emerald-800">RWA Collateral Escrow</p>
        </div>
        <p className="text-xs text-emerald-700">
          {deal.escrow_status === 'refunded' ? 'Refunded on-chain · vault closed' : 'Released to counterparty · vault closed'}
        </p>
      </div>);

  }

  return (
    <div className="mt-5 rounded-2xl border border-(--accent-border) bg-(--accent-light) animate-reveal">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-(--accent-border)">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0 text-(--accent)" aria-hidden="true">
          <rect x="2" y="7" width="12" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <p className="text-xs font-semibold text-(--accent)">RWA Collateral Escrow</p>
        <div className="ml-auto flex items-center gap-1.5">
          <RwaHealthBadge health={deal.rwa_health} />
          {deal.rwa_escrow_pda &&
          <span className="rounded-full bg-(--accent-border) px-2 py-0.5 text-[10px] font-semibold text-(--accent)">
              {deal.escrow_status ? deal.escrow_status.replace(/_/g, ' ') : 'initialized'}
            </span>
          }
        </div>
      </div>

      <div className="px-4 py-3.5 space-y-3">
        {deal.rwa_pyth_feed_hex && <RwaPriceStrip feedHex={deal.rwa_pyth_feed_hex} />}

        {deal.rwa_escrow_pda ?
        <>
            <RwaProgressBar
            depositedRaw={deal.rwa_deposited_raw}
            expectedRaw={deal.rwa_expected_tokens_raw}
            decimals={deal.rwa_collateral_decimals ?? 6} />
          
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-(--text-tertiary) mb-1">
                Vault ATA
              </p>
              <p className="font-mono text-[11px] text-(--text-secondary) break-all leading-relaxed">
                {deal.rwa_vault_ata}
              </p>
            </div>
            {deal.rwa_initial_price_usd_e6 && deal.rwa_initial_price_usd_e6 !== '0' &&
          <p className="text-[11px] text-(--text-tertiary)">
                Initial gold price: {fmtUsd(Number(deal.rwa_initial_price_usd_e6))}
              </p>
          }
            {deal.rwa_collateral_ratio_bps &&
          <p className="text-[11px] text-(--text-tertiary)">
                Collateral:{' '}
                <span className="font-semibold text-(--text-secondary)">
                  {(deal.rwa_collateral_ratio_bps / 100).toFixed(0)}%
                </span>
                {deal.rwa_notional_usd_e6 &&
            <> — deal {fmtUsd(Number(deal.rwa_notional_usd_e6))}, required {fmtUsd(Number(deal.rwa_notional_usd_e6) * deal.rwa_collateral_ratio_bps / 10000)}</>
            }
              </p>
          }
          </> :

        <p className="text-xs text-(--text-tertiary)">
            No vault yet. Press{' '}
            <span className="font-semibold text-(--text-secondary)">Init RWA Escrow</span>{' '}
            to create the on-chain vault account.
          </p>
        }
      </div>
    </div>);

}


function useCountdown(deadline) {
  const [secsLeft, setSecsLeft] = useState(null);
  useEffect(() => {
    if (!deadline) {setSecsLeft(null);return;}
    const target = new Date(deadline).getTime();
    const tick = () => setSecsLeft(Math.ceil((target - Date.now()) / 1000));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [deadline]);
  return secsLeft;
}

function fmtCountdown(secs) {
  if (secs == null) return null;
  if (secs <= 0) return 'Deadline passed';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}


function SolPaymentBlock({ deal, onPaySol, onRefresh, dealId }) {
  const [payAmount, setPayAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [localErr, setLocalErr] = useState('');
  const secsLeft = useCountdown(deal.payment_deadline);
  const api = useAuthApi();

  const dealLamports = Number(deal.amount || 0) * 1e9;
  const paidLamports = Number(deal.sol_paid_lamports || '0');
  const pct = dealLamports > 0 ? Math.min(100, paidLamports / dealLamports * 100) : 0;
  const fullyPaid = dealLamports > 0 && paidLamports >= dealLamports;
  const deadlinePassed = secsLeft != null && secsLeft <= 0;
  const canClaimCollateral = deal.role === 'seller' && deadlinePassed && !fullyPaid && deal.escrow_status === 'funded' && !deal.payment_defaulted;
  const canPay = deal.role === 'creator' && deal.escrow_status === 'funded' && !fullyPaid && !deal.payment_defaulted;

  const maxRemainingSol = Math.max(0, (dealLamports - paidLamports) / 1e9);

  async function onPay() {
    const amount = parseFloat(payAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setLocalErr('Enter a valid amount');
      return;
    }
    setBusy(true);
    setLocalErr('');
    try {
      await onPaySol(amount);
      setPayAmount('');
    } catch (e) {
      setLocalErr(e.message || 'Payment failed');
    } finally {
      setBusy(false);
    }
  }

  async function onClaimCollateral() {
    setBusy(true);
    setLocalErr('');
    try {
      const d = await api(`/deals/${dealId}/claim-collateral`, { method: 'POST' });
      if (d?.deal) onRefresh(d.deal);
    } catch (e) {
      setLocalErr(e.message || 'Claim failed');
    } finally {
      setBusy(false);
    }
  }

  async function onReturnCollateral() {
    setBusy(true);
    setLocalErr('');
    try {
      const d = await api(`/deals/${dealId}/return-collateral`, { method: 'POST' });
      if (d?.deal) onRefresh(d.deal);
    } catch (e) {
      setLocalErr(e.message || 'Return collateral failed');
    } finally {
      setBusy(false);
    }
  }

  if (deal.payment_defaulted || deal.escrow_status === 'liquidated') {
    return (
      <div className="mt-5 rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3.5 animate-reveal">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-rose-500">✕</span>
          <p className="text-xs font-semibold text-rose-800">SOL Payment — Defaulted</p>
        </div>
        <p className="text-xs text-rose-700">
          Paid {fmtSol(paidLamports)} of {fmtSol(dealLamports)} · Collateral claimed by seller
        </p>
      </div>);

  }

  if (fullyPaid) {
    const isBuyer = deal.role === 'creator';
    const canReclaim = isBuyer && deal.escrow_status === 'funded';
    return (
      <div className="mt-5 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3.5 animate-reveal space-y-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-emerald-600">✓</span>
            <p className="text-xs font-semibold text-emerald-800">SOL Payment — Complete</p>
          </div>
          <p className="text-xs text-emerald-700">
            {isBuyer ?
            `${fmtSol(dealLamports)} paid · Reclaim your rwaGOLD collateral` :
            `${fmtSol(dealLamports)} received · Buyer is reclaiming their rwaGOLD collateral`}
          </p>
        </div>
        {localErr &&
        <p className="rounded-[10px] bg-red-50 border border-red-100 px-3 py-2 text-[11px] text-red-800">{localErr}</p>
        }
        {canReclaim &&
        <button
          type="button"
          onClick={onReturnCollateral}
          disabled={busy}
          className="w-full rounded-[14px] bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-40 cursor-pointer hover:bg-emerald-700">
          
            {busy ? 'Reclaiming…' : 'Reclaim collateral'}
          </button>
        }
      </div>);

  }

  return (
    <div className="mt-5 rounded-2xl border border-(--accent-border) bg-(--accent-light) animate-reveal">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-(--accent-border)">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0 text-(--accent)" aria-hidden="true">
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 5v3l2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <p className="text-xs font-semibold text-(--accent)">SOL Payment</p>
        <div className="ml-auto">
          {deadlinePassed ?
          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-800">Overdue</span> :
          secsLeft != null && deal.payment_deadline ?
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
              {fmtCountdown(secsLeft)}
            </span> :
          null}
        </div>
      </div>

      <div className="px-4 py-3.5 space-y-3">
        {}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-(--text-tertiary)">Paid</span>
            <span className="text-xs font-semibold text-(--text-secondary)">
              {fmtSol(paidLamports)} / {fmtSol(dealLamports)}
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${pct}%`, background: pct >= 100 ? '#10b981' : 'hsl(260 25% 50%)' }} />
            
          </div>
          <p className="mt-0.5 text-right text-[10px] text-(--text-tertiary)">{pct.toFixed(0)}%</p>
        </div>

        {deal.payment_deadline &&
        <p className="text-[11px] text-(--text-tertiary)">
            Deadline:{' '}
            <span className={`font-semibold ${deadlinePassed ? 'text-rose-600' : 'text-(--text-secondary)'}`}>
              {new Date(deal.payment_deadline).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              {secsLeft != null && !deadlinePassed && <> · {fmtCountdown(secsLeft)} left</>}
              {deadlinePassed && <> · Overdue</>}
            </span>
          </p>
        }

        {localErr &&
        <p className="rounded-[10px] bg-red-50 border border-red-100 px-3 py-2 text-[11px] text-red-800">{localErr}</p>
        }

        {canPay &&
        <div className="flex gap-2 items-end">
            <div className="relative flex-1">
              <input
              type="number"
              min="0"
              step="any"
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
              placeholder={`Max ${maxRemainingSol.toFixed(4)}`}
              className="w-full rounded-[14px] border border-(--border) bg-white pl-3 pr-14 py-2.5 text-sm text-(--text-primary) outline-none transition-all placeholder:text-(--text-tertiary) focus:border-(--accent-border) focus:ring-2 focus:ring-(--accent-light)" />
            
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-(--text-tertiary)">SOL</span>
            </div>
            <button
            type="button"
            onClick={onPay}
            disabled={busy || !payAmount}
            className="shrink-0 rounded-[14px] bg-(--accent) px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-40 cursor-pointer hover:brightness-105">
            
              {busy ? 'Paying…' : 'Pay'}
            </button>
          </div>
        }

        {canClaimCollateral &&
        <button
          type="button"
          onClick={onClaimCollateral}
          disabled={busy}
          className="w-full rounded-[14px] bg-rose-600 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-40 cursor-pointer hover:bg-rose-700">
          
            {busy ? 'Claiming…' : 'Claim collateral (buyer defaulted)'}
          </button>
        }
      </div>
    </div>);

}

function getSecurityStatus(deal) {
  if (!deal) return { label: '—', variant: 'neutral', pulse: false };

  if (deal.status === 'cancelled') return { label: 'Deal cancelled', variant: 'complete', pulse: false };
  if (deal.status === 'disputed') return { label: 'Dispute · support review', variant: 'warning', pulse: false };

  const es = deal.escrow_status;

  if (es === 'released') return { label: 'Payment released', variant: 'complete', pulse: false };
  if (es === 'refunded') return { label: 'Refunded on-chain', variant: 'complete', pulse: false };
  if (es === 'liquidated') {
    return { label: 'Liquidated on-chain', variant: 'complete', pulse: false };
  }
  if (es === 'funded') {
    if (deal.escrow_frozen)
    return { label: 'Funds frozen · dispute pending', variant: 'warning', pulse: false };
    return { label: 'Funds secured in escrow', variant: 'secure', pulse: true };
  }
  if (es === 'awaiting_confirm') return { label: 'Confirming on-chain…', variant: 'pending', pulse: false };
  if (es === 'awaiting_funds') return { label: 'Awaiting deposit', variant: 'pending', pulse: false };
  if (deal.escrow_pda) return { label: 'Escrow initialized', variant: 'pending', pulse: false };
  if (deal.status === 'accepted' || deal.status === 'disputed') {
    if (deal.escrow_program_configured)
    return { label: 'Ready to initialize escrow', variant: 'pending', pulse: false };
    return { label: 'Deal accepted', variant: 'neutral', pulse: false };
  }
  if (deal.status === 'open') {
    return deal.seller ?
    { label: 'Deal accepted', variant: 'neutral', pulse: false } :
    { label: 'Waiting for counterparty', variant: 'neutral', pulse: false };
  }
  return { label: deal.status ?? '—', variant: 'neutral', pulse: false };
}

const SECURITY_VARIANTS = {
  secure: {
    wrap: 'bg-emerald-50 border-emerald-100',
    text: 'text-emerald-800 font-semibold',
    dot: 'bg-emerald-500',
    ping: 'bg-emerald-400'
  },
  warning: {
    wrap: 'bg-amber-50 border-amber-100',
    text: 'text-amber-800 font-semibold',
    dot: 'bg-amber-400',
    ping: ''
  },
  pending: {
    wrap: 'bg-(--accent-light) border-(--accent-border)',
    text: 'text-(--accent) font-medium',
    dot: 'bg-(--accent-mid)',
    ping: ''
  },
  complete: {
    wrap: 'bg-slate-50 border-slate-100',
    text: 'text-slate-500 font-medium',
    dot: 'bg-slate-300',
    ping: ''
  },
  neutral: {
    wrap: 'bg-slate-50 border-slate-100',
    text: 'text-slate-400 font-medium',
    dot: 'bg-slate-300',
    ping: ''
  }
};

const STATUS_BADGE = {
  open: { label: 'Open', cls: 'bg-slate-100 text-slate-500' },
  accepted: { label: 'Accepted', cls: 'bg-(--accent-light) text-(--accent)' },
  disputed: { label: 'Disputed', cls: 'bg-amber-100 text-amber-800' },
  cancelled: { label: 'Cancelled', cls: 'bg-slate-200 text-slate-600' },
  funded: { label: 'Funded', cls: 'bg-emerald-100 text-emerald-700' },
  released: { label: 'Released', cls: 'bg-emerald-50 text-emerald-500' },
  refunded: { label: 'Refunded', cls: 'bg-amber-100 text-amber-700' },
  liquidated: { label: 'Liquidated', cls: 'bg-rose-100 text-rose-800' }
};

function DealStatusBadge({ deal }) {
  const escrowStatus = deal?.escrow_status;
  const dealStatus = deal?.status;

  const key =
  escrowStatus === 'funded' ||
  escrowStatus === 'released' ||
  escrowStatus === 'refunded' ||
  escrowStatus === 'liquidated' ?

  escrowStatus :
  dealStatus;

  const cfg = STATUS_BADGE[key] ?? { label: key ?? '—', cls: 'bg-slate-100 text-slate-500' };

  return (
    <span
      className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold leading-none ${cfg.cls}`}
      aria-label={`Deal status: ${cfg.label}`}>
      
      {cfg.label}
    </span>);

}

function FullAddressRow({ label, address }) {
  return (
    <div className="flex items-start justify-between gap-3 min-w-0">
      <p className="shrink-0 text-[10px] font-semibold uppercase tracking-widest text-(--text-tertiary) mt-0.5 w-16">
        {label}
      </p>
      <div className="min-w-0 flex-1 text-right">
        <p className="font-mono text-[11px] text-(--text-tertiary) break-all leading-relaxed">
          {address || '—'}
        </p>
      </div>
    </div>);

}

function ProgramEscrowBlock({ deal, escrowComplete }) {
  const hasPda = Boolean(deal?.escrow_pda);

  if (escrowComplete) {
    return (
      <div className="mt-5 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3.5 animate-reveal">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-emerald-600">✓</span>
          <p className="text-xs font-semibold text-emerald-800">Program Escrow</p>
        </div>
        <p className="text-xs text-emerald-700">
          {deal.escrow_status === 'refunded' ?
          'Refunded on-chain · PDA closed' :
          deal.escrow_status === 'liquidated' ?
          'Escrow closed (liquidated)' :
          'Paid out to counterparty · PDA closed'}
        </p>
      </div>);

  }

  return (
    <div className={`mt-5 rounded-2xl border border-(--accent-border) bg-(--accent-light) ${hasPda ? 'animate-reveal' : ''}`}>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-(--accent-border)">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0 text-(--accent)" aria-hidden="true">
          <rect x="2" y="7" width="12" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <p className="text-xs font-semibold text-(--accent)">Program Escrow</p>
        {hasPda &&
        <span className="ml-auto rounded-full bg-(--accent-border) px-2 py-0.5 text-[10px] font-semibold text-(--accent)">
            {deal.escrow_status ? deal.escrow_status.replace(/_/g, ' ') : 'initialized'}
          </span>
        }
      </div>

      <div className="px-4 py-3.5">
        {hasPda ?
        <>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-(--text-tertiary) mb-1.5">
              Escrow address (PDA)
            </p>
            <p className="font-mono text-[11px] text-(--text-secondary) break-all leading-relaxed mb-2.5">
              {deal.escrow_pda}
            </p>
            <CopyTextButton
            text={deal.escrow_pda}
            label="Copy address"
            className="rounded-[10px] border border-(--accent-border) bg-white px-3 py-1.5 text-[11px] font-semibold text-(--accent) hover:bg-(--accent-light) transition-colors cursor-pointer" />
          
          </> :

        <p className="text-xs text-(--text-tertiary)">
            No escrow account yet. Press <span className="font-semibold text-(--text-secondary)">Create escrow account</span> to initialize a Program Derived Address on Solana.
          </p>
        }
      </div>
    </div>);

}

function SecurityBanner({ deal }) {
  const { label, variant, pulse } = getSecurityStatus(deal);
  const v = SECURITY_VARIANTS[variant];

  return (
    <div
      className={`flex items-center gap-2.5 px-5 py-3 rounded-t-[20px] ${v.wrap} border-b`}
      role="status"
      aria-live="polite">
      
      <span className="relative flex h-2 w-2 shrink-0">
        {pulse &&
        <span
          className={`absolute inline-flex h-full w-full rounded-full ${v.ping} animate-ping-slow`} />

        }
        <span className={`relative inline-flex h-2 w-2 rounded-full ${v.dot}`} />
      </span>
      <p className={`text-xs tracking-wide ${v.text}`}>{label}</p>
      {deal?.escrow_frozen &&
      <span className="ml-auto shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
          Frozen
        </span>
      }
    </div>);

}

function ProgressDot({ active }) {
  return (
    <span
      className={`h-2 w-2 rounded-full shrink-0 transition-colors duration-300 ${
      active ? 'bg-(--accent)' : 'bg-slate-200'}`
      } />);


}

function ProgressConnector({ active }) {
  return (
    <span
      className={`h-px flex-1 transition-colors duration-300 ${active ? 'bg-(--accent-border)' : 'bg-slate-200'}`} />);


}

function DealProgress({ deal }) {
  const hasSeller = Boolean(deal?.seller);
  const es = deal?.escrow_status;
  const isFunded =
  es === 'funded' || es === 'released' || es === 'refunded' || es === 'liquidated';
  const isDone = es === 'released' || es === 'refunded' || es === 'liquidated';

  const steps = ['Created', 'Accepted', 'Funded', 'Done'];
  const active = [true, hasSeller, isFunded, isDone];

  return (
    <div className="mt-6">
      <div className="flex items-center gap-0">
        {steps.map((step, i) =>
        <div key={step} className="flex items-center" style={{ flex: i < steps.length - 1 ? '1' : 'none' }}>
            <div className="flex flex-col items-center gap-1.5">
              <ProgressDot active={active[i]} />
              <p className={`text-[10px] font-medium whitespace-nowrap ${active[i] ? 'text-(--accent)' : 'text-slate-400'}`}>
                {step}
              </p>
            </div>
            {i < steps.length - 1 &&
          <ProgressConnector active={active[i + 1]} />
          }
          </div>
        )}
      </div>
    </div>);

}



function InlineAlert({ children, variant = 'warning' }) {
  const styles = {
    warning: 'bg-amber-50 text-amber-800 border border-amber-100',
    info: 'bg-(--accent-light) text-(--accent) border border-(--accent-border)',
    success: 'bg-emerald-50 text-emerald-800 border border-emerald-100',
    error: 'bg-red-50 text-red-800 border border-red-100'
  };
  return (
    <p className={`rounded-[14px] px-3.5 py-2.5 text-xs leading-relaxed ${styles[variant]}`}>
      {children}
    </p>);

}

function PrimaryButton({ onClick, disabled, children, variant = 'violet' }) {
  const base =
  'w-full rounded-[16px] px-4 py-3.5 text-sm font-semibold text-white transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
  const variants = {
    violet: 'bg-(--accent) hover:brightness-105 focus-visible:ring-(--accent) cursor-pointer',
    emerald: 'bg-emerald-600 hover:bg-emerald-700 focus-visible:ring-emerald-500 cursor-pointer'
  };
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${base} ${variants[variant]}`}>
      {children}
    </button>);

}

function GhostButton({ onClick, disabled, children, accent = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex-1 cursor-pointer rounded-[14px] border px-3 py-2.5 text-xs font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40
        ${accent ?
      'border-(--accent-border) bg-(--accent-light) text-(--accent) hover:brightness-95' :
      'border-(--border) bg-white text-(--text-secondary) hover:bg-slate-50'}`
      }>
      
      {children}
    </button>);

}

function SupportModerationBlock({ deal, dealId, api, onRefresh }) {
  const [statusChoice, setStatusChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [errLocal, setErrLocal] = useState('');
  const [msgLocal, setMsgLocal] = useState('');
  const [refundTarget, setRefundTarget] = useState('creator');

  const creator = deal?.creator?.address;
  const sellerAddr = deal?.seller?.address;
  const frozen = deal?.escrow_frozen;
  const hasPda = Boolean(deal?.escrow_pda);
  const effectiveRecipient = refundTarget === 'creator' ? creator : sellerAddr;

  const statusOptions = [];
  if (deal?.status === 'accepted') statusOptions.push({ value: 'disputed', label: 'Mark disputed' });
  if (deal?.status === 'disputed') statusOptions.push({ value: 'accepted', label: 'Clear dispute → accepted' });
  if (['open', 'accepted', 'disputed'].includes(deal?.status ?? '')) {
    statusOptions.push({ value: 'cancelled', label: 'Cancel deal' });
  }

  async function withBusy(fn) {
    setBusy(true);
    setErrLocal('');
    setMsgLocal('');
    try {
      await fn();
    } catch (e) {
      setErrLocal(e.message || 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function applyStatus() {
    if (!statusChoice) return;
    await withBusy(async () => {
      await api(`/support/deals/${dealId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: statusChoice })
      });
      setMsgLocal('Deal status updated');
      setStatusChoice('');
      await onRefresh();
    });
  }

  async function onRelease() {
    await withBusy(async () => {
      const r = await api('/support/escrow/release', {
        method: 'POST',
        body: JSON.stringify({ dealId })
      });
      setMsgLocal(`Released · ${r.signature}`);
      await onRefresh();
    });
  }

  async function onFreeze(nextFrozen) {
    await withBusy(async () => {
      const r = await api('/support/escrow/freeze', {
        method: 'POST',
        body: JSON.stringify({ dealId, frozen: nextFrozen })
      });
      setMsgLocal(`${nextFrozen ? 'Frozen' : 'Unfrozen'} · ${r.signature}`);
      await onRefresh();
    });
  }

  async function onRefund() {
    await withBusy(async () => {
      const r = await api('/support/escrow/refund', {
        method: 'POST',
        body: JSON.stringify({ dealId, recipient: effectiveRecipient })
      });
      setMsgLocal(`Refunded · ${r.signature}`);
      await onRefresh();
    });
  }

  return (
    <div className="mt-5 rounded-2xl border border-violet-200 bg-violet-50/90 px-4 py-4 space-y-4">
      <p className="text-xs font-semibold text-violet-900">Support · escrow & status</p>
      {errLocal ? <InlineAlert variant="error">{errLocal}</InlineAlert> : null}
      {msgLocal ? <InlineAlert variant="success">{msgLocal}</InlineAlert> : null}

      {statusOptions.length > 0 ?
      <div className="flex flex-wrap items-end gap-2">
          <label className="flex-1 min-w-[140px]">
            <span className="block text-[10px] font-semibold uppercase tracking-widest text-violet-800/80 mb-1">
              Deal status
            </span>
            <select
            value={statusChoice}
            onChange={(e) => setStatusChoice(e.target.value)}
            className="w-full rounded-xl border border-violet-200 bg-white px-3 py-2 text-xs text-(--text-primary) outline-none focus:ring-2 focus:ring-violet-200">
            
              <option value="">Choose…</option>
              {statusOptions.map((o) =>
            <option key={o.value} value={o.value}>{o.label}</option>
            )}
            </select>
          </label>
          <button
          type="button"
          disabled={busy || !statusChoice}
          onClick={applyStatus}
          className="rounded-full px-4 py-2 text-xs font-semibold text-white bg-violet-700 hover:brightness-110 disabled:opacity-40 cursor-pointer">
          
            Apply
          </button>
        </div> :
      null}

      {hasPda ?
      <div className="space-y-3 border-t border-violet-200/80 pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-violet-800/80">Escrow</p>
          <div className="flex flex-wrap gap-2">
            <button
            type="button"
            disabled={busy || frozen}
            onClick={onRelease}
            className="rounded-full px-3 py-1.5 text-[11px] font-semibold bg-emerald-600 text-white disabled:opacity-40 cursor-pointer">
            
              Release to seller
            </button>
            <button
            type="button"
            disabled={busy}
            onClick={() => onFreeze(!frozen)}
            className="rounded-full px-3 py-1.5 text-[11px] font-semibold border border-violet-300 bg-white text-violet-900 cursor-pointer">
            
              {frozen ? 'Unfreeze' : 'Freeze'}
            </button>
          </div>
          <div className="rounded-xl border border-violet-200 bg-white/80 p-3 space-y-2">
            <p className="text-[11px] font-semibold text-(--text-primary)">Refund (freeze first)</p>
            <div className="flex flex-col gap-1.5 text-[11px]">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="sup-refund" checked={refundTarget === 'creator'} onChange={() => setRefundTarget('creator')} className="accent-violet-600" />
                <span className="font-mono text-[10px] break-all">Creator {creator || '—'}</span>
              </label>
              {sellerAddr ?
            <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="sup-refund" checked={refundTarget === 'seller'} onChange={() => setRefundTarget('seller')} className="accent-violet-600" />
                  <span className="font-mono text-[10px] break-all">Seller {sellerAddr}</span>
                </label> :
            null}
            </div>
            <button
            type="button"
            disabled={busy || !frozen || !effectiveRecipient}
            onClick={onRefund}
            className="w-full rounded-full py-2 text-[11px] font-semibold bg-red-600 text-white disabled:opacity-40 cursor-pointer">
            
              Refund to selected address
            </button>
          </div>
        </div> :

      <p className="text-[11px] text-violet-800/80">No on-chain escrow yet.</p>
      }
    </div>);

}

function ChatSection({ messages, chatError, escrowComplete, escrowStatus, body, setBody, sending, onSend, chatReadOnly }) {
  return (
    <section className="mt-6 animate-fade-up-delay">
      <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-(--text-tertiary)">
        Messages
      </p>

      {chatError ? <InlineAlert variant="warning">{chatError}</InlineAlert> : null}

      {escrowComplete && escrowStatus === 'refunded' &&
      <div className="mb-3">
          <InlineAlert variant="success">Escrow refunded on-chain.</InlineAlert>
        </div>
      }

      <div className="overflow-hidden rounded-[20px] border deal-card-border bg-white deal-shadow">
        <div className="max-h-72 overflow-y-auto overscroll-contain flex flex-col gap-3 p-4">
          {messages.length === 0 ?
          <p className="py-6 text-center text-sm text-(--text-tertiary)">No messages yet.</p> :

          messages.map((m) => {
            const sup = Boolean(m.author_is_support);
            const base = m.is_me ?
            'ml-10 bg-(--accent-light) text-(--text-primary)' :
            'mr-10 bg-slate-100 text-slate-800';
            const supportStyle = sup ?
            ' ring-2 ring-violet-300/80 bg-violet-50/90 text-(--text-primary)' :
            '';
            return (
              <div
                key={m.id}
                className={`flex flex-col rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${base}${supportStyle}`}>
                
                  <span className="mb-1 flex flex-wrap items-center gap-x-2 text-[10px] font-medium text-(--text-tertiary) break-all">
                    <span>
                      {m.is_me ? 'You' : m.author?.address || m.author?.label}
                      {sup ?
                    <span className="ml-1.5 rounded-md bg-violet-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                          Support
                        </span> :
                    null}
                    </span>
                    <span className="font-normal">
                      {m.created_at ?
                    new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) :
                    ''}
                    </span>
                  </span>
                  <p className="whitespace-pre-wrap">{m.body}</p>
                </div>);

          })
          }
        </div>
        <form onSubmit={onSend} className="flex gap-2 border-t border-(--border) px-4 py-3">
          <input
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={chatReadOnly ? 'Chat closed' : 'Message…'}
            disabled={chatReadOnly}
            className="min-w-0 flex-1 rounded-[14px] border border-(--border) bg-slate-50/60 px-3 py-2 text-sm outline-none transition-shadow focus:border-(--accent-border) focus:ring-2 focus:ring-(--accent-light) disabled:opacity-50" />
          
          <button
            type="submit"
            disabled={sending || !body.trim() || chatReadOnly}
            className="rounded-[14px] bg-(--text-primary) px-4 py-2 text-xs font-semibold text-white transition-opacity disabled:opacity-40">
            
            Send
          </button>
        </form>
      </div>
    </section>);

}

function BlinkShell({ children }) {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center gap-4 p-4 bg-gradient-to-br from-slate-100 to-violet-50">
      {}
      <div className="flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #a78bfa, #5b21b6)' }}>
          <svg viewBox="0 0 20 20" fill="none" className="w-4 h-4">
            <polygon points="10,3 17,15 3,15" fill="white" opacity="0.95" />
          </svg>
        </div>
        <span className="text-sm font-bold tracking-tight text-slate-700">Triangle</span>
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 uppercase tracking-wider">Devnet</span>
      </div>
      <div className="w-full max-w-sm">
        {children}
      </div>
      <p className="text-[10px] text-slate-400 flex items-center gap-1">
        <svg viewBox="0 0 16 16" fill="none" className="w-3 h-3"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" /><path d="M5 8h6M8 5v6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        Secured by Solana · Powered by Triangle
      </p>
    </div>);

}


function CopyBlinkButton({ text, label }) {
  const [copied, setCopied] = useState(false);
  async function doCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  }
  return (
    <button
      type="button"
      onClick={doCopy}
      title={`Copy ${label}`}
      className="shrink-0 flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-all cursor-pointer"
      style={copied ?
      { background: '#d1fae5', color: '#065f46' } :
      { background: 'rgba(109,40,217,0.08)', color: '#6d28d9' }}>
      
      {copied ?
      <><svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5"><path d="M3 8l3 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg> Copied</> :
      <><svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5"><rect x="5" y="5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" /><path d="M11 5V4a1 1 0 00-1-1H4a1 1 0 00-1 1v6a1 1 0 001 1h1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg> {label}</>
      }
    </button>);

}


function ShareBlinkPanel({ dealId }) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const actionUrl = `${origin}/api/actions/deal/${dealId}`;
  const blinkUrl = `https://dial.to/?action=solana-action:${encodeURIComponent(actionUrl)}`;
  const dealUrl = `${origin}/deals/${dealId}`;
  const isLocalhost = origin.includes('localhost') || origin.includes('127.0.0.1');

  return (
    <div className="mt-4 rounded-2xl border border-(--border) bg-white overflow-hidden">
      {}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-(--border) bg-slate-50/60">
        <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5 text-(--accent) shrink-0">
          <path d="M10 2l4 4-4 4M14 6H6a4 4 0 000 8h1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-[11px] font-semibold text-(--text-secondary) uppercase tracking-widest">Share as Blink</span>
      </div>

      <div className="px-4 py-3 space-y-2.5">
        {}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-(--text-tertiary) mb-1">Deal link</p>
          <div className="flex items-center gap-2 rounded-xl border border-(--border) bg-slate-50 px-3 py-2">
            <span className="flex-1 text-[11px] text-(--text-secondary) truncate font-mono">{dealUrl}</span>
            <CopyBlinkButton text={dealUrl} label="Copy" />
          </div>
        </div>

        {}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-(--text-tertiary) mb-1">
            Solana Blink URL
            <span className="ml-1.5 font-normal normal-case tracking-normal text-(--text-tertiary)">— share in Twitter/X, Telegram, Dialect</span>
          </p>
          <div className="flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50/60 px-3 py-2">
            <span className="flex-1 text-[11px] text-violet-700 truncate font-mono">{blinkUrl}</span>
            <CopyBlinkButton text={blinkUrl} label="Copy" />
          </div>
        </div>

        {}
        {!isLocalhost &&
        <a
          href={blinkUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 w-full rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-[11px] font-semibold text-violet-700 hover:bg-violet-100 transition-colors">
          
            <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5">
              <path d="M8 2H3a1 1 0 00-1 1v10a1 1 0 001 1h10a1 1 0 001-1V8M10 2h4v4M14 2L8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Preview in Dial.to
          </a>
        }
      </div>
    </div>);

}

export default function DealDetailPage() {
  const { dealId } = useParams();
  const [searchParams] = useSearchParams();
  const isBlinkView = searchParams.has('blink');

  const { user: privyUser } = usePrivy();
  const api = useAuthApi();
  const { wallets, ready: solWalletsReady } = useSolanaWallets();
  const { signAndSendTransaction } = useSignAndSendTransaction();

  const [deal, setDeal] = useState(null);
  const [messages, setMessages] = useState([]);
  const [chatError, setChatError] = useState('');
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [accepting, setAccepting] = useState(false);
  const [sending, setSending] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [callingSupport, setCallingSupport] = useState(false);
  const [escrowBusy, setEscrowBusy] = useState(false);
  const [escrowNotice, setEscrowNotice] = useState(null);

  const [rwaDepositAmount, setRwaDepositAmount] = useState('');

  const solAddress = useTriangleSolanaAddress();
  const isSupport = useIsSupport();

  const solWallet = useMemo(() => {
    if (!solAddress?.trim() || !wallets?.length) return null;
    const want = solAddress.trim();
    return wallets.find((w) => w.address === want) ?? null;
  }, [solAddress, wallets]);

  const loadDeal = useCallback(async () => {
    const { deal: d } = await api(`/deals/${dealId}`);
    setDeal(d);
  }, [api, dealId]);

  useEffect(() => {
    setEscrowNotice(null);
  }, [dealId]);

  const loadMessages = useCallback(async () => {
    try {
      const { messages: m } = await api(`/deals/${dealId}/messages`);
      setMessages(m || []);
      setChatError('');
    } catch (e) {
      setChatError(e.message || '');
      setMessages([]);
    }
  }, [api, dealId]);

  const refreshDealAndMessages = useCallback(async () => {
    await loadDeal();
    await loadMessages();
  }, [loadDeal, loadMessages]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const email = privyUser?.email?.address ?? null;
        await api('/auth/sync', {
          method: 'POST',
          body: JSON.stringify({ email, solana_address: solAddress ?? null })
        });
        if (cancelled) return;
        await loadDeal();
        if (!cancelled) setErr('');
      } catch (e) {
        if (!cancelled) setErr(e.message || 'Failed to load deal');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {cancelled = true;};
  }, [api, loadDeal, privyUser?.email?.address, solAddress]);

  useEffect(() => {
    if (loading) return undefined;
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      loadDeal().catch(() => {});
    }, POLL_MS);
    return () => clearInterval(id);
  }, [loading, loadDeal]);

  useEffect(() => {
    if (!deal?.seller) return undefined;
    const supportModerating = isSupport && deal.support_requested;
    const participantChat =
    ['accepted', 'disputed', 'cancelled'].includes(deal.status) && (
    deal.role === 'creator' || deal.role === 'seller');
    if (!supportModerating && !participantChat) return undefined;
    loadMessages();
    const t = setInterval(loadMessages, POLL_MS);
    return () => clearInterval(t);
  }, [deal, loadMessages, isSupport]);

  function txFromBase64(b64) {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return Transaction.from(u8);
  }

  async function signSendPreparedTx(preparePath, prepareBody) {
    if (!solAddress?.trim()) throw new Error('No Solana address on your profile. Link a wallet in Privy.');
    if (!solWallet) {
      throw new Error(
        `Sign with the wallet matching your Triangle address (${solAddress.slice(0, 4)}…${solAddress.slice(-4)}). In MetaMask, pick that same Solana account, or use your Privy embedded wallet.`
      );
    }
    const prep = await api(preparePath, {
      method: 'POST',
      body: JSON.stringify(prepareBody || {})
    });
    const tx = txFromBase64(prep.transactionBase64);
    let result;
    try {
      result = await signAndSendTransaction({
        transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }),
        wallet: solWallet,
        chain: 'solana:devnet'
      });
    } catch (e) {
      throw new Error(formatWalletTxError(e));
    }
    const sig = result?.signature;
    if (typeof sig === 'string') return sig;
    if (sig instanceof Uint8Array) return bs58.encode(sig);
    throw new Error('Unexpected signature format from wallet');
  }

  async function onInitEscrow() {
    setEscrowBusy(true);
    setErr('');
    setEscrowNotice(null);
    try {
      const sig = await signSendPreparedTx(`/deals/${dealId}/escrow/prepare-init`, {});
      await api(`/deals/${dealId}/escrow/ack-init`, {
        method: 'POST',
        body: JSON.stringify({ signature: sig })
      });
      await loadDeal();
    } catch (e) {
      setErr(e.message || 'Could not create escrow');
    } finally {
      setEscrowBusy(false);
    }
  }

  async function onReleaseToSeller() {
    setEscrowBusy(true);
    setErr('');
    setEscrowNotice(null);
    try {
      const sig = await signSendPreparedTx(`/deals/${dealId}/escrow/prepare-release`, {});
      await api(`/deals/${dealId}/escrow/ack-release`, {
        method: 'POST',
        body: JSON.stringify({ signature: sig })
      });
      await loadDeal();
      await loadMessages();
    } catch (e) {
      setErr(e.message || 'Could not release funds');
    } finally {
      setEscrowBusy(false);
    }
  }

  async function onDepositEscrow() {
    setEscrowBusy(true);
    setErr('');
    setEscrowNotice(null);
    try {
      await signSendPreparedTx(`/deals/${dealId}/escrow/prepare-deposit`, {});
      await api(`/deals/${dealId}/escrow/sync`, { method: 'POST', body: '{}' });
      await loadDeal();
    } catch (e) {
      const msg = e.message || 'Deposit failed';
      if (msg.includes('fully funded')) {
        try {
          await api(`/deals/${dealId}/escrow/sync`, { method: 'POST', body: '{}' });
          await loadDeal();
          setErr('');
        } catch {
          setErr(msg);
        }
      } else {
        setErr(msg);
      }
    } finally {
      setEscrowBusy(false);
    }
  }

  async function onCheckPayment() {
    setErr('');
    setEscrowNotice(null);
    try {
      const data = await api(`/deals/${dealId}/escrow/sync`, { method: 'POST', body: '{}' });
      const d = data.deal;
      if (d) setDeal(d);else
      await loadDeal();

      const fmtSol = (lamports) => {
        const n = Number(BigInt(lamports ?? '0')) / 1e9;
        if (!Number.isFinite(n)) return '0';
        const s = n.toFixed(6).replace(/\.?0+$/, '');
        return s || '0';
      };

      if (!d?.escrow_pda) {
        setEscrowNotice({
          variant: 'info',
          text: 'Escrow is not created yet. Use “Create Escrow”, then send SOL to the escrow address shown above.'
        });
        return;
      }

      const c = data.chain;
      if (!c) {
        setEscrowNotice({ variant: 'warning', text: 'Could not read on-chain escrow data. Try again in a moment.' });
        return;
      }
      if (!c.exists) {
        setEscrowNotice({
          variant: 'warning',
          text: 'This escrow account is no longer on-chain (released or closed).'
        });
        return;
      }

      const st = d.escrow_status;
      const sp = BigInt(c.spendableLamports ?? '0');
      const exp = BigInt(c.expectedLamports ?? '0');

      if (st === 'funded') {
        setEscrowNotice({
          variant: 'success',
          text: 'Escrow is fully funded on-chain. Creator can release to the counterparty when ready.'
        });
      } else if (st === 'awaiting_confirm') {
        setEscrowNotice({
          variant: 'success',
          text: 'Funds detected on-chain. Creator: tap “Finalize on-chain” to complete the deposit.'
        });
      } else if (exp > 0n && sp >= exp) {
        setEscrowNotice({
          variant: 'success',
          text: `Full amount received (${fmtSol(c.spendableLamports)} SOL). If the status still looks wrong, tap Check payment again.`
        });
      } else if (sp > 0n) {
        setEscrowNotice({
          variant: 'info',
          text: `Partial deposit: ${fmtSol(c.spendableLamports)} SOL in escrow, expected ${fmtSol(c.expectedLamports)} SOL total.`
        });
      } else {
        setEscrowNotice({
          variant: 'info',
          text: 'No SOL in the escrow account yet. Send payment to the escrow PDA, wait for confirmation, then check again.'
        });
      }
    } catch (e) {
      setErr(e.message || 'Sync failed');
    }
  }


  useEffect(() => {
    if (!deal?.rwa_vault_ata || !deal?.rwa_escrow_pda) return undefined;
    if (deal.escrow_status === 'released' || deal.escrow_status === 'refunded') return undefined;
    const isParticipant = deal.role === 'creator' || deal.role === 'seller';
    if (!isParticipant) return undefined;

    const es = new EventSource(`/api/deals/${dealId}/events`, { withCredentials: true });
    es.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data);
        if (evt.type === 'vault_transfer' || evt.type === 'deposit_confirmed') {

          api(`/deals/${dealId}/rwa-escrow/sync`, { method: 'POST', body: '{}' }).
          then((d) => {if (d?.deal) setDeal(d.deal);}).
          catch(() => loadDeal());
        }
      } catch {}
    };
    return () => es.close();
  }, [deal?.rwa_vault_ata, deal?.rwa_escrow_pda, deal?.escrow_status, deal?.role, dealId, api, loadDeal]);



  async function onInitRwaEscrow() {
    setEscrowBusy(true);
    setErr('');
    setEscrowNotice(null);
    try {
      const prep = await api(`/deals/${dealId}/rwa-escrow/prepare-init`, { method: 'POST', body: '{}' });
      const sig = await (async () => {
        if (!solAddress?.trim()) throw new Error('No Solana address on your profile.');
        if (!solWallet) throw new Error('Connect the wallet matching your Triangle address.');
        const { Transaction: Tx } = await import('@solana/web3.js');
        const bin = atob(prep.transactionBase64);
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        const tx = Tx.from(u8);
        let result;
        try {
          result = await signAndSendTransaction({
            transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }),
            wallet: solWallet,
            chain: 'solana:devnet'
          });
        } catch (e) {throw new Error(formatWalletTxError(e));}
        const s = result?.signature;
        if (typeof s === 'string') return s;
        if (s instanceof Uint8Array) return bs58.encode(s);
        throw new Error('Unexpected signature format');
      })();
      await api(`/deals/${dealId}/rwa-escrow/ack-init`, {
        method: 'POST',
        body: JSON.stringify({ signature: sig, expectedTokenAmount: prep.expectedTokenAmount })
      });
      await loadDeal();
    } catch (e) {
      setErr(e.message || 'Could not init RWA escrow');
    } finally {
      setEscrowBusy(false);
    }
  }

  async function onDepositRwaTokens() {
    setEscrowBusy(true);
    setErr('');
    setEscrowNotice(null);
    try {

      let amountRaw = undefined;
      if (rwaDepositAmount.trim()) {
        const decimals = deal?.rwa_collateral_decimals ?? 6;
        const whole = parseFloat(rwaDepositAmount);
        if (!Number.isFinite(whole) || whole <= 0) throw new Error('Invalid deposit amount');
        amountRaw = String(Math.round(whole * Math.pow(10, decimals)));
      }
      const prepBody = amountRaw ? JSON.stringify({ amountRaw }) : '{}';
      const prep = await api(`/deals/${dealId}/rwa-escrow/prepare-deposit`, { method: 'POST', body: prepBody });
      const sig = await signSendPreparedTxFromPrep(prep);
      await api(`/deals/${dealId}/rwa-escrow/ack-deposit`, {
        method: 'POST',
        body: JSON.stringify({ signature: sig })
      });
      setRwaDepositAmount('');
      await loadDeal();
    } catch (e) {
      setErr(e.message || 'Deposit failed');
    } finally {
      setEscrowBusy(false);
    }
  }

  async function onReleaseRwaEscrow() {
    setEscrowBusy(true);
    setErr('');
    setEscrowNotice(null);
    try {
      const prep = await api(`/deals/${dealId}/rwa-escrow/prepare-release`, { method: 'POST', body: '{}' });
      const sig = await signSendPreparedTxFromPrep(prep);
      await api(`/deals/${dealId}/rwa-escrow/ack-release`, {
        method: 'POST',
        body: JSON.stringify({ signature: sig })
      });
      await loadDeal();
    } catch (e) {
      setErr(e.message || 'Release failed');
    } finally {
      setEscrowBusy(false);
    }
  }


  async function signSendPreparedTxFromPrep(prep) {
    if (!solAddress?.trim()) throw new Error('No Solana address on your profile.');
    if (!solWallet) throw new Error('Connect the wallet matching your Triangle address.');
    const tx = txFromBase64(prep.transactionBase64);
    let result;
    try {
      result = await signAndSendTransaction({
        transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }),
        wallet: solWallet,
        chain: 'solana:devnet'
      });
    } catch (e) {throw new Error(formatWalletTxError(e));}
    const sig = result?.signature;
    if (typeof sig === 'string') return sig;
    if (sig instanceof Uint8Array) return bs58.encode(sig);
    throw new Error('Unexpected signature format from wallet');
  }


  async function onPaySol(amountSol) {
    const prep = await api(`/deals/${dealId}/prepare-sol-payment`, {
      method: 'POST',
      body: JSON.stringify({ amount_sol: amountSol })
    });
    const sig = await signSendPreparedTxFromPrep(prep);
    const d = await api(`/deals/${dealId}/ack-sol-payment`, {
      method: 'POST',
      body: JSON.stringify({ signature: sig, amount_lamports: prep.amount_lamports })
    });
    if (d?.deal) setDeal(d.deal);
  }

  async function onAccept() {
    setAccepting(true);
    setErr('');
    try {
      const { deal: d } = await api(`/deals/${dealId}/accept`, { method: 'POST' });
      setDeal(d);
      await loadMessages();
    } catch (e) {
      setErr(e.message || 'Could not accept deal');
    } finally {
      setAccepting(false);
    }
  }

  async function onCallSupport() {
    setCallingSupport(true);
    setErr('');
    try {
      const { deal: d } = await api(`/deals/${dealId}/request-support`, { method: 'POST' });
      setDeal(d);
    } catch (e) {
      setErr(e.message || 'Could not call support');
    } finally {
      setCallingSupport(false);
    }
  }

  async function onSend(e) {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    if (deal?.status === 'cancelled') return;
    setSending(true);
    setErr('');
    try {
      await api(`/deals/${dealId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: text })
      });
      setBody('');
      await loadMessages();
    } catch (e) {
      setErr(e.message || 'Could not send message');
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    const content =
    <p className="py-8 text-center text-sm text-(--text-tertiary)">Loading deal…</p>;

    if (isBlinkView) return <BlinkShell>{content}</BlinkShell>;
    return (
      <PageChrome>
        {content}
      </PageChrome>);

  }

  if (err && !deal) {
    const content =
    <div className="rounded-[20px] border border-red-100 bg-red-50 px-5 py-4 mt-6">
        <p className="text-sm font-medium text-red-800">{err}</p>
      </div>;

    if (isBlinkView) return <BlinkShell>{content}</BlinkShell>;
    return (
      <PageChrome>
        {content}
      </PageChrome>);

  }


  const canAccept = deal?.status === 'open' && !deal?.seller && deal?.role === 'viewer';
  const supportModerating = Boolean(isSupport && deal?.support_requested);
  const chatLive =
  Boolean(deal?.seller) &&
  ['accepted', 'disputed', 'cancelled'].includes(deal?.status) && (
  deal?.role === 'creator' || deal?.role === 'seller' || supportModerating);

  const amountDisplay =
  deal?.amount != null ? formatDealAmount(deal.amount) ?? deal.amount : '—';

  const showEscrowUi =
  Boolean(deal?.escrow_program_configured) && (
  ['accepted', 'disputed'].includes(deal?.status ?? '') ||
  deal?.status === 'cancelled' && Boolean(deal?.escrow_pda));
  const escrowComplete = ['released', 'refunded', 'liquidated'].includes(deal?.escrow_status || '');
  const creatorCanFund =
  deal?.role === 'creator' &&
  showEscrowUi &&
  deal?.status !== 'cancelled' &&
  solWalletsReady &&
  Boolean(solWallet);
  const solWalletMismatch =
  deal?.role === 'creator' &&
  showEscrowUi &&
  deal?.status !== 'cancelled' &&
  solWalletsReady &&
  Boolean(solAddress) &&
  wallets.length > 0 &&
  !solWallet;


  const isRwaDeal = deal?.escrow_kind === 'rwa';

  function resolvePrimaryAction() {
    if (canAccept) {
      return {
        label: accepting ? 'Accepting…' : 'Accept deal',
        onClick: onAccept,
        disabled: accepting,
        variant: 'emerald'
      };
    }
    if (escrowComplete) return null;
    if (deal?.role !== 'creator') return null;
    if (!showEscrowUi || deal?.status === 'cancelled') return null;

    const walletOk = creatorCanFund;
    const es = deal?.escrow_status || 'awaiting_funds';


    if (isRwaDeal) {
      const hasRwaPda = Boolean(deal?.rwa_escrow_pda);
      if (!hasRwaPda) return null;
      if (deal?.status === 'disputed' && es === 'funded') return null;
      if (es === 'awaiting_funds') {
        return {
          label: escrowBusy ? 'Working…' : 'Deposit rwaGOLD',
          onClick: onDepositRwaTokens,
          disabled: escrowBusy || !walletOk,
          variant: 'violet'
        };
      }
      if (es === 'funded') {
        const solFullyPaid = Number(deal.amount || 0) > 0 && Number(deal.sol_paid_lamports || '0') >= Number(deal.amount || 0) * 1e9;
        if (solFullyPaid) return null;
        return {
          label: escrowBusy ? 'Releasing…' : 'Release to counterparty',
          onClick: onReleaseRwaEscrow,
          disabled: escrowBusy || !walletOk,
          variant: 'emerald'
        };
      }
      return null;
    }


    const hasPda = Boolean(deal?.escrow_pda);
    if (!hasPda) return null;
    if (deal?.status === 'disputed' && (es === 'funded' || es === 'awaiting_confirm')) return null;

    if (es === 'awaiting_funds') {
      return {
        label: escrowBusy ? 'Working…' : 'Deposit SOL to escrow',
        onClick: onDepositEscrow,
        disabled: escrowBusy || !walletOk,
        variant: 'violet'
      };
    }
    if (es === 'awaiting_confirm') {
      return {
        label: escrowBusy ? 'Working…' : 'Finalize on-chain',
        onClick: onDepositEscrow,
        disabled: escrowBusy || !walletOk,
        variant: 'violet'
      };
    }
    if (es === 'funded') {
      return {
        label: escrowBusy ? 'Sending…' : 'Release to counterparty',
        onClick: onReleaseToSeller,
        disabled: escrowBusy || !walletOk,
        variant: 'emerald'
      };
    }
    return null;
  }

  const primaryAction = resolvePrimaryAction();

  const dealCard =
  <div className="overflow-hidden rounded-[20px] border deal-card-border bg-white deal-shadow animate-fade-up">
      <SecurityBanner deal={deal} />

      <div className="px-5 pb-6 pt-5 sm:px-7 sm:pb-8 sm:pt-6">

        <div className="flex items-center">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-(--text-tertiary)">
            {NETWORK_LABEL[deal.network] || deal.network}
          </p>
        </div>

        <div className="mt-5 flex items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-(--text-tertiary) mb-1">
              Amount
            </p>
            <p
            className="tabular-nums text-[38px] font-semibold leading-none tracking-tight text-(--text-primary) sm:text-[46px]"
            aria-label={`${amountDisplay} ${isRwaDeal ? 'SOL' : deal.asset}`}>
            
              {amountDisplay}
              <span className="ml-2 text-[22px] font-medium text-(--text-tertiary) sm:text-[28px]">
                {isRwaDeal ? 'SOL' : deal.asset}
              </span>
            </p>
          </div>
          <DealStatusBadge deal={deal} />
        </div>

        <div className="mt-6 border-t border-(--border) pt-5 space-y-3">
          <FullAddressRow label="Creator" address={deal.creator?.address} />
          <FullAddressRow label="Seller" address={deal.seller?.address} />
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-(--text-tertiary)">
              Your role
            </p>
            <p className="text-xs font-medium capitalize text-(--text-secondary)">
              {supportModerating ? 'Support' : deal.role}
            </p>
          </div>
        </div>

        {supportModerating ?
      <SupportModerationBlock deal={deal} dealId={dealId} api={api} onRefresh={refreshDealAndMessages} /> :
      null}

        {showEscrowUi && isRwaDeal && deal.escrow_status === 'funded' && !escrowComplete ?
      <SolPaymentBlock
        deal={deal}
        dealId={dealId}
        onPaySol={onPaySol}
        onRefresh={(updated) => {if (updated) setDeal(updated);else loadDeal();}} /> :

      null}

        {showEscrowUi && isRwaDeal ?
      <RwaEscrowBlock deal={deal} escrowComplete={escrowComplete} /> :
      showEscrowUi ?
      <ProgramEscrowBlock deal={deal} escrowComplete={escrowComplete} /> :
      null}

        {solWalletMismatch ?
      <div className="mt-4">
            <InlineAlert variant="warning">
              Sign with the wallet matching your Triangle address:{' '}
              <span className="font-mono">
                {solAddress?.slice(0, 6)}…{solAddress?.slice(-4)}
              </span>
            </InlineAlert>
          </div> :
      null}
        {showEscrowUi && deal.role === 'creator' && !solWallet && !solWalletMismatch ?
      <div className="mt-4">
            <InlineAlert variant="warning">Connect a Solana wallet in Privy to use escrow.</InlineAlert>
          </div> :
      null}

        {err ?
      <div className="mt-4">
            <InlineAlert variant="error">{err}</InlineAlert>
          </div> :
      null}

        {escrowNotice ?
      <div className="mt-4">
            <InlineAlert variant={escrowNotice.variant}>{escrowNotice.text}</InlineAlert>
          </div> :
      null}

        <div className="mt-6 space-y-2.5">
          {}
          {isRwaDeal && deal.role === 'creator' && deal.rwa_escrow_pda &&
        deal.escrow_status === 'awaiting_funds' && !escrowComplete ?
        <div>
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-(--text-tertiary)">
                  Deposit amount (rwaGOLD tokens, blank = deposit remaining)
                </span>
                <input
              type="number"
              min="0"
              step="any"
              value={rwaDepositAmount}
              onChange={(e) => setRwaDepositAmount(e.target.value)}
              placeholder="Leave blank to deposit full remaining"
              className="w-full rounded-2xl border border-(--border) bg-slate-50/60 px-4 py-2.5 text-sm text-(--text-primary) outline-none transition-all placeholder:text-(--text-tertiary) focus:border-(--accent-border) focus:bg-white focus:ring-2 focus:ring-(--accent-light)" />
            
              </label>
            </div> :
        null}

          {primaryAction ?
        <PrimaryButton
          onClick={primaryAction.onClick}
          disabled={primaryAction.disabled}
          variant={primaryAction.variant}>
          
              {primaryAction.label}
            </PrimaryButton> :
        null}

          {deal.role === 'creator' && deal.status === 'open' ?
        <p className="py-1 text-center text-xs text-(--text-tertiary)">
              Share this link with your counterparty to get started
            </p> :
        null}

          <div className="flex gap-2 pt-0.5">
            {}
            <GhostButton
            onClick={isRwaDeal ?
            async () => {
              try {
                const d = await api(`/deals/${dealId}/rwa-escrow/sync`, { method: 'POST', body: '{}' });
                if (d?.deal) setDeal(d.deal);
              } catch (e) {setErr(e.message || 'Sync failed');}
            } :
            onCheckPayment}
            disabled={!deal?.escrow_program_configured || escrowBusy}>
            
              {isRwaDeal ? 'Sync vault' : 'Check payment'}
            </GhostButton>

            {}
            {showEscrowUi && !escrowComplete ?
          isRwaDeal && !deal.rwa_escrow_pda ?
          <GhostButton onClick={onInitRwaEscrow} disabled={!creatorCanFund || escrowBusy} accent>
                  {escrowBusy ? 'Creating…' : 'Init RWA Escrow'}
                </GhostButton> :
          !isRwaDeal && !deal.escrow_pda ?
          <GhostButton onClick={onInitEscrow} disabled={!creatorCanFund || escrowBusy} accent>
                  {escrowBusy ? 'Creating…' : 'Create Escrow'}
                </GhostButton> :
          null :
          null}

            {supportModerating ? null : deal.support_requested ?
          <GhostButton disabled>
                ✓ Support called
              </GhostButton> :

          <GhostButton onClick={onCallSupport} disabled={callingSupport} accent>
                {callingSupport ? 'Calling…' : 'Call Support'}
              </GhostButton>
          }
          </div>

        </div>
      </div>
    </div>;


  if (isBlinkView) {
    return (
      <BlinkShell>
        {dealCard}
        <ShareBlinkPanel dealId={dealId} />
        <SupportModal open={supportOpen} onClose={() => setSupportOpen(false)} />
      </BlinkShell>);

  }

  return (
    <PageChrome>
      <div className="mx-auto mt-6 max-w-md">
        {dealCard}
        <ShareBlinkPanel dealId={dealId} />

        {chatLive ?
        <ChatSection
          messages={messages}
          chatError={chatError}
          escrowComplete={escrowComplete}
          escrowStatus={deal?.escrow_status}
          body={body}
          setBody={setBody}
          sending={sending}
          onSend={onSend}
          chatReadOnly={deal?.status === 'cancelled'} /> :

        deal?.status === 'open' ?
        <p className="mt-5 text-center text-xs text-(--text-tertiary)">
            Chat opens after the deal is accepted.
          </p> :
        null}

      </div>

      <SupportModal open={supportOpen} onClose={() => setSupportOpen(false)} />
    </PageChrome>);

}