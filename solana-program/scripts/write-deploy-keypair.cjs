/**
 * One-off: DEPLOY_SECRET=base58 node write-deploy-keypair.cjs
 * Writes JSON keypair to TRI_DEPLOY_KEYPAIR_OUT or tmp/triangle-deploy.json.
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const bs58mod = require('bs58')
const { Keypair } = require('@solana/web3.js')

const b58decode =
  typeof bs58mod.decode === 'function' ? bs58mod.decode : bs58mod.default.decode

const b58 = process.env.DEPLOY_SECRET
if (!b58) {
  console.error('Set DEPLOY_SECRET to base58 private key')
  process.exit(1)
}
const sk = b58decode(b58)
const kp = Keypair.fromSecretKey(sk)
const out =
  process.env.TRI_DEPLOY_KEYPAIR_OUT ||
  path.join(os.tmpdir(), 'triangle-deploy.json')
fs.writeFileSync(out, JSON.stringify(Array.from(kp.secretKey)))
try {
  fs.chmodSync(out, 0o600)
} catch {
  /* Windows */
}
console.log('Wrote', out)
console.log('Public key:', kp.publicKey.toBase58())
