import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePrivy } from '@privy-io/react-auth'
import { useAuthApi } from '../useAuthApi.js'
import { AmbientBg } from '../components/PageChrome.jsx'
import { useTriangleSolanaAddress } from '../useTriangleSolanaAddress.js'

const NETWORK_VALUE = 'solana-devnet'
const NETWORK_DISPLAY = 'Solana Devnet'


const XAU_FEED_HEX =
  import.meta.env.VITE_XAU_PYTH_FEED_HEX ||
  '765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2'

const DEMO_RWA_MINT = import.meta.env.VITE_DEMO_RWA_MINT || ''

export default function NewDealPage() {
  const { user: privyUser } = usePrivy()
  const api = useAuthApi()
  const navigate = useNavigate()
  const solAddress = useTriangleSolanaAddress()

  const [assetKind, setAssetKind] = useState('sol') 
  const [amount, setAmount] = useState('')
  const [rwaMint, setRwaMint] = useState(DEMO_RWA_MINT)
  const [deadlineMinutes, setDeadlineMinutes] = useState('2')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    ;(async () => {
      try {
        const email = privyUser?.email?.address ?? null
        await api('/auth/sync', {
          method: 'POST',
          body: JSON.stringify({ email, solana_address: solAddress ?? null }),
        })
      } catch {
        
      }
    })()
  }, [api, privyUser?.email?.address, solAddress])

  async function onSubmit(e) {
    e.preventDefault()
    setErr('')
    setSaving(true)
    try {
      const email = privyUser?.email?.address ?? null
      await api('/auth/sync', {
        method: 'POST',
        body: JSON.stringify({ email, solana_address: solAddress ?? null }),
      })

      let body
      if (assetKind === 'rwa') {
        if (!rwaMint.trim()) {
          setErr('Enter the rwaGOLD mint address')
          return
        }
        body = JSON.stringify({
          amount,
          network: NETWORK_VALUE,
          escrow_kind: 'rwa',
          asset: 'rwaGOLD',
          rwa_mint: rwaMint.trim(),
          rwa_pyth_feed_hex: XAU_FEED_HEX,
          rwa_collateral_decimals: 6,
          payment_deadline_minutes: Number(deadlineMinutes) || 2,
        })
      } else {
        body = JSON.stringify({ amount, network: NETWORK_VALUE, asset: 'SOL' })
      }

      const { deal } = await api('/deals', { method: 'POST', body })
      navigate(`/deals/${deal.id}`)
    } catch (e2) {
      setErr(e2.message || 'Request failed')
    } finally {
      setSaving(false)
    }
  }

  const isRwa = assetKind === 'rwa'

  return (
    <div className="min-h-dvh px-4 py-10 sm:px-6">
      <AmbientBg />
      <div className="mx-auto max-w-md animate-fade-up">

        <header className="mt-4 mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-(--text-primary) sm:text-3xl">
            New deal
          </h1>
          <p className="mt-1.5 text-sm text-(--text-secondary)">
            {isRwa
              ? 'Buyer locks rwaGOLD as collateral and pays SOL · seller receives SOL, buyer reclaims rwaGOLD.'
              : 'Create a SOL listing on Solana Devnet and share the deal link with your counterparty.'}
          </p>
        </header>

        <div className="rounded-[20px] border deal-card-border bg-white/85 p-6 backdrop-blur-md deal-shadow">
          <form onSubmit={onSubmit} className="space-y-6">

            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-(--text-tertiary)">
                Network
              </p>
              <div className="flex items-center gap-2 rounded-2xl border border-(--border) bg-slate-50/60 px-4 py-3">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="text-sm font-medium text-(--text-secondary)">{NETWORK_DISPLAY}</span>
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-(--text-tertiary)">
                Escrow type
              </p>
              <div className="flex rounded-2xl border border-(--border) bg-slate-50/60 p-1 gap-1">
                {[
                  { value: 'sol', label: 'SOL' },
                  { value: 'rwa', label: 'rwaGOLD (RWA)' },
                ].map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setAssetKind(value)}
                    className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium transition-all cursor-pointer ${
                      assetKind === value
                        ? 'bg-white text-(--text-primary) shadow-sm border border-(--border)'
                        : 'text-(--text-tertiary) hover:text-(--text-secondary)'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {isRwa && (
              <>
                <div>
                  <label className="block">
                    <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-(--text-tertiary)">
                      rwaGOLD Mint address <span className="text-rose-400">*</span>
                    </span>
                    <input
                      required
                      type="text"
                      value={rwaMint}
                      onChange={(e) => setRwaMint(e.target.value)}
                      placeholder="Mint address on Devnet…"
                      className="w-full rounded-2xl border border-(--border) bg-slate-50/60 px-4 py-3 font-mono text-xs text-(--text-primary) outline-none transition-all placeholder:text-(--text-tertiary) focus:border-(--accent-border) focus:bg-white focus:ring-2 focus:ring-(--accent-light)"
                    />
                    <p className="mt-1 text-[10px] text-(--text-tertiary)">
                      Pyth feed: XAU/USD · collateral 110% of deal amount
                    </p>
                  </label>
                </div>
                <div>
                  <label className="block">
                    <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-(--text-tertiary)">
                      Payment deadline (minutes)
                    </span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={deadlineMinutes}
                      onChange={(e) => setDeadlineMinutes(e.target.value)}
                      className="w-full rounded-2xl border border-(--border) bg-slate-50/60 px-4 py-3 text-sm text-(--text-primary) outline-none transition-all placeholder:text-(--text-tertiary) focus:border-(--accent-border) focus:bg-white focus:ring-2 focus:ring-(--accent-light)"
                    />
                    <p className="mt-1 text-[10px] text-(--text-tertiary)">
                      After collateral is deposited, buyer has this many minutes to pay SOL.
                    </p>
                  </label>
                </div>
              </>
            )}

            <label className="block">
              <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-(--text-tertiary)">
                {isRwa ? 'Amount (SOL)' : 'Amount'}{' '}
                <span className="text-rose-400">*</span>
              </span>
              <div className="relative">
                {isRwa && (
                  <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm text-(--text-tertiary)">
                    SOL
                  </span>
                )}
                <input
                  required
                  type="number"
                  min="0"
                  step="any"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className={`w-full rounded-2xl border border-(--border) bg-slate-50/60 py-3 text-sm text-(--text-primary) outline-none transition-all placeholder:text-(--text-tertiary) focus:border-(--accent-border) focus:bg-white focus:ring-2 focus:ring-(--accent-light) ${isRwa ? 'pl-4 pr-14' : 'px-4'}`}
                  placeholder={isRwa ? '0.5' : '0.5'}
                />
              </div>
              {isRwa && (
                <p className="mt-1 text-[10px] text-(--text-tertiary)">
                  Buyer pays this amount in SOL · rwaGOLD collateral locked at 110% USD equivalent
                </p>
              )}
            </label>

            {err ? (
              <p className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-xs text-red-800">
                {err}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-full py-3.5 text-sm font-semibold text-white shadow-sm transition-all hover:brightness-110 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              style={{ background: saving ? 'hsl(260 15% 40%)' : 'hsl(260 25% 11%)' }}
            >
              {saving ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Creating…
                </span>
              ) : (
                'Create deal'
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
