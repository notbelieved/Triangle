import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { usePrivy } from '@privy-io/react-auth'
import { Transaction } from '@solana/web3.js'
import bs58 from 'bs58'
import { useSignAndSendTransaction, useWallets as useSolanaWallets } from '@privy-io/react-auth/solana'
import { useAuthApi } from '../useAuthApi.js'
import { PageChrome } from '../components/PageChrome.jsx'
import { useTriangleSolanaAddress } from '../useTriangleSolanaAddress.js'
import { formatDealAmount } from '../formatAmount.js'
import SupportModal from '../components/SupportModal.jsx'
import CopyTextButton from '../components/CopyTextButton.jsx'
import { useIsSupport } from '../useIsSupport.js'

const NETWORK_LABEL = { 'solana-devnet': 'Solana Devnet' }
const POLL_MS = 2800

function getSecurityStatus(deal) {
  if (!deal) return { label: '—', variant: 'neutral', pulse: false }

  if (deal.status === 'cancelled') return { label: 'Deal cancelled', variant: 'complete', pulse: false }
  if (deal.status === 'disputed') return { label: 'Dispute · support review', variant: 'warning', pulse: false }

  const es = deal.escrow_status

  if (es === 'released') return { label: 'Payment released', variant: 'complete', pulse: false }
  if (es === 'refunded') return { label: 'Refunded on-chain', variant: 'complete', pulse: false }
  if (es === 'funded') {
    if (deal.escrow_frozen)
      return { label: 'Funds frozen · dispute pending', variant: 'warning', pulse: false }
    return { label: 'Funds secured in escrow', variant: 'secure', pulse: true }
  }
  if (es === 'awaiting_confirm') return { label: 'Confirming on-chain…', variant: 'pending', pulse: false }
  if (es === 'awaiting_funds') return { label: 'Awaiting deposit', variant: 'pending', pulse: false }
  if (deal.escrow_pda) return { label: 'Escrow initialized', variant: 'pending', pulse: false }
  if (deal.status === 'accepted' || deal.status === 'disputed') {
    if (deal.escrow_program_configured)
      return { label: 'Ready to initialize escrow', variant: 'pending', pulse: false }
    return { label: 'Deal accepted', variant: 'neutral', pulse: false }
  }
  if (deal.status === 'open') {
    return deal.seller
      ? { label: 'Deal accepted', variant: 'neutral', pulse: false }
      : { label: 'Waiting for counterparty', variant: 'neutral', pulse: false }
  }
  return { label: deal.status ?? '—', variant: 'neutral', pulse: false }
}

const SECURITY_VARIANTS = {
  secure: {
    wrap: 'bg-emerald-50 border-emerald-100',
    text: 'text-emerald-800 font-semibold',
    dot: 'bg-emerald-500',
    ping: 'bg-emerald-400',
  },
  warning: {
    wrap: 'bg-amber-50 border-amber-100',
    text: 'text-amber-800 font-semibold',
    dot: 'bg-amber-400',
    ping: '',
  },
  pending: {
    wrap: 'bg-[--accent-light] border-[--accent-border]',
    text: 'text-[--accent] font-medium',
    dot: 'bg-[--accent-mid]',
    ping: '',
  },
  complete: {
    wrap: 'bg-slate-50 border-slate-100',
    text: 'text-slate-500 font-medium',
    dot: 'bg-slate-300',
    ping: '',
  },
  neutral: {
    wrap: 'bg-slate-50 border-slate-100',
    text: 'text-slate-400 font-medium',
    dot: 'bg-slate-300',
    ping: '',
  },
}

const STATUS_BADGE = {
  open:     { label: 'Open',     cls: 'bg-slate-100 text-slate-500' },
  accepted: { label: 'Accepted', cls: 'bg-[--accent-light] text-[--accent]' },
  disputed: { label: 'Disputed', cls: 'bg-amber-100 text-amber-800' },
  cancelled:{ label: 'Cancelled', cls: 'bg-slate-200 text-slate-600' },
  funded:   { label: 'Funded',   cls: 'bg-emerald-100 text-emerald-700' },
  released: { label: 'Released', cls: 'bg-emerald-50 text-emerald-500' },
  refunded: { label: 'Refunded', cls: 'bg-amber-100 text-amber-700' },
}

