import { Navigate, Route, Routes } from 'react-router-dom'
import { usePrivy } from '@privy-io/react-auth'
import AppLayout from './components/AppLayout.jsx'
import HomePage from './pages/HomePage.jsx'
import DealsPage from './pages/DealsPage.jsx'
import NewDealPage from './pages/NewDealPage.jsx'
import DealDetailPage from './pages/DealDetailPage.jsx'
import SupportPage from './pages/SupportPage.jsx'
import ProfilePage from './pages/ProfilePage.jsx'
import ProfileTokenDetailPage from './pages/ProfileTokenDetailPage.jsx'

function Protected({ children }) {
  const { ready, authenticated } = usePrivy()
  if (!ready) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-8">
        <p className="text-slate-600">Loading…</p>
      </div>
    )
  }
  if (!authenticated) return <Navigate to="/" replace />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route
        element={
          <Protected>
            <AppLayout />
          </Protected>
        }
      >
        <Route path="/dashboard" element={<Navigate to="/deals" replace />} />
        <Route path="/profile/tokens/:mint" element={<ProfileTokenDetailPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/support" element={<SupportPage />} />
        <Route path="/deals/new" element={<NewDealPage />} />
        <Route path="/deals/:dealId" element={<DealDetailPage />} />
        <Route path="/deals" element={<DealsPage />} />
      </Route>
      <Route path="/cabinet" element={<Navigate to="/deals" replace />} />
      <Route path="/cabinet/deals/new" element={<Navigate to="/deals/new" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
