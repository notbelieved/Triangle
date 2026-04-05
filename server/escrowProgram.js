const crypto = require('crypto')
const {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} = require('@solana/web3.js')

const SYSTEM_PROGRAM_ID = SystemProgram.programId

function ixDisc(name) {
  return crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8)
}

const DISC = {
  initialize: ixDisc('initialize'),
  init_escrow: ixDisc('init_escrow'),
  deposit: ixDisc('deposit'),
  buyer_release: ixDisc('buyer_release'),
  release: ixDisc('release'),
  refund_to: ixDisc('refund_to'),
  set_frozen: ixDisc('set_frozen'),
}

function u64le(n) {
  const b = Buffer.allocUnsafe(8)
  b.writeBigUInt64LE(BigInt(n))
  return b
}

function uuidToDealIdBytes(uuid) {
  const hex = String(uuid).replace(/-/g, '')
  if (hex.length !== 32) throw new Error('Invalid deal UUID')
  return Buffer.from(hex, 'hex')
}

function getProgramId() {
  const id = process.env.TRIANGLE_ESCROW_PROGRAM_ID?.trim()
  if (!id) return null
  return new PublicKey(id)
}

function escrowPda(programId, dealIdBytes) {
  return PublicKey.findProgramAddressSync([Buffer.from('escrow', 'utf8'), dealIdBytes], programId)
}

function configPda(programId) {
  return PublicKey.findProgramAddressSync([Buffer.from('config', 'utf8')], programId)
}

/** True if the program’s global `config` PDA exists and is owned by the escrow program. */
async function isEscrowProgramConfigInitialized(connection, programId) {
  const [cfg] = configPda(programId)
  for (const commitment of ['finalized', 'confirmed']) {
    const info = await connection.getAccountInfo(cfg, commitment)
    if (info?.data?.length && info.owner.equals(programId)) return true
  }
  return false
}

/** Authority pubkey stored in Config (after 8-byte Anchor discriminator). */
function configAuthorityFromAccountData(data) {
  if (!data || data.length < 40) return null
  try {
    return new PublicKey(Buffer.from(data).subarray(8, 40))
  } catch {
    return null
  }
}

async function getEscrowConfigAuthority(connection, programId) {
  const [cfg] = configPda(programId)
  for (const commitment of ['finalized', 'confirmed']) {
    const info = await connection.getAccountInfo(cfg, commitment)
    if (!info?.data?.length || !info.owner.equals(programId)) continue
    const auth = configAuthorityFromAccountData(info.data)
    if (auth) return auth
  }
  return null
}

let _solanaRpcCache = { url: null, at: 0 }
const SOLANA_RPC_CACHE_MS = 90_000

function connectionCommitmentConfig() {
  return {
    commitment: 'confirmed',
    confirmTransactionInitialTimeout: 90_000,
  }
}

function solanaRpcEndpointCandidates() {
  const primary = process.env.SOLANA_RPC_URL?.trim()
  const fallbacks = (process.env.SOLANA_RPC_FALLBACK_URLS || '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const defaults = ['https://api.devnet.solana.com', 'https://rpc.ankr.com/solana_devnet']
  const fromPrimary = primary
    ? primary.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
    : []
  const head = [...fromPrimary, ...fallbacks]
  const merged = head.length ? [...head, ...defaults] : defaults
  return [...new Set(merged)]
}

function getConnection() {
  const url = solanaRpcEndpointCandidates()[0]
  return new Connection(url, connectionCommitmentConfig())
}

async function getSolanaConnection() {
  const candidates = solanaRpcEndpointCandidates()
  const now = Date.now()
  if (_solanaRpcCache.url && now - _solanaRpcCache.at < SOLANA_RPC_CACHE_MS) {
    if (candidates.includes(_solanaRpcCache.url)) {
      return new Connection(_solanaRpcCache.url, connectionCommitmentConfig())
    }
    _solanaRpcCache = { url: null, at: 0 }
  }

  let lastErr
  for (const url of candidates) {
    const conn = new Connection(url, connectionCommitmentConfig())
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await conn.getLatestBlockhash('confirmed')
        _solanaRpcCache = { url, at: now }
        return conn
      } catch (e) {
        lastErr = e
        await new Promise((r) => setTimeout(r, 350 * (attempt + 1)))
      }
    }
  }

  throw new Error(
    `Solana RPC unreachable (tried: ${candidates.join(' | ')}). Last: ${lastErr?.message || lastErr}. ` +
      'Try another SOLANA_RPC_URL (Helius/QuickNode/Alchemy devnet) or fix network/DNS.',
  )
}