function DealStatusBadge({ deal }) {
  const escrowStatus = deal?.escrow_status
  const dealStatus   = deal?.status

  const key = (escrowStatus === 'funded' || escrowStatus === 'released' || escrowStatus === 'refunded')
    ? escrowStatus
    : dealStatus

  const cfg = STATUS_BADGE[key] ?? { label: key ?? '—', cls: 'bg-slate-100 text-slate-500' }

  return (
    <span
      className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold leading-none ${cfg.cls}`}
      aria-label={`Deal status: ${cfg.label}`}
    >
      {cfg.label}
    </span>
  )
}

function FullAddressRow({ label, address, display }) {
  return (
    <div className="flex items-start justify-between gap-3 min-w-0">
      <p className="shrink-0 text-[10px] font-semibold uppercase tracking-widest text-[--text-tertiary] mt-0.5 w-16">
        {label}
      </p>
      <div className="min-w-0 flex-1 text-right">
        <p className="font-mono text-[11px] text-[--text-tertiary] break-all leading-relaxed">
          {address || '—'}
        </p>
      </div>
    </div>
  )
}

function ProgramEscrowBlock({ deal, escrowComplete }) {
  const hasPda = Boolean(deal?.escrow_pda)

  if (escrowComplete) {
    return (
      <div className="mt-5 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3.5 animate-reveal">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-emerald-600">✓</span>
          <p className="text-xs font-semibold text-emerald-800">Program Escrow</p>
        </div>
        <p className="text-xs text-emerald-700">
          {deal.escrow_status === 'refunded'
            ? 'Refunded on-chain · PDA closed'
            : 'Paid out to counterparty · PDA closed'}
        </p>
      </div>
    )
  }

  return (
    <div className={`mt-5 rounded-2xl border border-[--accent-border] bg-[--accent-light] ${hasPda ? 'animate-reveal' : ''}`}>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[--accent-border]">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0 text-[--accent]" aria-hidden="true">
          <rect x="2" y="7" width="12" height="8" rx="2" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        <p className="text-xs font-semibold text-[--accent]">Program Escrow</p>
        {hasPda && (
          <span className="ml-auto rounded-full bg-[--accent-border] px-2 py-0.5 text-[10px] font-semibold text-[--accent]">
            {deal.escrow_status ? deal.escrow_status.replace(/_/g, ' ') : 'initialized'}
          </span>
        )}
      </div>

      <div className="px-4 py-3.5">
        {hasPda ? (
          <>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[--text-tertiary] mb-1.5">
              Escrow address (PDA)
            </p>
            <p className="font-mono text-[11px] text-[--text-secondary] break-all leading-relaxed mb-2.5">
              {deal.escrow_pda}
            </p>
            <CopyTextButton
              text={deal.escrow_pda}
              label="Copy address"
              className="rounded-[10px] border border-[--accent-border] bg-white px-3 py-1.5 text-[11px] font-semibold text-[--accent] hover:bg-[--accent-light] transition-colors cursor-pointer"
            />
          </>
        ) : (
          <p className="text-xs text-[--text-tertiary]">
            No escrow account yet. Press <span className="font-semibold text-[--text-secondary]">Create escrow account</span> to initialize a Program Derived Address on Solana.
          </p>
        )}
      </div>
    </div>
  )
}

function SecurityBanner({ deal }) {
  const { label, variant, pulse } = getSecurityStatus(deal)
  const v = SECURITY_VARIANTS[variant]

  return (
    <div
      className={`flex items-center gap-2.5 px-5 py-3 rounded-t-[20px] ${v.wrap} border-b`}
      role="status"
      aria-live="polite"
    >
      <span className="relative flex h-2 w-2 shrink-0">
        {pulse && (
          <span
            className={`absolute inline-flex h-full w-full rounded-full ${v.ping} animate-ping-slow`}
          />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${v.dot}`} />
      </span>
      <p className={`text-xs tracking-wide ${v.text}`}>{label}</p>
      {deal?.escrow_frozen && (
        <span className="ml-auto shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
          Frozen
        </span>
      )}
    </div>
  )
}

function ProgressDot({ active }) {
  return (
    <span
      className={`h-2 w-2 rounded-full shrink-0 transition-colors duration-300 ${
        active ? 'bg-[--accent]' : 'bg-slate-200'
      }`}
    />
  )
}

function ProgressConnector({ active }) {
  return (
    <span
      className={`h-px flex-1 transition-colors duration-300 ${active ? 'bg-[--accent-border]' : 'bg-slate-200'}`}
    />
  )
}

