import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usePrivy } from '@privy-io/react-auth';
import { useAuthApi } from '../useAuthApi.js';
import { AmbientBg } from '../components/PageChrome.jsx';
import { useTriangleSolanaAddress } from '../useTriangleSolanaAddress.js';
import { formatDealAmount } from '../formatAmount.js';

const STATUS_STYLE = {
  open: 'bg-slate-100 text-slate-500',
  accepted: 'bg-[--accent-light] text-[--accent]',
  funded: 'bg-emerald-50 text-emerald-700',
  released: 'bg-emerald-50 text-emerald-600',
  refunded: 'bg-amber-50 text-amber-700'
};

const AVATAR_KEY = 'triangle_avatar_url';

function Avatar({ imageUrl, size = 48, onClick }) {
  return (
    <div
      className={`relative rounded-full shrink-0 overflow-hidden bg-slate-200 ${onClick ? 'cursor-pointer group' : ''}`}
      style={{ width: size, height: size }}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      aria-label={onClick ? 'Change avatar photo' : 'User avatar'}>
      
      {imageUrl &&
      <img
        src={imageUrl}
        alt="Avatar"
        className="w-full h-full object-cover" />

      }
      {onClick &&
      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
        </div>
      }
    </div>);

}

function StatCard({ label, value, sub, accent }) {
  return (
    <div
      className="rounded-2xl border p-5 transition-all"
      style={{
        borderColor: accent ? 'oklch(89% 0.05 283)' : 'oklch(91% 0.02 280)',
        background: accent ? 'oklch(97% 0.025 283)' : 'rgba(255,255,255,0.7)',
        backdropFilter: 'blur(12px)'
      }}>
      
      <p className="text-[10px] font-semibold uppercase tracking-widest text-[--text-tertiary] mb-2">{label}</p>
      <p className={`text-2xl font-bold tracking-tight ${accent ? 'text-[--accent]' : 'text-[--text-primary]'}`}>
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-[--text-tertiary]">{sub}</p>}
    </div>);

}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="text-[10px] font-semibold text-[--accent] hover:opacity-75 transition-opacity cursor-pointer shrink-0">
      
      {copied ? 'Copied' : 'Copy'}
    </button>);

}

