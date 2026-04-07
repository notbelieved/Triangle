import { useCallback, useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { AmbientBg } from '../components/PageChrome.jsx'
import { useAuthApi } from '../useAuthApi.js'
import { useIsSupport } from '../useIsSupport.js'

const cardShell = {
  background: 'rgba(255, 255, 255, 0.86)',
  backdropFilter: 'blur(18px)',
  borderColor: 'oklch(91% 0.02 280)',
  boxShadow: 'var(--shadow-card)',
}

const STATUS_STYLE = {
  open: 'bg-slate-100 text-slate-600',
  accepted: 'bg-(--accent-light) text-(--accent)',
  funded: 'bg-(--mint-light) text-(--mint)',
  released: 'bg-emerald-50 text-emerald-700',
  refunded: 'bg-amber-50 text-amber-800',
  awaiting_funds: 'bg-slate-100 text-slate-600',
  awaiting_confirm: 'bg-sky-50 text-sky-800',
}

function IconShield({ className = 'w-5 h-5' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  )
}

function IconChevron({ open }) {
  return (
    <span
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-(--border) bg-white/80 text-(--text-tertiary) transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M6 9l6 6 6-6" />
      </svg>
    </span>
  )
}

function Badge({ value }) {
  const v = (value || '').replace(/_/g, ' ')
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold capitalize ${STATUS_STYLE[value] ?? 'bg-slate-100 text-slate-500'}`}
    >
      {v || '—'}
    </span>
  )
}

function AddressBox({ label, address }) {
  const [copied, setCopied] = useState(false)
  if (!address) {
    return (
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-(--text-tertiary) mb-1">{label}</p>
        <p className="text-xs text-(--text-tertiary)">—</p>
      </div>
    )
  }
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-(--text-tertiary)">{label}</p>
        <button
          type="button"
          className="text-[10px] font-semibold text-(--accent) hover:opacity-80 cursor-pointer"
          onClick={async () => {
            await navigator.clipboard.writeText(address).catch(() => {})
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className="font-mono text-[11px] text-(--text-secondary) break-all leading-relaxed">{address}</p>
    </div>
  )
}

function ProgramStatusCard({ programStatus, programBusy, onInitialize }) {
  const ready = programStatus?.configInitialized

  return (
    <div className="rounded-2xl border overflow-hidden" style={cardShell}>
      <div
        className="px-5 py-4 sm:px-6 sm:py-5 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4"
        style={{
          background: ready
            ? 'linear-gradient(135deg, oklch(97% 0.04 155) 0%, rgba(255,255,255,0.5) 55%)'
            : 'linear-gradient(135deg, oklch(97% 0.04 85) 0%, rgba(255,255,255,0.55) 50%)',
        }}
      >
        <div className="flex gap-4 min-w-0">
          <div
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${ready ? 'bg-(--mint-light) text-(--mint)' : 'bg-amber-50 text-amber-700'}`}
          >
            <IconShield className="w-6 h-6" />
          </div>
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-(--text-primary) tracking-tight">Program &amp; RPC</h2>
              <span
                className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${ready ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}
              >
                {ready ? 'Config live' : 'Setup required'}
              </span>
            </div>
            {ready ? (
              <div className="space-y-1.5 text-[11px] text-(--text-secondary) leading-relaxed">
                <p>
                  <span className="text-(--text-tertiary)">RPC</span>{' '}
                  <span className="font-mono text-[10px] text-(--text-primary) break-all">{programStatus.rpcEndpoint}</span>
                </p>
                {programStatus.configAuthority && (
                  <p>
                    <span className="text-(--text-tertiary)">Authority</span>{' '}
                    <span className="font-mono text-[10px] break-all">{programStatus.configAuthority}</span>
                  </p>
                )}
              </div>
            ) : (
              <p className="text-[11px] text-(--text-secondary) leading-relaxed max-w-xl">
                Create the <code className="font-mono text-[10px] px-1 py-0.5 rounded bg-white/70 border border-(--border)">config</code> PDA once on the
                same network as <code className="font-mono text-[10px]">SOLANA_RPC_URL</code>. The server authority wallet pays rent and needs SOL on that
                network.
              </p>
            )}
            {!ready && programStatus?.rpcEndpoint && (
              <p className="text-[10px] font-mono text-amber-900/80 break-all pt-1">{programStatus.rpcEndpoint}</p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onInitialize}
          disabled={programBusy}
          className="shrink-0 rounded-full px-5 py-2.5 text-xs font-semibold text-white shadow-sm hover:brightness-105 active:scale-[0.98] disabled:opacity-45 disabled:pointer-events-none transition-all cursor-pointer"
          style={{ background: 'linear-gradient(135deg, oklch(48% 0.18 283), oklch(42% 0.16 270))' }}
        >
          {programBusy ? 'Sending…' : ready ? 'Verify again' : 'Initialize program'}
        </button>
      </div>
    </div>
  )
}