function buildInitializeIx(programId, authorityPubkey, configPubkey) {
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: authorityPubkey, isSigner: true, isWritable: true },
      { pubkey: configPubkey, isSigner: false, isWritable: true },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: DISC.initialize,
  })
}

function buildInitEscrowIx(programId, buyer, seller, escrowPdaKey, dealIdBytes, expectedLamports) {
  const data = Buffer.concat([DISC.init_escrow, dealIdBytes, u64le(expectedLamports)])
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: buyer, isSigner: true, isWritable: true },
      { pubkey: seller, isSigner: false, isWritable: false },
      { pubkey: escrowPdaKey, isSigner: false, isWritable: true },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  })
}

function buildDepositIx(programId, buyer, escrowPdaKey, amountLamports) {
  const data = Buffer.concat([DISC.deposit, u64le(amountLamports)])
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: buyer, isSigner: true, isWritable: true },
      { pubkey: escrowPdaKey, isSigner: false, isWritable: true },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  })
}

function buildBuyerReleaseIx(programId, buyer, escrowKey, seller) {
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: buyer, isSigner: true, isWritable: true },
      { pubkey: escrowKey, isSigner: false, isWritable: true },
      { pubkey: seller, isSigner: false, isWritable: true },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: DISC.buyer_release,
  })
}

function buildReleaseIx(programId, authority, configKey, escrowKey, seller) {
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: configKey, isSigner: false, isWritable: false },
      { pubkey: escrowKey, isSigner: false, isWritable: true },
      { pubkey: seller, isSigner: false, isWritable: true },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: DISC.release,
  })
}

function buildRefundToIx(programId, authority, configKey, escrowKey, recipient) {
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: configKey, isSigner: false, isWritable: false },
      { pubkey: escrowKey, isSigner: false, isWritable: true },
      { pubkey: recipient, isSigner: false, isWritable: true },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: DISC.refund_to,
  })
}

function buildSetFrozenIx(programId, authority, configKey, escrowKey, dealIdBytes, frozen) {
  const data = Buffer.concat([DISC.set_frozen, dealIdBytes, Buffer.from([frozen ? 1 : 0])])
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: configKey, isSigner: false, isWritable: false },
      { pubkey: escrowKey, isSigner: false, isWritable: true },
    ],
    data,
  })
}

const ESCROW_ACCOUNT_DATA_LEN = 99

function parseEscrowAccountData(data) {
  if (!data || data.length < ESCROW_ACCOUNT_DATA_LEN) return null
  const buf = Buffer.from(data)
  let o = 8
  const dealId = buf.subarray(o, o + 16)
  o += 16
  const buyer = new PublicKey(buf.subarray(o, o + 32))
  o += 32
  const seller = new PublicKey(buf.subarray(o, o + 32))
  o += 32
  const expectedLamports = buf.readBigUInt64LE(o)
  o += 8
  const bump = buf.readUInt8(o)
  o += 1
  const status = buf.readUInt8(o)
  o += 1
  const frozen = buf.readUInt8(o) !== 0
  return { dealId, buyer, seller, expectedLamports, bump, status, frozen }
}

async function buildUnsignedTx(connection, feePayer, ...instructions) {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
  const tx = new Transaction({
    feePayer,
    recentBlockhash: blockhash,
  })
  instructions.forEach((ix) => tx.add(ix))
  const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false })
  return {
    transactionBase64: serialized.toString('base64'),
    blockhash,
    lastValidBlockHeight,
  }
}

module.exports = {
  DISC,
  ESCROW_ACCOUNT_DATA_LEN,
  uuidToDealIdBytes,
  getProgramId,
  escrowPda,
  configPda,
  isEscrowProgramConfigInitialized,
  getEscrowConfigAuthority,
  getConnection,
  getSolanaConnection,
  buildInitializeIx,
  buildInitEscrowIx,
  buildDepositIx,
  buildBuyerReleaseIx,
  buildReleaseIx,
  buildRefundToIx,
  buildSetFrozenIx,
  parseEscrowAccountData,
  buildUnsignedTx,
  SYSTEM_PROGRAM_ID,
}
