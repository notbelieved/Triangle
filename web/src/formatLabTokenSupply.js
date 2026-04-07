
export function formatLabTokenSupply(supplyRawStr, decimals) {
  const raw = BigInt(supplyRawStr || '0')
  const d = Math.min(9, Math.max(0, Number(decimals) || 0))
  const s = raw.toString().padStart(d + 1, '0')
  if (d === 0) return s
  const i = s.length - d
  const whole = s.slice(0, i).replace(/^0+/, '') || '0'
  const frac = s.slice(i).replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : whole
}