function SupportDealCard({ deal, onRelease, onRefund, onFreeze, busy }) {
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(false)
  const [customRecipient, setCustomRecipient] = useState('')
  const [refundTarget, setRefundTarget] = useState('creator')

  const creator = deal.creator?.address
  const sellerAddr = deal.seller?.address
  const hasPda = Boolean(deal.escrow_pda)
  const frozen = deal.escrow_frozen

  const effectiveRecipient =
    refundTarget === 'custom' ? customRecipient.trim() : refundTarget === 'creator' ? creator : sellerAddr

  return (
    <article
      className="rounded-2xl border overflow-hidden transition-[box-shadow,border-color] duration-200"
      style={{
        ...cardShell,
        borderColor: expanded ? 'oklch(87% 0.06 283)' : cardShell.borderColor,
        boxShadow: expanded
          ? '0 1px 2px oklch(50% 0.08 283 / 0.06), 0 8px 28px oklch(50% 0.08 283 / 0.08)'
          : cardShell.boxShadow,
      }}
    >
      <button
        type="button"
        className="w-full flex items-center gap-4 px-5 py-4 sm:px-6 text-left hover:bg-(--accent-light)/25 transition-colors cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-semibold text-(--accent) tracking-tight">{deal.id}</span>
            <Badge value={deal.escrow_status ?? deal.status} />
            {frozen && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-900">Frozen</span>
            )}
          </div>
          <p className="text-[11px] text-(--text-tertiary)">Support requested · escrow operations</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-sm font-bold tabular-nums text-(--text-primary)">
            {deal.amount} <span className="text-(--text-secondary) font-semibold">{deal.asset}</span>
          </span>
          <IconChevron open={expanded} />
        </div>
      </button>

      {expanded && (
        <div className="border-t border-(--border) bg-(--surface)/40">
          <div className="px-5 sm:px-6 pt-5 pb-2">
            <button
              type="button"
              onClick={() => navigate(`/deals/${deal.id}`)}
              className="w-full rounded-xl py-3 text-sm font-semibold text-white hover:brightness-110 transition-all cursor-pointer shadow-sm"
              style={{ background: 'hsl(260 22% 14%)' }}
            >
              Open deal
            </button>
          </div>

          {hasPda && (
            <div className="px-5 sm:px-6 pb-6 space-y-5 pt-2">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-(--border) bg-white/70 p-4 flex flex-col justify-between gap-3 min-h-[108px]">
                  <div>
                    <p className="text-xs font-semibold text-(--text-primary)">Release to seller</p>
                    <p className="text-[11px] text-(--text-tertiary) mt-0.5">Close escrow → payout to seller</p>
                  </div>
                  <button
                    type="button"
                    disabled={frozen || busy}
                    onClick={() => onRelease(deal.id)}
                    className="rounded-full px-4 py-2 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer transition-all w-fit"
                    style={{ background: 'var(--mint)' }}
                  >
                    Release
                  </button>
                </div>

                <div className="rounded-xl border border-(--border) bg-white/70 p-4 flex flex-col justify-between gap-3 min-h-[108px]">
                  <div>
                    <p className="text-xs font-semibold text-(--text-primary)">{frozen ? 'Unfreeze' : 'Freeze'} escrow</p>
                    <p className="text-[11px] text-(--text-tertiary) mt-0.5">
                      {frozen ? 'Allow deposits & release again' : 'Lock until support refund path'}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onFreeze(deal.id, !frozen)}
                    className={`rounded-full px-4 py-2 text-xs font-semibold border transition-all w-fit disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer ${
                      frozen
                        ? 'border-(--border) bg-white text-(--text-secondary) hover:bg-(--surface)'
                        : 'border-amber-200/80 bg-amber-50 text-amber-900 hover:bg-amber-100/80'
                    }`}
                  >
                    {frozen ? 'Unfreeze' : 'Freeze'}
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-(--border) bg-white/80 p-4 space-y-3">
                <p className="text-xs font-semibold text-(--text-primary)">Refund escrow</p>
                <p className="text-[11px] text-(--text-tertiary)">Frozen escrow only · choose recipient</p>
                <div className="flex flex-col gap-2">
                  <label
                    className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-colors ${
                      refundTarget === 'creator' ? 'border-(--accent-border) bg-(--accent-light)' : 'border-(--border) bg-white'
                    }`}
                  >
                    <input
                      type="radio"
                      name={`refund-${deal.id}`}
                      checked={refundTarget === 'creator'}
                      onChange={() => setRefundTarget('creator')}
                      className="mt-1 accent-(--accent)"
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-(--text-primary)">Creator</p>
                      <p className="font-mono text-[10px] text-(--text-tertiary) break-all mt-0.5">{creator || '—'}</p>
                    </div>
                  </label>
                  {sellerAddr && (
                    <label
                      className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-colors ${
                        refundTarget === 'seller' ? 'border-(--accent-border) bg-(--accent-light)' : 'border-(--border) bg-white'
                      }`}
                    >
                      <input
                        type="radio"
                        name={`refund-${deal.id}`}
                        checked={refundTarget === 'seller'}
                        onChange={() => setRefundTarget('seller')}
                        className="mt-1 accent-(--accent)"
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-(--text-primary)">Seller</p>
                        <p className="font-mono text-[10px] text-(--text-tertiary) break-all mt-0.5">{sellerAddr}</p>
                      </div>
                    </label>
                  )}
                  <label
                    className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-colors ${
                      refundTarget === 'custom' ? 'border-(--accent-border) bg-(--accent-light)' : 'border-(--border) bg-white'
                    }`}
                  >
                    <input
                      type="radio"
                      name={`refund-${deal.id}`}
                      checked={refundTarget === 'custom'}
                      onChange={() => setRefundTarget('custom')}
                      className="mt-1 accent-(--accent)"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-(--text-primary) mb-1.5">Custom address</p>
                      <input
                        type="text"
                        value={customRecipient}
                        onChange={(e) => setCustomRecipient(e.target.value)}
                        placeholder="Solana address…"
                        onClick={() => setRefundTarget('custom')}
                        className="w-full rounded-lg border border-(--border) bg-white px-3 py-2 font-mono text-[11px] outline-none focus:border-(--accent-border) focus:ring-2 focus:ring-(--accent-light)"
                      />
                    </div>
                  </label>
                </div>
                <button
                  type="button"
                  disabled={busy || !effectiveRecipient || !frozen}
                  onClick={() => onRefund(deal.id, effectiveRecipient)}
                  className="w-full rounded-full py-2.5 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer transition-all"
                  style={{ background: 'oklch(52% 0.2 25)' }}
                  title={!frozen ? 'Freeze the escrow before refund' : ''}
                >
                  {!frozen ? 'Freeze first to enable refund' : `Refund → ${refundTarget === 'custom' ? 'custom' : refundTarget}`}
                </button>
              </div>

              <div className="grid sm:grid-cols-2 gap-4 rounded-xl border border-(--border) bg-white/60 p-4">
                <AddressBox label="Creator" address={creator} />
                <AddressBox label="Seller" address={sellerAddr} />
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  )
}

export default function SupportPage() {
  const isSupport = useIsSupport()
  const api = useAuthApi()
  const [deals, setDeals] = useState([])
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [programBusy, setProgramBusy] = useState(false)
  const [programStatus, setProgramStatus] = useState(null)

  const loadProgramStatus = useCallback(async () => {
    try {
      const s = await api('/support/program/status')
      setProgramStatus(s)
    } catch {
      setProgramStatus(null)
    }
  }, [api])

  const loadDeals = useCallback(async () => {
    setLoading(true)
    setErr('')
    setMsg('')
    try {
      const { deals: list } = await api('/support/deals')
      setDeals(list || [])
    } catch (e) {
      setErr(e.message || 'Failed')
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => {
    if (!isSupport) return
    loadDeals()
    loadProgramStatus()
  }, [isSupport, loadDeals, loadProgramStatus])

  async function withBusy(fn) {
    setBusy(true)
    setErr('')
    setMsg('')
    try {
      await fn()
    } catch (e) {
      setErr(e.message || 'Operation failed')
    } finally {
      setBusy(false)
    }
  }

  async function onRelease(dealId) {
    await withBusy(async () => {
      const r = await api('/support/escrow/release', { method: 'POST', body: JSON.stringify({ dealId }) })
      setMsg(`Released · ${r.signature}`)
      await loadDeals()
    })
  }

  async function onRefund(dealId, recipient) {
    await withBusy(async () => {
      const r = await api('/support/escrow/refund', { method: 'POST', body: JSON.stringify({ dealId, recipient }) })
      setMsg(`Refunded · ${r.signature}`)
      await loadDeals()
    })
  }

  async function onFreeze(dealId, frozen) {
    await withBusy(async () => {
      const r = await api('/support/escrow/freeze', { method: 'POST', body: JSON.stringify({ dealId, frozen }) })
      setMsg(`${frozen ? 'Frozen' : 'Unfrozen'} · ${r.signature}`)
      await loadDeals()
    })
  }

  async function onInitializeProgram() {
    setProgramBusy(true)
    setErr('')
    setMsg('')
    try {
      const r = await api('/support/program/initialize', { method: 'POST', body: '{}' })
      if (r.alreadyInitialized) {
        setMsg(`Config already on-chain · ${r.configPda}`)
      } else {
        setMsg(`Program initialized · ${r.configPda} · ${r.signature}`)
      }
      await loadProgramStatus()
    } catch (e) {
      setErr(e.message || 'Initialize failed')
    } finally {
      setProgramBusy(false)
    }
  }

  if (isSupport === false) return <Navigate to="/deals" replace />

  const queueCount = deals.length

  return (
    <div className="min-h-dvh px-4 py-8 sm:px-6 sm:py-12">
      <AmbientBg />
      <div className="mx-auto animate-fade-up max-w-3xl lg:max-w-4xl">
        <header className="mb-8 sm:mb-10 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6">
          <div className="flex gap-4">
            <div
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-white shadow-md"
              style={{ background: 'linear-gradient(145deg, oklch(45% 0.16 283), oklch(38% 0.14 270))' }}
            >
              <IconShield className="w-7 h-7 opacity-95" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-(--text-tertiary) mb-1">Internal</p>
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-(--text-primary)">Support</h1>
              <p className="mt-1.5 text-sm text-(--text-secondary) max-w-md leading-relaxed">
                Escrow disputes, freeze / release / refund, and on-chain program health.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <span className="inline-flex items-center gap-2 rounded-full border border-(--border) bg-white/80 px-4 py-2 text-xs font-semibold text-(--text-primary) shadow-sm">
              <span className="h-2 w-2 rounded-full bg-(--accent) animate-pulse" aria-hidden />
              Queue · {loading ? '…' : queueCount}
            </span>
            {programStatus && (
              <span
                className={`inline-flex items-center rounded-full px-4 py-2 text-xs font-bold uppercase tracking-wide ${
                  programStatus.configInitialized ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-950'
                }`}
              >
                {programStatus.configInitialized ? 'Chain OK' : 'Init chain'}
              </span>
            )}
          </div>
        </header>

        <div className="space-y-5 sm:space-y-6">
          <ProgramStatusCard programStatus={programStatus} programBusy={programBusy} onInitialize={onInitializeProgram} />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-(--text-primary) tracking-tight">Support queue</h2>
            <button
              type="button"
              onClick={() => {
                loadDeals()
                loadProgramStatus()
              }}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-full border border-(--border) bg-white/90 px-4 py-2 text-xs font-semibold text-(--text-primary) hover:bg-(--accent-light)/40 disabled:opacity-45 transition-all cursor-pointer shadow-sm"
            >
              <svg className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          {err && (
            <div
              className="rounded-2xl border px-4 py-3.5 flex gap-3 items-start"
              style={{ borderColor: 'oklch(88% 0.06 25)', background: 'oklch(98% 0.02 25)' }}
            >
              <span className="text-red-600 shrink-0 mt-0.5" aria-hidden>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </span>
              <p className="text-xs font-medium text-red-900 leading-relaxed">{err}</p>
            </div>
          )}

          {msg && (
            <div
              className="rounded-2xl border px-4 py-3.5 flex gap-3 items-start"
              style={{ borderColor: 'oklch(88% 0.06 155)', background: 'oklch(98% 0.03 155)' }}
            >
              <span className="text-emerald-700 shrink-0 mt-0.5" aria-hidden>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </span>
              <p className="text-xs font-medium text-emerald-900 break-all leading-relaxed">{msg}</p>
            </div>
          )}

          {deals.length === 0 && !loading && (
            <div className="rounded-2xl border border-dashed border-(--border) bg-white/50 px-8 py-16 text-center" style={cardShell}>
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-(--accent-light) text-(--accent)">
                <IconShield className="w-7 h-7 opacity-80" />
              </div>
              <p className="text-sm font-semibold text-(--text-primary)">No open support cases</p>
              <p className="mt-2 text-xs text-(--text-tertiary) max-w-xs mx-auto leading-relaxed">
                Deals appear here when a participant requests support. Use Refresh to poll.
              </p>
            </div>
          )}

          <ul className="space-y-4 list-none p-0 m-0">
            {deals.map((d) => (
              <li key={d.id}>
                <SupportDealCard deal={d} onRelease={onRelease} onRefund={onRefund} onFreeze={onFreeze} busy={busy} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
