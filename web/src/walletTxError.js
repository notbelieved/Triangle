
export function formatWalletTxError(err) {
  if (!err) return 'Transaction failed'
  const msgs = []
  const seen = new Set()
  let e = err
  for (let i = 0; i < 10 && e && !seen.has(e); i++) {
    seen.add(e)
    if (typeof e === 'string') {
      if (!msgs.includes(e)) msgs.push(e)
      break
    }
    const m = e?.message
    if (typeof m === 'string' && m.trim() && !msgs.includes(m)) msgs.push(m.trim())
    const logs = e?.logs ?? e?.simulationResponse?.logs
    if (Array.isArray(logs) && logs.length) {
      const tail = logs.filter(Boolean).slice(-4).join(' · ')
      if (tail && !msgs.some((x) => x.includes(tail.slice(0, 40)))) msgs.push(`Logs: ${tail}`)
    }
    const instr = e?.instructionError ?? e?.InstructionError
    if (instr != null && !msgs.some((x) => x.startsWith('Program'))) {
      msgs.push(`Instruction: ${JSON.stringify(instr)}`)
    }
    e = e.cause ?? e.originalError ?? e.inner ?? e?.data?.err ?? e?.err
  }
  let out = msgs.filter(Boolean).join(' — ') || 'Transaction failed'
  if (/^unexpected error\.?$/i.test(out.trim()) || /^unexpected error$/i.test(out.trim())) {
    out =
      'Unexpected error (wallet did not expose details). Usual fixes: Phantom on Solana Devnet; enough SOL on that address for fees; confirm (not Cancel) in the wallet popup; Triangle profile Solana address must match the signing wallet.'
  } else if (/unexpected error/i.test(out) && out.length < 120) {
    out +=
      ' · Also check: Devnet, SOL for fees, same wallet as in Triangle, Approve in wallet.'
  }
  return out
}
