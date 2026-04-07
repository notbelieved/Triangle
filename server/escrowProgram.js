const crypto = require('crypto');
const {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram
} = require('@solana/web3.js');

const SYSTEM_PROGRAM_ID = SystemProgram.programId;

function ixDisc(name) {
  return crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

const DISC = {
  initialize: ixDisc('initialize'),
  init_escrow: ixDisc('init_escrow'),
  deposit: ixDisc('deposit'),
  buyer_release: ixDisc('buyer_release'),
  release: ixDisc('release'),
  refund_to: ixDisc('refund_to'),
  set_frozen: ixDisc('set_frozen'),

  init_rwa_escrow: ixDisc('init_rwa_escrow'),
  deposit_rwa_tokens: ixDisc('deposit_rwa_tokens'),
  buyer_release_rwa: ixDisc('buyer_release_rwa'),
  liquidate_rwa_mock: ixDisc('liquidate_rwa_mock'),
  set_frozen_rwa: ixDisc('set_frozen_rwa'),
  refund_rwa_to: ixDisc('refund_rwa_to')
};

function u64le(n) {
  const b = Buffer.allocUnsafe(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
}

function u16le(n) {
  const b = Buffer.allocUnsafe(2);
  b.writeUInt16LE(Number(n));
  return b;
}


const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

function uuidToDealIdBytes(uuid) {
  const hex = String(uuid).replace(/-/g, '');
  if (hex.length !== 32) throw new Error('Invalid deal UUID');
  return Buffer.from(hex, 'hex');
}

function getProgramId() {
  const id = process.env.TRIANGLE_ESCROW_PROGRAM_ID?.trim();
  if (!id) return null;
  return new PublicKey(id);
}

function escrowPda(programId, dealIdBytes) {
  return PublicKey.findProgramAddressSync([Buffer.from('escrow', 'utf8'), dealIdBytes], programId);
}

function configPda(programId) {
  return PublicKey.findProgramAddressSync([Buffer.from('config', 'utf8')], programId);
}

async function isEscrowProgramConfigInitialized(connection, programId) {
  const [cfg] = configPda(programId);
  for (const commitment of ['finalized', 'confirmed']) {
    const info = await connection.getAccountInfo(cfg, commitment);
    if (info?.data?.length && info.owner.equals(programId)) return true;
  }
  return false;
}

function configAuthorityFromAccountData(data) {
  if (!data || data.length < 40) return null;
  try {
    return new PublicKey(Buffer.from(data).subarray(8, 40));
  } catch {
    return null;
  }
}

async function getEscrowConfigAuthority(connection, programId) {
  const [cfg] = configPda(programId);
  for (const commitment of ['finalized', 'confirmed']) {
    const info = await connection.getAccountInfo(cfg, commitment);
    if (!info?.data?.length || !info.owner.equals(programId)) continue;
    const auth = configAuthorityFromAccountData(info.data);
    if (auth) return auth;
  }
  return null;
}

let _solanaRpcCache = { url: null, at: 0 };
const SOLANA_RPC_CACHE_MS = 90_000;

function connectionCommitmentConfig() {
  return {
    commitment: 'confirmed',
    confirmTransactionInitialTimeout: 90_000
  };
}

function solanaRpcEndpointCandidates() {
  const primary = process.env.SOLANA_RPC_URL?.trim();
  const fallbacks = (process.env.SOLANA_RPC_FALLBACK_URLS || '').
  split(/[,\s]+/).
  map((s) => s.trim()).
  filter(Boolean);
  const defaults = ['https://api.devnet.solana.com', 'https://rpc.ankr.com/solana_devnet'];
  const fromPrimary = primary ?
  primary.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean) :
  [];
  const head = [...fromPrimary, ...fallbacks];
  const merged = head.length ? [...head, ...defaults] : defaults;
  return [...new Set(merged)];
}

function getConnection() {
  const url = solanaRpcEndpointCandidates()[0];
  return new Connection(url, connectionCommitmentConfig());
}

async function getSolanaConnection() {
  const candidates = solanaRpcEndpointCandidates();
  const now = Date.now();
  if (_solanaRpcCache.url && now - _solanaRpcCache.at < SOLANA_RPC_CACHE_MS) {
    if (candidates.includes(_solanaRpcCache.url)) {
      return new Connection(_solanaRpcCache.url, connectionCommitmentConfig());
    }
    _solanaRpcCache = { url: null, at: 0 };
  }

  let lastErr;
  for (const url of candidates) {
    const conn = new Connection(url, connectionCommitmentConfig());
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await conn.getLatestBlockhash('confirmed');
        _solanaRpcCache = { url, at: now };
        return conn;
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
      }
    }
  }

  throw new Error(
    `Solana RPC unreachable (tried: ${candidates.join(' | ')}). Last: ${lastErr?.message || lastErr}. ` +
    'Try another SOLANA_RPC_URL (Helius/QuickNode/Alchemy devnet) or fix network/DNS.'
  );
}

