import { useState } from 'react'

export default function CopyTextButton({ text, className = '', label = 'Copy' }) {
  const [done, setDone] = useState(false)

  async function onCopy() {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setDone(true)
      setTimeout(() => setDone(false), 2000)
    } catch {
      setDone(false)
    }
  }

  return (
    <button
      type="button"
      onClick={onCopy}
      disabled={!text}
      className={
        className ||
        'rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40'
      }
    >
      {done ? 'Copied' : label}
    </button>
  )
}
