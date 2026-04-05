import CopyTextButton from './CopyTextButton.jsx'

export default function EscrowAddressBanner({
  title = 'Escrow address',
  address,
  hint,
}) {
  if (!address) return null
  return (
    <div className="flex flex-col gap-3 rounded-[20px] border border-[--accent-border] bg-[--accent-light] px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-[--accent]">
          {title}
        </p>
        <p className="mt-1.5 break-all font-mono text-[11px] leading-relaxed text-[--text-tertiary]">
          {address}
        </p>
        {hint ? (
          <p className="mt-1.5 text-[11px] text-[--text-tertiary]">{hint}</p>
        ) : null}
      </div>
      <div className="shrink-0">
        <CopyTextButton text={address} label="Copy" />
      </div>
    </div>
  )
}