function DealProgress({ deal }) {
  const hasSeller = Boolean(deal?.seller)
  const es = deal?.escrow_status
  const isFunded = es === 'funded' || es === 'released' || es === 'refunded'
  const isDone = es === 'released' || es === 'refunded'

  const steps = ['Created', 'Accepted', 'Funded', 'Done']
  const active = [true, hasSeller, isFunded, isDone]

  return (
    <div className="mt-6">
      <div className="flex items-center gap-0">
        {steps.map((step, i) => (
          <div key={step} className="flex items-center" style={{ flex: i < steps.length - 1 ? '1' : 'none' }}>
            <div className="flex flex-col items-center gap-1.5">
              <ProgressDot active={active[i]} />
              <p className={`text-[10px] font-medium whitespace-nowrap ${active[i] ? 'text-[--accent]' : 'text-slate-400'}`}>
                {step}
              </p>
            </div>
            {i < steps.length - 1 && (
              <ProgressConnector active={active[i + 1]} />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}


function InlineAlert({ children, variant = 'warning' }) {
  const styles = {
    warning: 'bg-amber-50 text-amber-800 border border-amber-100',
    info: 'bg-[--accent-light] text-[--accent] border border-[--accent-border]',
    success: 'bg-emerald-50 text-emerald-800 border border-emerald-100',
    error: 'bg-red-50 text-red-800 border border-red-100',
  }
  return (
    <p className={`rounded-[14px] px-3.5 py-2.5 text-xs leading-relaxed ${styles[variant]}`}>
      {children}
    </p>
  )
}

function PrimaryButton({ onClick, disabled, children, variant = 'violet' }) {
  const base =
    'w-full rounded-[16px] px-4 py-3.5 text-sm font-semibold text-white transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
  const variants = {
    violet: 'bg-[--accent] hover:brightness-105 focus-visible:ring-[--accent] cursor-pointer',
    emerald: 'bg-emerald-600 hover:bg-emerald-700 focus-visible:ring-emerald-500 cursor-pointer',
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${base} ${variants[variant]}`}>
      {children}
    </button>
  )
}

function GhostButton({ onClick, disabled, children, accent = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex-1 rounded-[14px] border px-3 py-2.5 text-xs font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 enabled:cursor-pointer
        ${accent
          ? 'border-[--accent-border] bg-[--accent-light] text-[--accent] hover:brightness-95'
          : 'border-[--border] bg-white text-[--text-secondary] hover:bg-slate-50'
        }`}
    >
      {children}
    </button>
  )
}

function SupportModerationBlock({ deal, dealId, api, onRefresh }) {
  const [statusChoice, setStatusChoice] = useState('')
  const [busy, setBusy] = useState(false)
  const [errLocal, setErrLocal] = useState('')
  const [msgLocal, setMsgLocal] = useState('')
  const [refundTarget, setRefundTarget] = useState('creator')

  const creator = deal?.creator?.address
  const sellerAddr = deal?.seller?.address
  const frozen = deal?.escrow_frozen
  const hasPda = Boolean(deal?.escrow_pda)
  const effectiveRecipient = refundTarget === 'creator' ? creator : sellerAddr

  const statusOptions = []
  if (deal?.status === 'accepted') statusOptions.push({ value: 'disputed', label: 'Mark disputed' })
  if (deal?.status === 'disputed') statusOptions.push({ value: 'accepted', label: 'Clear dispute → accepted' })
  if (['open', 'accepted', 'disputed'].includes(deal?.status ?? '')) {
    statusOptions.push({ value: 'cancelled', label: 'Cancel deal' })
  }

  async function withBusy(fn) {
    setBusy(true)
    setErrLocal('')
    setMsgLocal('')
    try {
      await fn()
    } catch (e) {
      setErrLocal(e.message || 'Failed')
    } finally {
      setBusy(false)
    }
  }

  async function applyStatus() {
    if (!statusChoice) return
    await withBusy(async () => {
      await api(`/support/deals/${dealId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: statusChoice }),
      })
      setMsgLocal('Deal status updated')
      setStatusChoice('')
      await onRefresh()
    })
  }

  async function onRelease() {
    await withBusy(async () => {
      const r = await api('/support/escrow/release', {
        method: 'POST',
        body: JSON.stringify({ dealId }),
      })
      setMsgLocal(`Released · ${r.signature}`)
      await onRefresh()
    })
  }

  async function onFreeze(nextFrozen) {
    await withBusy(async () => {
      const r = await api('/support/escrow/freeze', {
        method: 'POST',
        body: JSON.stringify({ dealId, frozen: nextFrozen }),
      })
      setMsgLocal(`${nextFrozen ? 'Frozen' : 'Unfrozen'} · ${r.signature}`)
      await onRefresh()
    })
  }

  async function onRefund() {
    await withBusy(async () => {
      const r = await api('/support/escrow/refund', {
        method: 'POST',
        body: JSON.stringify({ dealId, recipient: effectiveRecipient }),
      })
      setMsgLocal(`Refunded · ${r.signature}`)
      await onRefresh()
    })
  }

  return (
    <div className="mt-5 rounded-2xl border border-violet-200 bg-violet-50/90 px-4 py-4 space-y-4">
      <p className="text-xs font-semibold text-violet-900">Support · escrow & status</p>
      {errLocal ? <InlineAlert variant="error">{errLocal}</InlineAlert> : null}
      {msgLocal ? <InlineAlert variant="success">{msgLocal}</InlineAlert> : null}

      {statusOptions.length > 0 ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex-1 min-w-[140px]">
            <span className="block text-[10px] font-semibold uppercase tracking-widest text-violet-800/80 mb-1">
              Deal status
            </span>
            <select
              value={statusChoice}
              onChange={(e) => setStatusChoice(e.target.value)}
              className="w-full rounded-xl border border-violet-200 bg-white px-3 py-2 text-xs text-[--text-primary] outline-none focus:ring-2 focus:ring-violet-200"
            >
              <option value="">Choose…</option>
              {statusOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={busy || !statusChoice}
            onClick={applyStatus}
            className="rounded-full px-4 py-2 text-xs font-semibold text-white bg-violet-700 hover:brightness-110 disabled:opacity-40 cursor-pointer"
          >
            Apply
          </button>
        </div>
      ) : null}

      {hasPda ? (
        <div className="space-y-3 border-t border-violet-200/80 pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-violet-800/80">Escrow</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || frozen}
              onClick={onRelease}
              className="rounded-full px-3 py-1.5 text-[11px] font-semibold bg-emerald-600 text-white disabled:opacity-40 cursor-pointer"
            >
              Release to seller
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onFreeze(!frozen)}
              className="rounded-full px-3 py-1.5 text-[11px] font-semibold border border-violet-300 bg-white text-violet-900 cursor-pointer"
            >
              {frozen ? 'Unfreeze' : 'Freeze'}
            </button>
          </div>
          <div className="rounded-xl border border-violet-200 bg-white/80 p-3 space-y-2">
            <p className="text-[11px] font-semibold text-[--text-primary]">Refund (freeze first)</p>
            <div className="flex flex-col gap-1.5 text-[11px]">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="sup-refund" checked={refundTarget === 'creator'} onChange={() => setRefundTarget('creator')} className="accent-violet-600" />
                <span className="font-mono text-[10px] break-all">Creator {creator || '—'}</span>
              </label>
              {sellerAddr ? (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="sup-refund" checked={refundTarget === 'seller'} onChange={() => setRefundTarget('seller')} className="accent-violet-600" />
                  <span className="font-mono text-[10px] break-all">Seller {sellerAddr}</span>
                </label>
              ) : null}
            </div>
            <button
              type="button"
              disabled={busy || !frozen || !effectiveRecipient}
              onClick={onRefund}
              className="w-full rounded-full py-2 text-[11px] font-semibold bg-red-600 text-white disabled:opacity-40 cursor-pointer"
            >
              Refund to selected address
            </button>
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-violet-800/80">No on-chain escrow yet.</p>
      )}
    </div>
  )
}

function ChatSection({ messages, chatError, escrowComplete, escrowStatus, body, setBody, sending, onSend, chatReadOnly }) {
  return (
    <section className="mt-6 animate-fade-up-delay">
      <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-[--text-tertiary]">
        Messages
      </p>

      {chatError ? <InlineAlert variant="warning">{chatError}</InlineAlert> : null}

      {escrowComplete && escrowStatus === 'refunded' && (
        <div className="mb-3">
          <InlineAlert variant="success">Escrow refunded on-chain.</InlineAlert>
        </div>
      )}

      <div className="overflow-hidden rounded-[20px] border deal-card-border bg-white deal-shadow">
        <div className="max-h-72 overflow-y-auto overscroll-contain flex flex-col gap-3 p-4">
          {messages.length === 0 ? (
            <p className="py-6 text-center text-sm text-[--text-tertiary]">No messages yet.</p>
          ) : (
            messages.map((m) => {
              const sup = Boolean(m.author_is_support)
              const base = m.is_me
                ? 'ml-10 bg-[--accent-light] text-[--text-primary]'
                : 'mr-10 bg-slate-100 text-slate-800'
              const supportStyle = sup
                ? ' ring-2 ring-violet-300/80 bg-violet-50/90 text-[--text-primary]'
                : ''
              return (
                <div
                  key={m.id}
                  className={`flex flex-col rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${base}${supportStyle}`}
                >
                  <span className="mb-1 flex flex-wrap items-center gap-x-2 text-[10px] font-medium text-[--text-tertiary] break-all">
                    <span>
                      {m.is_me ? 'You' : (m.author?.address || m.author?.label)}
                      {sup ? (
                        <span className="ml-1.5 rounded-md bg-violet-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                          Support
                        </span>
                      ) : null}
                    </span>
                    <span className="font-normal">
                      {m.created_at
                        ? new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                        : ''}
                    </span>
                  </span>
                  <p className="whitespace-pre-wrap">{m.body}</p>
                </div>
              )
            })
          )}
        </div>
        <form onSubmit={onSend} className="flex gap-2 border-t border-[--border] px-4 py-3">
          <input
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={chatReadOnly ? 'Chat closed' : 'Message…'}
            disabled={chatReadOnly}
            className="min-w-0 flex-1 rounded-[14px] border border-[--border] bg-slate-50/60 px-3 py-2 text-sm outline-none transition-shadow focus:border-[--accent-border] focus:ring-2 focus:ring-[--accent-light] disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={sending || !body.trim() || chatReadOnly}
            className="rounded-[14px] bg-[--text-primary] px-4 py-2 text-xs font-semibold text-white transition-opacity disabled:opacity-40"
          >
            Send
          </button>
        </form>
      </div>
    </section>
  )
}

function BlinkShell({ children }) {
  return (
    <div className="min-h-dvh flex items-center justify-center p-4 bg-[#F5F7FA]">
      <div className="w-full max-w-sm">
        {children}
      </div>
    </div>
  )
}

export default function DealDetailPage() {
  const { dealId } = useParams()
  const [searchParams] = useSearchParams()
  const isBlinkView = searchParams.has('blink')

  const { user: privyUser } = usePrivy()
  const api = useAuthApi()
  const { wallets, ready: solWalletsReady } = useSolanaWallets()
  const { signAndSendTransaction } = useSignAndSendTransaction()

  const [deal, setDeal] = useState(null)
  const [messages, setMessages] = useState([])
  const [chatError, setChatError] = useState('')
  const [body, setBody] = useState('')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [accepting, setAccepting] = useState(false)
  const [sending, setSending] = useState(false)
  const [supportOpen, setSupportOpen] = useState(false)
  const [callingSupport, setCallingSupport] = useState(false)
  const [escrowBusy, setEscrowBusy] = useState(false)
  const [escrowNotice, setEscrowNotice] = useState(null)

  const solAddress = useTriangleSolanaAddress()
  const isSupport = useIsSupport()

  const solWallet = useMemo(() => {
    if (!solAddress?.trim() || !wallets?.length) return null
    const want = solAddress.trim()
    return wallets.find((w) => w.address === want) ?? null
  }, [solAddress, wallets])

  const loadDeal = useCallback(async () => {
    const { deal: d } = await api(`/deals/${dealId}`)
    setDeal(d)
  }, [api, dealId])

  useEffect(() => {
    setEscrowNotice(null)
  }, [dealId])

  const loadMessages = useCallback(async () => {
    try {
      const { messages: m } = await api(`/deals/${dealId}/messages`)
      setMessages(m || [])
      setChatError('')
    } catch (e) {
      setChatError(e.message || '')
      setMessages([])
    }
  }, [api, dealId])

  const refreshDealAndMessages = useCallback(async () => {
    await loadDeal()
    await loadMessages()
  }, [loadDeal, loadMessages])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const email = privyUser?.email?.address ?? null
        await api('/auth/sync', {
          method: 'POST',
          body: JSON.stringify({ email, solana_address: solAddress ?? null }),
        })
        if (cancelled) return
        await loadDeal()
        if (!cancelled) setErr('')
      } catch (e) {
        if (!cancelled) setErr(e.message || 'Failed to load deal')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [api, loadDeal, privyUser?.email?.address, solAddress])

  useEffect(() => {
    if (loading) return undefined
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      loadDeal().catch(() => {})
    }, POLL_MS)
    return () => clearInterval(id)
  }, [loading, loadDeal])

  useEffect(() => {
    if (!deal?.seller) return undefined
    const supportModerating = isSupport && deal.support_requested
    const participantChat =
      ['accepted', 'disputed', 'cancelled'].includes(deal.status) &&
      (deal.role === 'creator' || deal.role === 'seller')
    if (!supportModerating && !participantChat) return undefined
    loadMessages()
    const t = setInterval(loadMessages, POLL_MS)
    return () => clearInterval(t)
  }, [deal, loadMessages, isSupport])

  async function signSendPreparedTx(preparePath, prepareBody) {
    if (!solAddress?.trim()) throw new Error('No Solana address on your profile. Link a wallet in Privy.')
    if (!solWallet) {
      throw new Error(
        `Sign with the wallet matching your Triangle address (${solAddress.slice(0, 4)}…${solAddress.slice(-4)}). In MetaMask, pick that same Solana account, or use your Privy embedded wallet.`,
      )
    }
    const prep = await api(preparePath, {
      method: 'POST',
      body: JSON.stringify(prepareBody || {}),
    })
    const tx = Transaction.from(Buffer.from(prep.transactionBase64, 'base64'))
    const result = await signAndSendTransaction({
      transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }),
      wallet: solWallet,
      chain: 'solana:devnet',
    })
    const sig = result?.signature
    if (typeof sig === 'string') return sig
    if (sig instanceof Uint8Array) return bs58.encode(sig)
    throw new Error('Unexpected signature format from wallet')
  }

  async function onInitEscrow() {
    setEscrowBusy(true)
    setErr('')
    setEscrowNotice(null)
    try {
      const sig = await signSendPreparedTx(`/deals/${dealId}/escrow/prepare-init`, {})
      await api(`/deals/${dealId}/escrow/ack-init`, {
        method: 'POST',
        body: JSON.stringify({ signature: sig }),
      })
      await loadDeal()
    } catch (e) {
      setErr(e.message || 'Could not create escrow')
    } finally {
      setEscrowBusy(false)
    }
  }

  async function onReleaseToSeller() {
    setEscrowBusy(true)
    setErr('')
    setEscrowNotice(null)
    try {
      const sig = await signSendPreparedTx(`/deals/${dealId}/escrow/prepare-release`, {})
      await api(`/deals/${dealId}/escrow/ack-release`, {
        method: 'POST',
        body: JSON.stringify({ signature: sig }),
      })
      await loadDeal()
      await loadMessages()
    } catch (e) {
      setErr(e.message || 'Could not release funds')
    } finally {
      setEscrowBusy(false)
    }
  }

  async function onDepositEscrow() {
    setEscrowBusy(true)
    setErr('')
    setEscrowNotice(null)
    try {
      await signSendPreparedTx(`/deals/${dealId}/escrow/prepare-deposit`, {})
      await api(`/deals/${dealId}/escrow/sync`, { method: 'POST', body: '{}' })
      await loadDeal()
    } catch (e) {
      const msg = e.message || 'Deposit failed'
      if (msg.includes('fully funded')) {
        try {
          await api(`/deals/${dealId}/escrow/sync`, { method: 'POST', body: '{}' })
          await loadDeal()
          setErr('')
        } catch {
          setErr(msg)
        }
      } else {
        setErr(msg)
      }
    } finally {
      setEscrowBusy(false)
    }
  }

  async function onCheckPayment() {
    setErr('')
    setEscrowNotice(null)
    try {
      const data = await api(`/deals/${dealId}/escrow/sync`, { method: 'POST', body: '{}' })
      const d = data.deal
      if (d) setDeal(d)
      else await loadDeal()

      const fmtSol = (lamports) => {
        const n = Number(BigInt(lamports ?? '0')) / 1e9
        if (!Number.isFinite(n)) return '0'
        const s = n.toFixed(6).replace(/\.?0+$/, '')
        return s || '0'
      }

      if (!d?.escrow_pda) {
        setEscrowNotice({
          variant: 'info',
          text: 'Escrow is not created yet. Use “Create Escrow”, then send SOL to the escrow address shown above.',
        })
        return
      }

      const c = data.chain
      if (!c) {
        setEscrowNotice({ variant: 'warning', text: 'Could not read on-chain escrow data. Try again in a moment.' })
        return
      }
      if (!c.exists) {
        setEscrowNotice({
          variant: 'warning',
          text: 'This escrow account is no longer on-chain (released or closed).',
        })
        return
      }

      const st = d.escrow_status
      const sp = BigInt(c.spendableLamports ?? '0')
      const exp = BigInt(c.expectedLamports ?? '0')

      if (st === 'funded') {
        setEscrowNotice({
          variant: 'success',
          text: 'Escrow is fully funded on-chain. Creator can release to the counterparty when ready.',
        })
      } else if (st === 'awaiting_confirm') {
        setEscrowNotice({
          variant: 'success',
          text: 'Funds detected on-chain. Creator: tap “Finalize on-chain” to complete the deposit.',
        })
      } else if (exp > 0n && sp >= exp) {
        setEscrowNotice({
          variant: 'success',
          text: `Full amount received (${fmtSol(c.spendableLamports)} SOL). If the status still looks wrong, tap Check payment again.`,
        })
      } else if (sp > 0n) {
        setEscrowNotice({
          variant: 'info',
          text: `Partial deposit: ${fmtSol(c.spendableLamports)} SOL in escrow, expected ${fmtSol(c.expectedLamports)} SOL total.`,
        })
      } else {
        setEscrowNotice({
          variant: 'info',
          text: 'No SOL in the escrow account yet. Send payment to the escrow PDA, wait for confirmation, then check again.',
        })
      }
    } catch (e) {
      setErr(e.message || 'Sync failed')
    }
  }

  async function onAccept() {
    setAccepting(true)
    setErr('')
    try {
      const { deal: d } = await api(`/deals/${dealId}/accept`, { method: 'POST' })
      setDeal(d)
      await loadMessages()
    } catch (e) {
      setErr(e.message || 'Could not accept deal')
    } finally {
      setAccepting(false)
    }
  }

  async function onCallSupport() {
    setCallingSupport(true)
    setErr('')
    try {
      const { deal: d } = await api(`/deals/${dealId}/request-support`, { method: 'POST' })
      setDeal(d)
    } catch (e) {
      setErr(e.message || 'Could not call support')
    } finally {
      setCallingSupport(false)
    }
  }

  async function onSend(e) {
    e.preventDefault()
    const text = body.trim()
    if (!text) return
    if (deal?.status === 'cancelled') return
    setSending(true)
    setErr('')
    try {
      await api(`/deals/${dealId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: text }),
      })
      setBody('')
      await loadMessages()
    } catch (e) {
      setErr(e.message || 'Could not send message')
    } finally {
      setSending(false)
    }
  }

  if (loading) {
    const content = (
      <p className="py-8 text-center text-sm text-[--text-tertiary]">Loading deal…</p>
    )
    if (isBlinkView) return <BlinkShell>{content}</BlinkShell>
    return (
      <PageChrome>
        {content}
      </PageChrome>
    )
  }

  if (err && !deal) {
    const content = (
      <div className="rounded-[20px] border border-red-100 bg-red-50 px-5 py-4 mt-6">
        <p className="text-sm font-medium text-red-800">{err}</p>
      </div>
    )
    if (isBlinkView) return <BlinkShell>{content}</BlinkShell>
    return (
      <PageChrome>
        {content}
      </PageChrome>
    )
  }


  const canAccept = deal?.status === 'open' && !deal?.seller && deal?.role === 'viewer'
  const supportModerating = Boolean(isSupport && deal?.support_requested)
  const chatLive =
    Boolean(deal?.seller) &&
    ['accepted', 'disputed', 'cancelled'].includes(deal?.status) &&
    (deal?.role === 'creator' || deal?.role === 'seller' || supportModerating)

  const amountDisplay =
    deal?.amount != null ? formatDealAmount(deal.amount) ?? deal.amount : '—'

  const showEscrowUi =
    Boolean(deal?.escrow_program_configured) &&
    (['accepted', 'disputed'].includes(deal?.status ?? '') ||
      (deal?.status === 'cancelled' && Boolean(deal?.escrow_pda)))
  const escrowComplete = deal?.escrow_status === 'released' || deal?.escrow_status === 'refunded'
  const creatorCanFund =
    deal?.role === 'creator' &&
    showEscrowUi &&
    deal?.status !== 'cancelled' &&
    solWalletsReady &&
    Boolean(solWallet)
  const solWalletMismatch =
    deal?.role === 'creator' &&
    showEscrowUi &&
    deal?.status !== 'cancelled' &&
    solWalletsReady &&
    Boolean(solAddress) &&
    wallets.length > 0 &&
    !solWallet


  function resolvePrimaryAction() {
    if (canAccept) {
      return {
        label: accepting ? 'Accepting…' : 'Accept deal',
        onClick: onAccept,
        disabled: accepting,
        variant: 'emerald',
      }
    }
    if (escrowComplete) return null
    if (deal?.role !== 'creator') return null
    if (!showEscrowUi || deal?.status === 'cancelled') return null
    if (!deal?.escrow_pda) return null

    const es = deal?.escrow_status || 'awaiting_funds'
    const walletOk = creatorCanFund

    if (deal?.status === 'disputed' && (es === 'funded' || es === 'awaiting_confirm')) {
      return null
    }

    if (es === 'awaiting_funds') {
      return {
        label: escrowBusy ? 'Working…' : 'Deposit SOL to escrow',
        onClick: onDepositEscrow,
        disabled: escrowBusy || !walletOk,
        variant: 'violet',
      }
    }
    if (es === 'awaiting_confirm') {
      return {
        label: escrowBusy ? 'Working…' : 'Finalize on-chain',
        onClick: onDepositEscrow,
        disabled: escrowBusy || !walletOk,
        variant: 'violet',
      }
    }
    if (es === 'funded') {
      return {
        label: escrowBusy ? 'Sending…' : 'Release to counterparty',
        onClick: onReleaseToSeller,
        disabled: escrowBusy || !walletOk,
        variant: 'emerald',
      }
    }
    return null
  }

  const primaryAction = resolvePrimaryAction()

  const dealCard = (
    <div className="overflow-hidden rounded-[20px] border deal-card-border bg-white deal-shadow animate-fade-up">
      <SecurityBanner deal={deal} />

      <div className="px-5 pb-6 pt-5 sm:px-7 sm:pb-8 sm:pt-6">

        <div className="flex items-center">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[--text-tertiary]">
            {NETWORK_LABEL[deal.network] || deal.network}
          </p>
        </div>

        <div className="mt-5 flex items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[--text-tertiary] mb-1">
              Amount
            </p>
            <p
              className="tabular-nums text-[38px] font-semibold leading-none tracking-tight text-[--text-primary] sm:text-[46px]"
              aria-label={`${amountDisplay} ${deal.asset}`}
            >
              {amountDisplay}
              <span className="ml-2 text-[22px] font-medium text-[--text-tertiary] sm:text-[28px]">
                {deal.asset}
              </span>
            </p>
          </div>
          <DealStatusBadge deal={deal} />
        </div>

        <div className="mt-6 border-t border-[--border] pt-5 space-y-3">
          <FullAddressRow label="Creator" address={deal.creator?.address} display={deal.creator?.label} />
          <FullAddressRow label="Seller" address={deal.seller?.address} display={deal.seller?.label} />
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[--text-tertiary]">
              Your role
            </p>
            <p className="text-xs font-medium capitalize text-[--text-secondary]">
              {supportModerating ? 'Support' : deal.role}
            </p>
          </div>
        </div>

        {supportModerating ? (
          <SupportModerationBlock deal={deal} dealId={dealId} api={api} onRefresh={refreshDealAndMessages} />
        ) : null}

        {showEscrowUi ? (
          <ProgramEscrowBlock
            deal={deal}
            escrowComplete={escrowComplete}
          />
        ) : null}

        {solWalletMismatch ? (
          <div className="mt-4">
            <InlineAlert variant="warning">
              Sign with the wallet matching your Triangle address:{' '}
              <span className="font-mono">
                {solAddress?.slice(0, 6)}…{solAddress?.slice(-4)}
              </span>
            </InlineAlert>
          </div>
        ) : null}
        {showEscrowUi && deal.role === 'creator' && !solWallet && !solWalletMismatch ? (
          <div className="mt-4">
            <InlineAlert variant="warning">Connect a Solana wallet in Privy to use escrow.</InlineAlert>
          </div>
        ) : null}

        {err ? (
          <div className="mt-4">
            <InlineAlert variant="error">{err}</InlineAlert>
          </div>
        ) : null}

        {escrowNotice ? (
          <div className="mt-4">
            <InlineAlert variant={escrowNotice.variant}>{escrowNotice.text}</InlineAlert>
          </div>
        ) : null}

        <div className="mt-6 space-y-2.5">
          {primaryAction ? (
            <PrimaryButton
              onClick={primaryAction.onClick}
              disabled={primaryAction.disabled}
              variant={primaryAction.variant}
            >
              {primaryAction.label}
            </PrimaryButton>
          ) : null}

          {deal.role === 'creator' && deal.status === 'open' ? (
            <p className="py-1 text-center text-xs text-[--text-tertiary]">
              Share this link with your counterparty to get started
            </p>
          ) : null}

          <div className="flex gap-2 pt-0.5">
            <GhostButton
              onClick={onCheckPayment}
              disabled={!deal?.escrow_program_configured || escrowBusy}
            >
              Check payment
            </GhostButton>
            {showEscrowUi && !deal.escrow_pda && !escrowComplete ? (
              <GhostButton
                onClick={onInitEscrow}
                disabled={!creatorCanFund || escrowBusy}
                accent
              >
                {escrowBusy ? 'Creating…' : 'Create Escrow'}
              </GhostButton>
            ) : null}
            {supportModerating ? null : deal.support_requested ? (
              <GhostButton disabled>
                ✓ Support called
              </GhostButton>
            ) : (
              <GhostButton
                onClick={onCallSupport}
                disabled={callingSupport}
                accent
              >
                {callingSupport ? 'Calling…' : 'Call Support'}
              </GhostButton>
            )}
          </div>

        </div>
      </div>
    </div>
  )

  if (isBlinkView) {
    return (
      <BlinkShell>
        {dealCard}
        <SupportModal open={supportOpen} onClose={() => setSupportOpen(false)} />
      </BlinkShell>
    )
  }


  return (
    <PageChrome>
      <div className="mx-auto mt-6 max-w-md">
        {dealCard}

        {chatLive ? (
          <ChatSection
            messages={messages}
            chatError={chatError}
            escrowComplete={escrowComplete}
            escrowStatus={deal?.escrow_status}
            body={body}
            setBody={setBody}
            sending={sending}
            onSend={onSend}
            chatReadOnly={deal?.status === 'cancelled'}
          />
        ) : deal?.status === 'open' ? (
          <p className="mt-5 text-center text-xs text-[--text-tertiary]">
            Chat opens after the deal is accepted.
          </p>
        ) : null}

      </div>

      <SupportModal open={supportOpen} onClose={() => setSupportOpen(false)} />
    </PageChrome>
  )
}
