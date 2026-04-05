import { Link } from 'react-router-dom'

export function AmbientBg() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      <div
        style={{
          position: 'absolute',
          width: '65%',
          height: '70%',
          top: '5%',
          left: '18%',
          background: 'radial-gradient(ellipse at 45% 50%, oklch(87% 0.09 320 / 0.75), transparent 70%)',
          filter: 'blur(48px)',
          animation: 'float-pink 10s ease-in-out infinite',
        }}
      />
      <div
        style={{
          position: 'absolute',
          width: '55%',
          height: '60%',
          top: '15%',
          right: '-5%',
          background: 'radial-gradient(ellipse at 55% 50%, oklch(91% 0.12 118 / 0.70), transparent 70%)',
          filter: 'blur(44px)',
          animation: 'float-green 12s ease-in-out infinite',
        }}
      />
      <div
        style={{
          position: 'absolute',
          width: '40%',
          height: '45%',
          top: '-5%',
          left: '-8%',
          background: 'radial-gradient(ellipse at 50% 50%, oklch(88% 0.08 220 / 0.45), transparent 70%)',
          filter: 'blur(52px)',
          animation: 'float-blue 14s ease-in-out infinite',
        }}
      />
    </div>
  )
}

export function PageChrome({ children, title, subtitle, backTo, backLabel = 'Back' }) {
  return (
    <div className="min-h-dvh px-4 py-10 sm:px-6">
      <AmbientBg />
      <div className="mx-auto max-w-3xl animate-fade-up">
        {backTo ? (
          <Link
            to={backTo}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[--text-secondary] hover:text-[--accent] transition-colors"
          >
            {backLabel}
          </Link>
        ) : null}
        {title ? (
          <header className={backTo ? 'mt-4' : ''}>
            <h1 className="text-2xl font-semibold tracking-tight text-[--text-primary] sm:text-3xl">
              {title}
            </h1>
            {subtitle ? (
              <p className="mt-2 text-sm text-[--text-secondary]">{subtitle}</p>
            ) : null}
          </header>
        ) : null}
        {children}
      </div>
    </div>
  )
}

export function Card({ className = '', children }) {
  return (
    <div
      className={`rounded-[20px] border bg-white/85 p-6 backdrop-blur-md deal-card-border deal-shadow ${className}`}
    >
      {children}
    </div>
  )
}
