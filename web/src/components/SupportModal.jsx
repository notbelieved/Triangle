import { useEffect } from 'react'

const email = import.meta.env.VITE_SUPPORT_EMAIL || 'support@triangle.app'

export default function SupportModal({ open, onClose }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'oklch(18% 0.04 255 / 0.35)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="support-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-[20px] border border-[--border] bg-white p-6 deal-shadow animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="support-title" className="text-base font-semibold text-[--text-primary]">
          Support
        </h2>
        <p className="mt-2.5 text-sm leading-relaxed text-[--text-secondary]">
          Need help with Triangle or your deals? Reach out and we'll get back to you.
        </p>
        <a
          href={`mailto:${email}?subject=Triangle%20support`}
          className="mt-5 inline-flex rounded-[14px] px-4 py-2.5 text-sm font-semibold text-white transition-all hover:brightness-105"
          style={{ background: 'linear-gradient(135deg, oklch(50% 0.14 283), oklch(56% 0.12 295))' }}
        >
          Email {email}
        </a>
        <button
          type="button"
          onClick={onClose}
          className="mt-3 block w-full rounded-[14px] border border-[--border] py-2.5 text-sm font-medium text-[--text-secondary] hover:bg-[--accent-light] hover:text-[--accent] transition-colors cursor-pointer"
        >
          Close
        </button>
      </div>
    </div>
  )
}
