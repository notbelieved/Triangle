import { useState } from 'react'
import { Link } from 'react-router-dom'
import { usePrivy } from '@privy-io/react-auth'
import { ArrowRight, Menu, X } from 'lucide-react'
import SupportModal from '../components/SupportModal.jsx'
import WatercolorParticles from '../components/WatercolorParticles.jsx'
import { useIsSupport } from '../useIsSupport.js'
import TriangleMark from '../components/TriangleMark.jsx'

function TrustedSvg() {
  return (
    <svg className="trusted-svg" viewBox="0 0 170 50" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <defs>
        <linearGradient id="text-fill-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="hsl(260 10% 20%)" />
          <stop offset="50%"  stopColor="hsl(260 10% 50%)" />
          <stop offset="100%" stopColor="hsl(260 10% 20%)" />
        </linearGradient>
        <linearGradient id="accent-shine" x1="100%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="transparent">
            <animate attributeName="offset" values="-0.5;1.5" dur="4s" repeatCount="indefinite" />
          </stop>
          <stop offset="15%" stopColor="hsl(283 48% 72% / 0.72)">
            <animate attributeName="offset" values="-0.35;1.65" dur="4s" repeatCount="indefinite" />
          </stop>
          <stop offset="30%" stopColor="transparent">
            <animate attributeName="offset" values="-0.2;1.8" dur="4s" repeatCount="indefinite" />
          </stop>
        </linearGradient>
        <filter id="soft-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="0.8" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <text x="50%" y="40" textAnchor="middle" className="trusted-text-base">
        trusted
      </text>
      <text x="50%" y="40" textAnchor="middle" className="trusted-shine-stroke" filter="url(#soft-glow)">
        trusted
      </text>
    </svg>
  )
}

function NavPill({ authenticated, isSupport }) {
  if (!authenticated) return null
  return (
    <nav
      className="hidden lg:flex items-center absolute left-1/2 -translate-x-1/2"
      aria-label="Main navigation"
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '2px',
          padding: '6px 12px',
          borderRadius: '9999px',
          background: 'rgba(255,255,255,0.72)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: '1px solid rgba(0,0,0,0.07)',
          boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        }}
      >
        <Link to="/deals" className="nav-pill-link">Deals</Link>
        <Link to="/deals/new" className="nav-pill-link">New deal</Link>
        <Link to="/profile" className="nav-pill-link">Profile</Link>
        {isSupport ? <Link to="/support" className="nav-pill-link">Support</Link> : null}
      </div>
    </nav>
  )
}

