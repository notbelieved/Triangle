import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePrivy } from '@privy-io/react-auth'
import { useAuthApi } from '../useAuthApi.js'
import { AmbientBg } from '../components/PageChrome.jsx'
import { useTriangleSolanaAddress } from '../useTriangleSolanaAddress.js'

const NETWORK_VALUE = 'solana-devnet'
const NETWORK_DISPLAY = 'Solana Devnet'

export default function NewDealPage() {
  const { user: privyUser } = usePrivy()
  const api = useAuthApi()
  const navigate = useNavigate()
  const [amount, setAmount] = useState('')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const solAddress = useTriangleSolanaAddress()

  useEffect(() => {
    ;(async () => {
      try {
        const email = privyUser?.email?.address ?? null
        await api('/auth/sync', {
          method: 'POST',
          body: JSON.stringify({ email, solana_address: solAddress ?? null }),
        })
      } catch {}
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
      const { deal } = await api('/deals', {
        method: 'POST',
        body: JSON.stringify({ amount, network: NETWORK_VALUE, asset: 'SOL' }),
      })
      navigate(`/deals/${deal.id}`)
    } catch (e2) {
      setErr(e2.message || 'Request failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-dvh px-4 py-10 sm:px-6">
      <AmbientBg />
      <div className="mx-auto max-w-md animate-fade-up">

        <header className="mt-4 mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-[--text-primary] sm:text-3xl">
            New deal
          </h1>
          <p className="mt-1.5 text-sm text-[--text-secondary]">
            Create a listing on Solana Devnet. Anyone can accept an open deal.
          </p>
        </header>

        <div className="rounded-[20px] border deal-card-border bg-white/85 p-6 backdrop-blur-md deal-shadow">
          <form onSubmit={onSubmit} className="space-y-6">

            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-[--text-tertiary]">
                Network
              </p>
              <div className="flex items-center gap-2 rounded-2xl border border-[--border] bg-slate-50/60 px-4 py-3">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="text-sm font-medium text-[--text-secondary]">{NETWORK_DISPLAY}</span>
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-[--text-tertiary]">
                Asset
              </p>
              <div className="flex items-center gap-2 rounded-2xl border border-[--border] bg-slate-50/60 px-4 py-3">
                <span className="text-sm font-medium text-[--text-secondary]">SOL</span>
              </div>
            </div>

            <label className="block">
              <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-[--text-tertiary]">
                Amount <span className="text-rose-400">*</span>
              </span>
              <input
                required
                type="number"
                min="0"
                step="any"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full rounded-2xl border border-[--border] bg-slate-50/60 px-4 py-3 text-sm text-[--text-primary] outline-none transition-all placeholder:text-[--text-tertiary] focus:border-[--accent-border] focus:bg-white focus:ring-2 focus:ring-[--accent-light]"
              />
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