function buildInitializeIx(programId, authorityPubkey, configPubkey) {
  return new TransactionInstruction({
    programId,
    keys: [
    { pubkey: authorityPubkey, isSigner: true, isWritable: true },
    { pubkey: configPubkey, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false }],

    data: DISC.initialize
  });
}

function buildInitEscrowIx(programId, buyer, seller, escrowPdaKey, dealIdBytes, expectedLamports) {
  const data = Buffer.concat([DISC.init_escrow, dealIdBytes, u64le(expectedLamports)]);
  return new TransactionInstruction({
    programId,
    keys: [
    { pubkey: buyer, isSigner: true, isWritable: true },
    { pubkey: seller, isSigner: false, isWritable: false },
    { pubkey: escrowPdaKey, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false }],

    data
  });
}

function buildDepositIx(programId, buyer, escrowPdaKey, amountLamports) {
  const data = Buffer.concat([DISC.deposit, u64le(amountLamports)]);
  return new TransactionInstruction({
    programId,
    keys: [
    { pubkey: buyer, isSigner: true, isWritable: true },
    { pubkey: escrowPdaKey, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false }],

    data
  });
}

function buildBuyerReleaseIx(programId, buyer, escrowKey, seller) {
  return new TransactionInstruction({
    programId,
    keys: [
    { pubkey: buyer, isSigner: true, isWritable: true },
    { pubkey: escrowKey, isSigner: false, isWritable: true },
    { pubkey: seller, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false }],

    data: DISC.buyer_release
  });
}

function buildReleaseIx(programId, authority, configKey, escrowKey, seller) {
  return new TransactionInstruction({
    programId,
    keys: [
    { pubkey: authority, isSigner: true, isWritable: true },
    { pubkey: configKey, isSigner: false, isWritable: false },
    { pubkey: escrowKey, isSigner: false, isWritable: true },
    { pubkey: seller, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false }],

    data: DISC.release
  });
}

function buildRefundToIx(programId, authority, configKey, escrowKey, recipient) {
  return new TransactionInstruction({
    programId,
    keys: [
    { pubkey: authority, isSigner: true, isWritable: true },
    { pubkey: configKey, isSigner: false, isWritable: false },
    { pubkey: escrowKey, isSigner: false, isWritable: true },
    { pubkey: recipient, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false }],

    data: DISC.refund_to
  });
}

function buildSetFrozenIx(programId, authority, configKey, escrowKey, dealIdBytes, frozen) {
  const data = Buffer.concat([DISC.set_frozen, dealIdBytes, Buffer.from([frozen ? 1 : 0])]);
  return new TransactionInstruction({
    programId,
    keys: [
    { pubkey: authority, isSigner: true, isWritable: false },
    { pubkey: configKey, isSigner: false, isWritable: false },
    { pubkey: escrowKey, isSigner: false, isWritable: true }],

    data
  });
}

const ESCROW_ACCOUNT_DATA_LEN = 99;

