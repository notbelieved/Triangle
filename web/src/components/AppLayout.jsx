import { Link, Outlet } from 'react-router-dom'
import { usePrivy } from '@privy-io/react-auth'
import { useIsSupport } from '../useIsSupport.js'
import TriangleMark from './TriangleMark.jsx'

const BTN_DARK = 'rounded-full px-5 py-2 text-sm font-semibold text-white shadow-sm hover:brightness-110 active:scale-95 transition-all cursor-pointer'
const BTN_DARK_STYLE = { background: 'hsl(260 25% 11%)' }

export default function AppLayout() {
  const { logout } = usePrivy()
  const isSupport = useIsSupport()

  return (
    <>
      <header
        className="fixed top-0 left-0 right-0 z-50"
        style={{
          background: 'rgba(255,255,255,0.75)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
        }}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between h-16 px-4 lg:px-8 relative">

          <Link
            to="/"
            className="inline-flex items-center gap-1.5 shrink-0 select-none"
            aria-label="Triangle home"
          >
            <TriangleMark className="h-8 w-8 shrink-0 translate-y-[3px]" />
            <span className="text-[17px] font-bold leading-none tracking-tight text-(--text-primary)">
              Triangle
            </span>
          </Link>

          <nav className="hidden lg:flex items-center absolute left-1/2 -translate-x-1/2">
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: '2px',
                padding: '6px 12px', borderRadius: '9999px',
                background: 'rgba(255,255,255,0.72)',
                backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
                border: '1px solid rgba(0,0,0,0.07)',
                boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
              }}
            >
              <Link to="/deals" className="nav-pill-link">Deals</Link>
              <Link to="/deals/new" className="nav-pill-link">New deal</Link>
              <Link to="/profile" className="nav-pill-link">Profile</Link>
              {isSupport && <Link to="/support" className="nav-pill-link">Support</Link>}
            </div>
          </nav>

          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={() => logout()}
              className={BTN_DARK}
              style={BTN_DARK_STYLE}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="pt-16">
        <main>
          <Outlet />
        </main>
      </div>
    </>
  )
}
