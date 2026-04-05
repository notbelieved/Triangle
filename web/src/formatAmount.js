export function formatDealAmount(value) {
  if (value == null || value === '') return null
  const s = String(value).trim()
  if (!s.includes('.')) return s
  const [whole, frac = ''] = s.split('.')
  const trimmedFrac = frac.replace(/0+$/, '')
  return trimmedFrac ? `${whole}.${trimmedFrac}` : whole
}