function parseEscrowAccountData(data) {
  if (!data || data.length < ESCROW_ACCOUNT_DATA_LEN) return null;
  const buf = Buffer.from(data);
  let o = 8;
  const dealId = buf.subarray(o, o + 16);
  o += 16;
  const buyer = new PublicKey(buf.subarray(o, o + 32));
  o += 32;
  const seller = new PublicKey(buf.subarray(o, o + 32));
  o += 32;
  const expectedLamports = buf.readBigUInt64LE(o);
  o += 8;
  const bump = buf.readUInt8(o);
  o += 1;
  const status = buf.readUInt8(o);
  o += 1;
  const frozen = buf.readUInt8(o) !== 0;
  return { dealId, buyer, seller, expectedLamports, bump, status, frozen };
}

async function buildUnsignedTx(connection, feePayer, ...instructions) {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const tx = new Transaction({
    feePayer,
    recentBlockhash: blockhash
  });
  instructions.forEach((ix) => tx.add(ix));
  const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  return {
    transactionBase64: serialized.toString('base64'),
    blockhash,
    lastValidBlockHeight
  };
}



function rwaEscrowPda(programId, dealIdBytes) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('rwa_escrow', 'utf8'), dealIdBytes],
    programId
  );
}


function findAssociatedTokenAddress(ownerAddress, mintAddress) {
  return PublicKey.findProgramAddressSync(
    [ownerAddress.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mintAddress.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
}


function buildInitRwaEscrowIx(
programId, buyer, seller, mint,
rwaEscrowPdaKey, vaultAtaKey,
dealIdBytes, expectedTokenAmount,
oracleMode, pythFeedIdBytes,
warningBps, liquidationBps)
{
  const data = Buffer.concat([
  DISC.init_rwa_escrow,
  dealIdBytes,
  u64le(expectedTokenAmount),
  Buffer.from([oracleMode & 0xff]),
  pythFeedIdBytes,
  u16le(warningBps),
  u16le(liquidationBps)]
  );
  return new TransactionInstruction({
    programId,
    keys: [
    { pubkey: buyer, isSigner: true, isWritable: true },
    { pubkey: seller, isSigner: false, isWritable: false },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: rwaEscrowPdaKey, isSigner: false, isWritable: true },
    { pubkey: vaultAtaKey, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false }],

    data
  });
}


function buildDepositRwaTokensIx(
programId, buyer,
rwaEscrowPdaKey, vaultAtaKey, buyerAtaKey, mint,
amount, initialPriceUsdE6)
{
  const data = Buffer.concat([
  DISC.deposit_rwa_tokens,
  u64le(amount),
  u64le(initialPriceUsdE6)]
  );
  return new TransactionInstruction({
    programId,
    keys: [
    { pubkey: buyer, isSigner: true, isWritable: true },
    { pubkey: rwaEscrowPdaKey, isSigner: false, isWritable: true },
    { pubkey: vaultAtaKey, isSigner: false, isWritable: true },
    { pubkey: buyerAtaKey, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }],

    data
  });
}


function buildBuyerReleaseRwaIx(
programId, buyer, seller,
rwaEscrowPdaKey, vaultAtaKey, sellerAtaKey, mint)
{
  return new TransactionInstruction({
    programId,
    keys: [
    { pubkey: buyer, isSigner: true, isWritable: true },
    { pubkey: seller, isSigner: false, isWritable: false },
    { pubkey: rwaEscrowPdaKey, isSigner: false, isWritable: true },
    { pubkey: vaultAtaKey, isSigner: false, isWritable: true },
    { pubkey: sellerAtaKey, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }],

    data: DISC.buyer_release_rwa
  });
}


function buildCreateAtaIdempotentIx(payer, owner, mint) {
  const ata = findAssociatedTokenAddress(owner, mint);
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: ata, isSigner: false, isWritable: true },
    { pubkey: owner, isSigner: false, isWritable: false },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }],

    data: Buffer.from([1])
  });
}


