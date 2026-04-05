import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { PrivyProvider } from '@privy-io/react-auth'
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana'
import { createSolanaRpc, createSolanaRpcSubscriptions, devnet } from '@solana/kit'
import './index.css'
import App from './App.jsx'
import MissingPrivyConfig from './MissingPrivyConfig.jsx'
import AuthApiProvider from './AuthApiProvider.jsx'

const appId = import.meta.env.VITE_PRIVY_APP_ID?.trim()

const walletConnectCloudProjectId =
  import.meta.env.VITE_WALLETCONNECT_PROJECT_ID?.trim() ||
  'f9fdbf91d24bb3424072e37a30bc5056'

const privyConfig = {
  appearance: {
    theme: 'light',
    accentColor: '#171717',
    walletChainType: 'solana-only',
  },
  loginMethods: ['email', 'wallet'],
  embeddedWallets: {
    ethereum: {
      createOnLogin: 'off',
    },
    solana: {
      createOnLogin: 'users-without-wallets',
    },
  },
  walletConnectCloudProjectId,
  externalWallets: {
    solana: { connectors: toSolanaWalletConnectors() },
  },
  solana: {
    rpcs: {
      'solana:devnet': {
        rpc: createSolanaRpc(devnet('https://api.devnet.solana.com')),
        rpcSubscriptions: createSolanaRpcSubscriptions(devnet('wss://api.devnet.solana.com')),
        blockExplorerUrl: 'https://explorer.solana.com/?cluster=devnet',
      },
    },
  },
}

const splash = document.getElementById('splash')
if (splash) {
  splash.classList.add('hide')
  setTimeout(() => splash.remove(), 500)
}

const root = createRoot(document.getElementById('root'))

root.render(
  <StrictMode>
    {appId ? (
      <PrivyProvider appId={appId} config={privyConfig}>
        <BrowserRouter>
          <AuthApiProvider>
            <App />
          </AuthApiProvider>
        </BrowserRouter>
      </PrivyProvider>
    ) : (
      <MissingPrivyConfig />
    )}
  </StrictMode>,
)