export default function ProfilePage() {
  const { user: privyUser } = usePrivy();
  const api = useAuthApi();
  const navigate = useNavigate();
  const solAddress = useTriangleSolanaAddress();

  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [avatarUrl, setAvatarUrl] = useState(() => localStorage.getItem(AVATAR_KEY) || '');

  function handleAvatarUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const url = ev.target.result;
      setAvatarUrl(url);
      localStorage.setItem(AVATAR_KEY, url);
    };
    reader.readAsDataURL(file);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const email = privyUser?.email?.address ?? null;
        await api('/auth/sync', {
          method: 'POST',
          body: JSON.stringify({ email, solana_address: solAddress ?? null })
        });
        const { deals: list } = await api('/deals');
        if (!cancelled) setDeals(list || []);
      } catch (e) {
        if (!cancelled) setErr(e.message || 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {cancelled = true;};
  }, [api, privyUser?.email?.address, solAddress]);

  const myDeals = deals.filter((d) => d.role === 'creator' || d.role === 'seller');
  const total = myDeals.length;
  const successful = myDeals.filter((d) => d.escrow_status === 'released').length;
  const refunded = myDeals.filter((d) => d.escrow_status === 'refunded').length;
  const open = myDeals.filter((d) => d.status === 'open').length;

  const totalVolume = myDeals.
  filter((d) => d.escrow_status === 'released').
  reduce((sum, d) => sum + (parseFloat(d.amount) || 0), 0);

  const recent = [...deals].slice(0, 6);

  const email = privyUser?.email?.address;

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <AmbientBg />
        <div className="flex gap-1.5">
          {[0, 1, 2].map((i) =>
          <div key={i} className="h-2 w-2 rounded-full bg-[--accent-border] animate-pulse"
          style={{ animationDelay: `${i * 0.15}s` }} />
          )}
        </div>
      </div>);

  }

  return (
    <div className="min-h-dvh px-4 py-8 sm:px-6">
      <AmbientBg />
      <div className="mx-auto max-w-5xl animate-fade-up">

        <div className="grid lg:grid-cols-3 gap-5 mb-5">

          <div
            className="lg:col-span-1 rounded-[20px] border p-6 flex flex-col gap-5"
            style={{
              background: 'rgba(255,255,255,0.80)',
              backdropFilter: 'blur(16px)',
              borderColor: 'oklch(91% 0.02 280)',
              boxShadow: 'var(--shadow-card)'
            }}>
            
            <div className="flex items-center gap-4">
              <label className="cursor-pointer shrink-0">
                <Avatar imageUrl={avatarUrl} size={56} />
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={handleAvatarUpload}
                  aria-label="Upload avatar photo" />
                
              </label>
              <div className="min-w-0">
                {email &&
                <p className="text-sm font-semibold text-[--text-primary] truncate">{email}</p>
                }
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[--text-tertiary] mt-0.5">
                  Solana Devnet
                </p>
                <p className="text-[10px] text-[--text-tertiary] mt-0.5 cursor-pointer hover:text-[--accent] transition-colors">
                  Tap avatar to change photo
                </p>
              </div>
            </div>

            <div
              className="rounded-2xl p-3"
              style={{ background: 'oklch(97% 0.02 280)' }}>
              
              <div className="flex items-center justify-between mb-1">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[--text-tertiary]">
                  Wallet address
                </p>
                {solAddress && <CopyButton text={solAddress} />}
              </div>
              <p className="font-mono text-[11px] text-[--text-secondary] break-all leading-relaxed">
                {solAddress || 'No wallet linked'}
              </p>
            </div>

          </div>

          <div className="lg:col-span-2 grid grid-cols-2 sm:grid-cols-2 gap-4">
            <StatCard
              label="Total deals"
              value={total}
              sub={`${open} open now`} />
            
            <StatCard
              label="Successful"
              value={successful}
              sub={total > 0 ? `${Math.round(successful / total * 100)}% success rate` : 'тАФ'}
              accent />
            
            <StatCard
              label="Refunded"
              value={refunded}
              sub="escrow refunded" />
            
            <StatCard
              label="SOL volume"
              value={totalVolume > 0 ? `${totalVolume.toFixed(2)} SOL` : 'тАФ'}
              sub="released on-chain" />
            
          </div>
        </div>

        <div
          className="rounded-[20px] border overflow-hidden"
          style={{
            background: 'rgba(255,255,255,0.80)',
            backdropFilter: 'blur(16px)',
            borderColor: 'oklch(91% 0.02 280)',
            boxShadow: 'var(--shadow-card)'
          }}>
          
          <div className="flex items-center justify-between px-6 py-4 border-b border-[--border]">
            <p className="text-sm font-semibold text-[--text-primary]">Recent deals</p>
            <Link
              to="/deals"
              className="text-xs font-semibold text-[--accent] hover:opacity-75 transition-opacity">
              
              View all тЖТ
            </Link>
          </div>

          {recent.length === 0 ?
          <div className="flex flex-col items-center py-14 text-center">
              <p className="text-sm font-medium text-[--text-secondary]">No deals yet</p>
              <p className="mt-1 text-xs text-[--text-tertiary]">Create your first deal to get started</p>
              <Link
              to="/deals/new"
              className="mt-5 rounded-full px-5 py-2 text-xs font-semibold text-white hover:brightness-110 transition-all"
              style={{ background: 'hsl(260 25% 11%)' }}>
              
                Make a deal
              </Link>
            </div> :

          <div className="divide-y divide-[--border]">
              {recent.map((d) =>
            <button
              key={d.id}
              type="button"
              onClick={() => navigate(`/deals/${d.id}`)}
              className="w-full flex items-center gap-4 px-6 py-4 hover:bg-[--accent-light]/30 transition-colors text-left cursor-pointer group">
              
                  <div
                className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-[--accent] group-hover:scale-105 transition-transform"
                style={{ background: 'oklch(97% 0.025 283)' }}>
                
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M21 8V5a2 2 0 0 0-2-2h-3" />
                      <path d="M3 16v3a2 2 0 0 0 2 2h3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" />
                    </svg>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-semibold text-[--text-primary] font-mono">
                        {d.id.slice(0, 8)}тАж
                      </p>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${STATUS_STYLE[d.escrow_status ?? d.status] ?? STATUS_STYLE[d.status] ?? 'bg-slate-100 text-slate-500'}`}>
                        {d.escrow_status ?? d.status}
                      </span>
                    </div>
                    <p className="text-[11px] text-[--text-tertiary] mt-0.5 capitalize">
                      {d.role} ┬╖ {d.asset} ┬╖ {d.created_at ? new Date(d.created_at).toLocaleDateString() : ''}
                    </p>
                  </div>

                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-[--text-primary] font-mono">
                      {d.amount != null ? formatDealAmount(d.amount) ?? d.amount : 'тАФ'}
                    </p>
                    <p className="text-[10px] text-[--text-tertiary]">{d.asset}</p>
                  </div>
                </button>
            )}
            </div>
          }
        </div>

        {err &&
        <div className="mt-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3">
            <p className="text-xs text-red-800">{err}</p>
          </div>
        }
      </div>
    </div>);

}