/**
 * Reads server/.env SOLANA_AUTHORITY_PRIVATE_KEY (same formats as escrowApi) and writes JSON keypair.
 * Usage from repo root: node solana-program/scripts/write-payer-from-server-env.cjs
 */
const fs = require('fs')
const path = require('path')
const { createRequire } = require('module')
const serverPkg = path.join(__dirname, '../../server/package.json')
const requireServer = createRequire(serverPkg)

const envPath = path.join(__dirname, '../../server/.env')
if (!fs.existsSync(envPath)) {
  console.error('Missing', envPath)
  process.exit(1)
}
requireServer('dotenv').config({ path: envPath })

const bs58Pkg = requireServer('bs58')
const bs58 = typeof bs58Pkg.decode === 'function' ? bs58Pkg : bs58Pkg.default
const { Keypair } = requireServer('@solana/web3.js')

function u8FromNumberArray(arr) {
  if (!Array.isArray(arr) || arr.length < 64) return null
  const u8 = Uint8Array.from(arr)
  try {
    return Keypair.fromSecretKey(u8)
  } catch {
    return null
  }
}

function parseAuthorityPrivateKey(raw) {
  if (raw == null) return null
  let s = String(raw).trim().replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim()
  }
  if (!s) return null
  s = s.replace(/[\u200B-\u200D\uFEFF]/g, '')
  s = s.replace(/\\\r?\n/g, '')
  s = s.replace(/\\n/g, '')

  if (s.startsWith('{') || s.startsWith('[')) {
    try {
      const parsed = JSON.parse(s)
      if (Array.isArray(parsed)) {
        const kp = u8FromNumberArray(parsed)
        if (kp) return kp
      } else if (parsed && typeof parsed === 'object') {
        const sk =
          parsed.secretKey ?? parsed.secret_key ?? parsed.privateKey ?? parsed.private_key
        if (Array.isArray(sk)) {
          const kp = u8FromNumberArray(sk)
          if (kp) return kp
        }
      }
    } catch {
      /* fall through */
    }
  }

  const hexCompact = s.replace(/^0x/i, '').replace(/[\s:,-]/g, '')
  if (/^[0-9a-fA-F]+$/.test(hexCompact) && hexCompact.length >= 128) {
    try {
      const b = Buffer.from(hexCompact.slice(0, 128), 'hex')
      if (b.length === 64) return Keypair.fromSecretKey(b)
    } catch {
      /* */
    }
  }

  const b58 = s.replace(/\s/g, '')
  try {
    const buf = bs58.decode(b58)
    if (buf.length === 64) return Keypair.fromSecretKey(buf)
    if (buf.length === 32) return Keypair.fromSeed(buf)
  } catch {
    /* */
  }

  return null
}

const raw = process.env.SOLANA_AUTHORITY_PRIVATE_KEY
const kp = parseAuthorityPrivateKey(raw)
if (!kp) {
  console.error('SOLANA_AUTHORITY_PRIVATE_KEY missing or invalid in server/.env')
  process.exit(1)
}

const out = path.join(__dirname, '../.payer-deploy-temp.json')
fs.writeFileSync(out, JSON.stringify(Array.from(kp.secretKey)))
console.log('Wrote payer keypair:', out)
console.log('Payer public key:', kp.publicKey.toBase58())