function buildLiquidateRwaMockIx(
programId, authority, configPdaKey,
buyer, seller,
rwaEscrowPdaKey, vaultAtaKey, sellerTokenAtaKey,
currentPriceUsdE6)
{
  return new TransactionInstruction({
    programId,
    keys: [
    { pubkey: authority, isSigner: true, isWritable: false },
    { pubkey: configPdaKey, isSigner: false, isWritable: false },
    { pubkey: buyer, isSigner: false, isWritable: true },
    { pubkey: seller, isSigner: false, isWritable: false },
    { pubkey: rwaEscrowPdaKey, isSigner: false, isWritable: true },
    { pubkey: vaultAtaKey, isSigner: false, isWritable: true },
    { pubkey: sellerTokenAtaKey, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }],

    data: Buffer.concat([DISC.liquidate_rwa_mock, u64le(currentPriceUsdE6)])
  });
}


function buildSetFrozenRwaIx(programId, authority, configPdaKey, rwaEscrowPdaKey, dealIdBytes, frozen) {
  const data = Buffer.concat([DISC.set_frozen_rwa, dealIdBytes, Buffer.from([frozen ? 1 : 0])]);
  return new TransactionInstruction({
    programId,
    keys: [
    { pubkey: authority, isSigner: true, isWritable: false },
    { pubkey: configPdaKey, isSigner: false, isWritable: false },
    { pubkey: rwaEscrowPdaKey, isSigner: false, isWritable: true }],

    data
  });
}


function buildRefundRwaToIx(
programId, authority, configPdaKey,
rwaEscrowPdaKey, vaultAtaKey,
recipient, recipientToken, mint)
{
  return new TransactionInstruction({
    programId,
    keys: [
    { pubkey: authority, isSigner: true, isWritable: true },
    { pubkey: configPdaKey, isSigner: false, isWritable: false },
    { pubkey: rwaEscrowPdaKey, isSigner: false, isWritable: true },
    { pubkey: vaultAtaKey, isSigner: false, isWritable: true },
    { pubkey: recipient, isSigner: false, isWritable: true },
    { pubkey: recipientToken, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }],

    data: DISC.refund_rwa_to
  });
}


function parseRwaEscrowAccountData(data) {
  const MIN_LEN = 8 + 178;
  if (!data || data.length < MIN_LEN) return null;
  const buf = Buffer.from(data);
  let o = 8;
  o += 16;
  const buyer = new PublicKey(buf.subarray(o, o + 32));o += 32;
  const seller = new PublicKey(buf.subarray(o, o + 32));o += 32;
  const mint = new PublicKey(buf.subarray(o, o + 32));o += 32;
  o += 32;
  const expectedTokenAmount = buf.readBigUInt64LE(o);o += 8;
  const depositedTokenAmount = buf.readBigUInt64LE(o);o += 8;
  const initialPriceUsdE6 = buf.readBigUInt64LE(o);o += 8;
  const bump = buf.readUInt8(o);o += 1;
  const status = buf.readUInt8(o);o += 1;
  const frozen = buf.readUInt8(o) !== 0;o += 1;
  const oracleMode = buf.readUInt8(o);o += 1;
  const tokenDecimals = buf.readUInt8(o);o += 1;
  const health = buf.readUInt8(o);o += 1;
  const warningBps = buf.readUInt16LE(o);o += 2;
  const liquidationBps = buf.readUInt16LE(o);o += 2;
  return {
    buyer, seller, mint,
    expectedTokenAmount, depositedTokenAmount, initialPriceUsdE6,
    bump, status, frozen,
    oracleMode, tokenDecimals, health,
    warningBps, liquidationBps
  };
}

module.exports = {
  DISC,
  ESCROW_ACCOUNT_DATA_LEN,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  uuidToDealIdBytes,
  getProgramId,
  escrowPda,
  rwaEscrowPda,
  findAssociatedTokenAddress,
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
  buildInitRwaEscrowIx,
  buildDepositRwaTokensIx,
  buildBuyerReleaseRwaIx,
  buildCreateAtaIdempotentIx,
  buildLiquidateRwaMockIx,
  buildSetFrozenRwaIx,
  buildRefundRwaToIx,
  parseEscrowAccountData,
  parseRwaEscrowAccountData,
  buildUnsignedTx,
  SYSTEM_PROGRAM_ID
};