import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { usePrivy } from '@privy-io/react-auth'
import { useAuthApi } from '../useAuthApi.js'
import { AmbientBg, Card, PageChrome } from '../components/PageChrome.jsx'
import { useTriangleSolanaAddress } from '../useTriangleSolanaAddress.js'
import { formatDealAmount } from '../formatAmount.js'

const NETWORK_LABEL = { 'solana-devnet': 'Solana Devnet' }
const POLL_MS = 2800

const STATUS_STYLE = {
  open:     'bg-slate-100 text-slate-500',
  accepted: 'bg-[--accent-light] text-[--accent]',
  funded:   'bg-emerald-50 text-emerald-700',
  released: 'bg-emerald-50 text-emerald-500',
  refunded: 'bg-amber-50 text-amber-700',
}

export default function DealsPage() {
  const { user: privyUser } = usePrivy()
  const api = useAuthApi()
  const solAddress = useTriangleSolanaAddress()
  const [deals, setDeals] = useState([])
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  const fetchDealsList = useCallback(async () => {
    const { deals: list } = await api('/deals')
    setDeals(list || [])
  }, [api])

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
        await fetchDealsList()
        if (!cancelled) setErr('')
      } catch (e) {
        if (!cancelled) setErr(e.message || 'Failed to load')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [api, fetchDealsList, privyUser?.email?.address, solAddress])

  useEffect(() => {
    if (loading) return undefined
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      fetchDealsList().catch(() => {})
    }, POLL_MS)
    return () => clearInterval(id)
  }, [loading, fetchDealsList])

  if (loading) {
    return (
      <div className="min-h-dvh px-4 py-10 sm:px-6">
        <AmbientBg />
        <div className="mx-auto max-w-3xl">
          <div className="flex items-center gap-2 animate-pulse">
            {[1,2,3].map(i => (
              <div key={i} className="h-2 w-2 rounded-full bg-[--accent-border]" style={{ animationDelay: `${i * 0.15}s` }} />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (err) {
    return (
      <PageChrome title="Something went wrong">
        <div className="mt-6 rounded-[20px] border border-red-100 bg-red-50/80 p-5">
          <p className="text-sm font-medium text-red-800">{err}</p>
          <p className="mt-2 text-sm text-red-700/80">
            Check that the API and PostgreSQL are running and{' '}
            <code className="rounded-md bg-red-100 px-1 py-0.5 text-xs">server/.env</code> is valid.
          </p>
        </div>
      </PageChrome>
    )
  }

  return (
    <div className="min-h-dvh px-4 py-10 sm:px-6">
      <AmbientBg />
      <div className="mx-auto max-w-3xl animate-fade-up">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[--text-primary] sm:text-3xl">
              Deals
            </h1>
            <p className="mt-1 text-sm text-[--text-secondary]">
              Your open listings and active deals on Solana Devnet
            </p>
          </div>
          <Link
            to="/deals/new"
            className="shrink-0 rounded-full px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:brightness-110 active:scale-95 transition-all"
            style={{ background: 'hsl(260 25% 11%)' }}
          >
            + New deal
          </Link>
        </div>

        <section className="mt-8">
          {deals.length === 0 ? (
            <Card className="flex flex-col items-center py-16 text-center">
              <div
                className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl text-white"
                style={{ background: 'linear-gradient(135deg, oklch(88% 0.09 320), oklch(91% 0.12 118))' }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </div>
              <p className="text-base font-semibold text-[--text-primary]">No deals yet</p>
              <p className="mt-1.5 max-w-xs text-sm text-[--text-secondary]">
                Create your first listing. Anyone on Solana Devnet can accept it.
              </p>
              <Link
                to="/deals/new"
                className="mt-6 rounded-full px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:brightness-110 transition-all"
                style={{ background: 'hsl(260 25% 11%)' }}
              >
                Make a deal
              </Link>
            </Card>
          ) : (
            <div className="overflow-hidden rounded-[20px] border deal-card-border bg-white/85 backdrop-blur-md deal-shadow">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-[--border]">
                    <th className="px-5 py-3.5 text-[10px] font-semibold uppercase tracking-wider text-[--text-tertiary]">Deal</th>
                    <th className="px-5 py-3.5 text-[10px] font-semibold uppercase tracking-wider text-[--text-tertiary]">Network</th>
                    <th className="px-5 py-3.5 text-[10px] font-semibold uppercase tracking-wider text-[--text-tertiary]">Asset</th>
                    <th className="px-5 py-3.5 text-[10px] font-semibold uppercase tracking-wider text-[--text-tertiary]">Amount</th>
                    <th className="px-5 py-3.5 text-[10px] font-semibold uppercase tracking-wider text-[--text-tertiary]">Role</th>
                    <th className="px-5 py-3.5 text-[10px] font-semibold uppercase tracking-wider text-[--text-tertiary]">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {deals.map((d) => (
                    <tr
                      key={d.id}
                      onClick={() => navigate(`/deals/${d.id}`)}
                      className="border-b border-[--border] last:border-0 hover:bg-[--accent-light]/40 transition-colors cursor-pointer"
                    >
                      <td className="px-5 py-4 font-mono text-xs font-semibold text-[--accent]">
                        {d.id.slice(0, 8)}…
                      </td>
                      <td className="px-5 py-4 text-xs text-[--text-secondary]">
                        {NETWORK_LABEL[d.network] || d.network || '—'}
                      </td>
                      <td className="px-5 py-4">
                        <span className="rounded-full bg-[--accent-light] px-2.5 py-0.5 text-[11px] font-semibold text-[--accent]">
                          {d.asset || '—'}
                        </span>
                      </td>
                      <td className="px-5 py-4 font-mono text-sm text-[--text-primary]">
                        {d.amount != null ? formatDealAmount(d.amount) ?? d.amount : '—'}
                      </td>
                      <td className="px-5 py-4 capitalize text-xs text-[--text-secondary]">{d.role}</td>
                      <td className="px-5 py-4">
                        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize ${STATUS_STYLE[d.status] ?? 'bg-slate-100 text-slate-500'}`}>
                          {d.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
