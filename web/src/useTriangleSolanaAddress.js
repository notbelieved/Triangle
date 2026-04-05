import { useMemo } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { useWallets as useSolanaWallets } from '@privy-io/react-auth/solana'

function pickSolanaFromLinkedAccounts(user) {
  if (!user?.linkedAccounts?.length) return null
  const sol = user.linkedAccounts.filter((a) => a.type === 'wallet' && a.chainType === 'solana')
  if (!sol.length) return null
  const embedded = sol.find(
    (w) => w.walletClientType === 'privy' || w.walletClientType === 'privy-v2',
  )
  if (embedded) return embedded.address
  return sol[sol.length - 1].address
}


export function useTriangleSolanaAddress() {
  const { user } = usePrivy()
  const { wallets, ready } = useSolanaWallets()

  return useMemo(() => {
    const fromLinked = pickSolanaFromLinkedAccounts(user)
    if (fromLinked) return fromLinked
    if (user?.wallet?.chainType === 'solana') return user.wallet.address
    if (ready && wallets?.length) return wallets[0].address
    return null
  }, [user, ready, wallets])
}