export default function HomePage() {
  const { ready, authenticated, login, logout } = usePrivy()
  const isSupport = useIsSupport()
  const [supportOpen, setSupportOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  if (!ready) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <p className="text-(--text-tertiary) text-sm">Loading…</p>
      </div>
    )
  }

  return (
    <div className="relative min-h-dvh overflow-x-hidden">

      <header
        className="fixed top-0 left-0 right-0 z-50"
        style={{
          background: 'rgba(255,255,255,0.75)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
        }}
      >
        <div className="mx-auto flex items-center justify-between h-16 px-4 lg:px-8 max-w-6xl relative">

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

          <NavPill authenticated={authenticated} isSupport={isSupport} />

          <div className="flex items-center gap-2 shrink-0">
            {authenticated ? (
              <button
                type="button"
                onClick={() => logout()}
                className="rounded-full px-5 py-2 text-sm font-semibold text-white shadow-sm hover:brightness-110 active:scale-95 transition-all cursor-pointer"
                style={{ background: 'hsl(260 25% 11%)' }}
              >
                Sign out
              </button>
            ) : (
              <button
                type="button"
                onClick={() => login()}
                className="rounded-full px-5 py-2 text-sm font-semibold text-white shadow-sm hover:brightness-110 active:scale-95 transition-all cursor-pointer"
                style={{ background: 'hsl(260 25% 11%)' }}
              >
                Connect Wallet
              </button>
            )}

            <button
              type="button"
              aria-label="Toggle menu"
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen(!mobileOpen)}
              className="lg:hidden flex h-9 w-9 items-center justify-center rounded-full hover:bg-black/5 transition-colors cursor-pointer text-(--text-primary)"
            >
              {mobileOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>

        {mobileOpen && (
          <div className="lg:hidden border-t border-black/5 px-4 py-4 space-y-1 bg-white/90 backdrop-blur-xl animate-fade-in">
            {authenticated ? (
              <>
                <Link to="/deals/new" onClick={() => setMobileOpen(false)}
                  className="block px-4 py-3 rounded-xl text-sm font-medium text-(--text-primary) hover:bg-black/5 transition-colors">
                  Make a deal
                </Link>
                <Link to="/deals" onClick={() => setMobileOpen(false)}
                  className="block px-4 py-3 rounded-xl text-sm font-medium text-(--text-primary) hover:bg-black/5 transition-colors">
                  Deals
                </Link>
                <Link to="/profile" onClick={() => setMobileOpen(false)}
                  className="block px-4 py-3 rounded-xl text-sm font-medium text-(--text-primary) hover:bg-black/5 transition-colors">
                  Profile
                </Link>
                {isSupport ? (
                  <Link to="/support" onClick={() => setMobileOpen(false)}
                    className="block px-4 py-3 rounded-xl text-sm font-medium text-(--text-primary) hover:bg-black/5 transition-colors">
                    Support
                  </Link>
                ) : null}
                <Link to="/deals/new" onClick={() => setMobileOpen(false)}
                  className="block px-4 py-3 rounded-xl text-sm font-medium text-(--text-primary) hover:bg-black/5 transition-colors">
                  Create token
                </Link>
              </>
            ) : null}
            <button type="button" onClick={() => { setSupportOpen(true); setMobileOpen(false) }}
              className="block w-full text-left px-4 py-3 rounded-xl text-sm font-medium text-(--text-tertiary) hover:bg-black/5 transition-colors cursor-pointer">
              Support
            </button>
          </div>
        )}
      </header>

      <section
        className="relative min-h-screen flex flex-col justify-center px-4 pt-24 pb-20 overflow-hidden"
        style={{ isolation: 'isolate' }}
      >
        <WatercolorParticles />

        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 left-0 right-0 h-32"
          style={{ background: 'linear-gradient(to top, rgba(255,255,255,0.9), transparent)', zIndex: 2 }}
        />

        <div className="relative mx-auto w-full max-w-6xl pointer-events-none" style={{ zIndex: 3 }}>
          <div className="ml-4 md:ml-8 lg:ml-16 animate-fade-up">
            <p className="text-(--text-tertiary) text-base md:text-lg mb-5 font-medium">
              The crypto app for everyone
            </p>

            <h1
              className="font-bold tracking-tight mb-8 flex flex-col gap-2"
              style={{ fontSize: 'clamp(2.5rem, 7vw, 5rem)', lineHeight: 1.1 }}
            >
              <span className="flex items-center flex-wrap gap-2">
                <span>Your</span>
                <TrustedSvg />
              </span>
              <span>companion</span>
            </h1>

            <div className="pointer-events-auto">
              {authenticated ? (
                <Link
                  to="/deals/new"
                  className="inline-flex items-center gap-2 rounded-full px-7 py-3.5 text-base font-semibold text-white shadow-md hover:brightness-110 active:scale-95 transition-all group"
                  style={{ background: 'hsl(260 25% 11%)' }}
                >
                  Make a deal
                  <ArrowRight size={18} className="group-hover:translate-x-0.5 transition-transform" />
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => login()}
                  className="inline-flex items-center gap-2 rounded-full px-7 py-3.5 text-base font-semibold text-white shadow-md hover:brightness-110 active:scale-95 transition-all cursor-pointer group"
                  style={{ background: 'hsl(260 25% 11%)' }}
                >
                  Make a deal
                  <ArrowRight size={18} className="group-hover:translate-x-0.5 transition-transform" />
                </button>
              )}
            </div>
          </div>
        </div>
      </section>


      <SupportModal open={supportOpen} onClose={() => setSupportOpen(false)} />
    </div>
  )
}
