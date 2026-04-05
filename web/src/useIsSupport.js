import { useEffect, useState } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { useAuthApi } from './useAuthApi.js'
import { useTriangleSolanaAddress } from './useTriangleSolanaAddress.js'

const CACHE_KEY = 'triangle_is_support'

export function useIsSupport() {
  const { user: privyUser, ready, authenticated } = usePrivy()
  const api = useAuthApi()
  const solAddress = useTriangleSolanaAddress()
  const [isSupport, setIsSupport] = useState(() => sessionStorage.getItem(CACHE_KEY) === '1')

  useEffect(() => {
    if (!ready || !authenticated) {
      sessionStorage.removeItem(CACHE_KEY)
      setIsSupport(false)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const email = privyUser?.email?.address ?? null
        const { user } = await api('/auth/sync', {
          method: 'POST',
          body: JSON.stringify({ email, solana_address: solAddress ?? null }),
        })
        if (cancelled) return
        const flag = Boolean(user?.is_support)
        setIsSupport(flag)
        sessionStorage.setItem(CACHE_KEY, flag ? '1' : '0')
      } catch {}
    })()
    return () => { cancelled = true }
  }, [ready, authenticated, api, privyUser?.email?.address, solAddress])

  return isSupport
}
