/**
 * create-rwa-token.cjs
 * Creates rwaGOLD SPL token on Solana Devnet using raw instructions.
 * No extra dependencies — uses server/node_modules/@solana/web3.js only.
 *
 * Run: node solana-program/scripts/create-rwa-token.cjs
 */

'use strict'

const path = require('path')
const fs   = require('fs')
const { Connection, Keypair, PublicKey, Transaction, TransactionInstruction,
        SystemProgram, sendAndConfirmTransaction, LAMPORTS_PER_SOL } = require(
  path.join(__dirname, '../../server/node_modules/@solana/web3.js')
)

// ─── Constants ───────────────────────────────────────────────────────────────
const TOKEN_PROGRAM_ID            = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
const SYSVAR_RENT_PUBKEY          = new PublicKey('SysvarRent111111111111111111111111111111111')
const MINT_SIZE                   = 82   // fixed size of a Mint account
const DECIMALS                    = 6
const INITIAL_SUPPLY              = 100_000n  // to seller
const BUYER_AMOUNT                = 10_000n   // transferred to buyer
const RPC                         = 'https://api.devnet.solana.com'

const SCRIPTS_DIR = __dirname
const SELLER_FILE = path.join(SCRIPTS_DIR, 'demo-seller.json')
const BUYER_FILE  = path.join(SCRIPTS_DIR, 'demo-buyer.json')
const MINT_FILE   = path.join(SCRIPTS_DIR, 'demo-mint.json')

// ─── SPL Token raw instruction builders ──────────────────────────────────────

function initializeMintIx(mint, mintAuthority, decimals) {
  // Instruction 0: InitializeMint
  // Layout: u8(0) + u8(decimals) + Pubkey(mint_authority) + COption<Pubkey>(freeze) = 1+1+32+4 = 38
  const data = Buffer.alloc(67)
  let o = 0
  data.writeUInt8(0, o); o += 1                         // variant
  data.writeUInt8(decimals, o); o += 1                  // decimals
  mintAuthority.toBuffer().copy(data, o); o += 32        // mint_authority
  data.writeUInt32LE(0, o); o += 4                       // COption::None (no freeze authority)
  // pad remaining
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: mint,              isSigner: false, isWritable: true  },
      { pubkey: SYSVAR_RENT_PUBKEY,isSigner: false, isWritable: false },
    ],
    data: data.subarray(0, o),
  })
}

function createAtaIx(funder, owner, mint, ata) {
  // CreateAssociatedTokenAccountIdempotent (instruction 1 in the ATA program)
  // Instruction byte = 1 for idempotent (works even if already exists)
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: funder,         isSigner: true,  isWritable: true  },
      { pubkey: ata,            isSigner: false, isWritable: true  },
      { pubkey: owner,          isSigner: false, isWritable: false },
      { pubkey: mint,           isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID,        isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),  // idempotent variant
  })
}

function mintToIx(mint, destination, authority, amount) {
  // Instruction 7: MintTo
  // Layout: u8(7) + u64(amount)
  const data = Buffer.alloc(9)
  data.writeUInt8(7, 0)
  data.writeBigUInt64LE(BigInt(amount), 1)
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: mint,        isSigner: false, isWritable: true  },
      { pubkey: destination, isSigner: false, isWritable: true  },
      { pubkey: authority,   isSigner: true,  isWritable: false },
    ],
    data,
  })
}

function transferIx(source, destination, authority, amount) {
  // Instruction 3: Transfer
  const data = Buffer.alloc(9)
  data.writeUInt8(3, 0)
  data.writeBigUInt64LE(BigInt(amount), 1)
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: source,      isSigner: false, isWritable: true  },
      { pubkey: destination, isSigner: false, isWritable: true  },
      { pubkey: authority,   isSigner: true,  isWritable: false },
    ],
    data,
  })
}

function findAta(owner, mint) {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0]
}

// ─── Keypair helpers ─────────────────────────────────────────────────────────

function loadOrGenerate(filePath, label) {
  if (fs.existsSync(filePath)) {
    const arr = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    const kp = Keypair.fromSecretKey(Uint8Array.from(arr))
    console.log(`  ${label}: ${kp.publicKey.toBase58()} (loaded from ${path.basename(filePath)})`)
    return kp
  }
  const kp = Keypair.generate()
  fs.writeFileSync(filePath, JSON.stringify(Array.from(kp.secretKey)), 'utf8')
  console.log(`  ${label}: ${kp.publicKey.toBase58()} (generated → ${path.basename(filePath)})`)
  return kp
}

// ─── Airdrop with retry ───────────────────────────────────────────────────────

async function airdropWithRetry(connection, pubkey, sol, label) {
  for (let i = 1; i <= 4; i++) {
    try {
      console.log(`  Airdrop ${sol} SOL to ${label} (attempt ${i})…`)
      const sig = await connection.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL)
      // Confirm with a generous timeout
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
      const bal = await connection.getBalance(pubkey)
      console.log(`    ✓ Balance: ${bal / LAMPORTS_PER_SOL} SOL`)
      return
    } catch (e) {
      console.warn(`    Airdrop failed (${e.message}), retrying in 10 s…`)
      await new Promise(r => setTimeout(r, 10_000))
    }
  }
  throw new Error(`Airdrop to ${label} failed after 4 attempts`)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n═══════════════════════════════════════════════════')
  console.log('  Triangle — rwaGOLD devnet token setup')
  console.log('═══════════════════════════════════════════════════\n')

  const connection = new Connection(RPC, { commitment: 'confirmed', confirmTransactionInitialTimeout: 90_000 })

  // ─── 1. Wallets ───────────────────────────────────────────────────────────
  console.log('── Wallets ──────────────────────────────────────────')
  const seller = loadOrGenerate(SELLER_FILE, 'Seller')
  const buyer  = loadOrGenerate(BUYER_FILE,  'Buyer')

  // ─── 2. Check SOL balances, airdrop if < 0.5 SOL ─────────────────────────
  console.log('\n── Airdrops ─────────────────────────────────────────')
  const sellerBal = await connection.getBalance(seller.publicKey)
  const buyerBal  = await connection.getBalance(buyer.publicKey)
  if (sellerBal < 0.5 * LAMPORTS_PER_SOL) {
    await airdropWithRetry(connection, seller.publicKey, 2, 'seller')
  } else {
    console.log(`  Seller already has ${sellerBal / LAMPORTS_PER_SOL} SOL`)
  }
  if (buyerBal < 0.5 * LAMPORTS_PER_SOL) {
    await airdropWithRetry(connection, buyer.publicKey, 2, 'buyer')
  } else {
    console.log(`  Buyer already has ${buyerBal / LAMPORTS_PER_SOL} SOL`)
  }

  // ─── 3. Mint keypair ──────────────────────────────────────────────────────
  console.log('\n── Creating rwaGOLD mint ────────────────────────────')
  let mintKp
  if (fs.existsSync(MINT_FILE)) {
    const arr = JSON.parse(fs.readFileSync(MINT_FILE, 'utf8'))
    mintKp = Keypair.fromSecretKey(Uint8Array.from(arr))
    // Check if mint already initialized on-chain
    const info = await connection.getAccountInfo(mintKp.publicKey)
    if (info && info.owner.equals(TOKEN_PROGRAM_ID)) {
      console.log(`  Mint already exists: ${mintKp.publicKey.toBase58()}`)
    } else {
      mintKp = null  // regenerate if not on-chain
    }
  }

  if (!mintKp) {
    mintKp = Keypair.generate()
    fs.writeFileSync(MINT_FILE, JSON.stringify(Array.from(mintKp.secretKey)), 'utf8')
    console.log(`  New mint keypair: ${mintKp.publicKey.toBase58()}`)

    // Create + initialize mint in one transaction
    const mintRent = await connection.getMinimumBalanceForRentExemption(MINT_SIZE)
    const tx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: seller.publicKey,
        newAccountPubkey: mintKp.publicKey,
        lamports: mintRent,
        space: MINT_SIZE,
        programId: TOKEN_PROGRAM_ID,
      }),
      initializeMintIx(mintKp.publicKey, seller.publicKey, DECIMALS),
    )
    const sig = await sendAndConfirmTransaction(connection, tx, [seller, mintKp], { commitment: 'confirmed' })
    console.log(`  ✓ Mint created (${sig.slice(0,16)}…)`)
  }

  const mint = mintKp.publicKey

  // ─── 4. Create ATAs ───────────────────────────────────────────────────────
  console.log('\n── Associated Token Accounts ────────────────────────')
  const sellerAta = findAta(seller.publicKey, mint)
  const buyerAta  = findAta(buyer.publicKey,  mint)
  console.log(`  Seller ATA: ${sellerAta.toBase58()}`)
  console.log(`  Buyer ATA:  ${buyerAta.toBase58()}`)

  // Check which ATAs need creating
  const [sellerAtaInfo, buyerAtaInfo] = await Promise.all([
    connection.getAccountInfo(sellerAta),
    connection.getAccountInfo(buyerAta),
  ])

  const atasToCreate = []
  if (!sellerAtaInfo) atasToCreate.push(createAtaIx(seller.publicKey, seller.publicKey, mint, sellerAta))
  if (!buyerAtaInfo)  atasToCreate.push(createAtaIx(seller.publicKey, buyer.publicKey,  mint, buyerAta))

  if (atasToCreate.length > 0) {
    const tx = new Transaction().add(...atasToCreate)
    const sig = await sendAndConfirmTransaction(connection, tx, [seller], { commitment: 'confirmed' })
    console.log(`  ✓ ATAs created (${sig.slice(0,16)}…)`)
  } else {
    console.log('  ✓ ATAs already exist')
  }

  // ─── 5. Mint tokens to seller (if supply is 0) ────────────────────────────
  console.log('\n── Minting rwaGOLD ──────────────────────────────────')
  const sellerAtaBalance = await connection.getTokenAccountBalance(sellerAta).catch(() => null)
  const currentSupply = BigInt(sellerAtaBalance?.value?.amount ?? '0')

  if (currentSupply < INITIAL_SUPPLY * BigInt(10 ** DECIMALS)) {
    const mintAmount = INITIAL_SUPPLY * BigInt(10 ** DECIMALS)
    const tx = new Transaction().add(mintToIx(mint, sellerAta, seller.publicKey, mintAmount))
    const sig = await sendAndConfirmTransaction(connection, tx, [seller], { commitment: 'confirmed' })
    console.log(`  ✓ Minted ${INITIAL_SUPPLY.toLocaleString()} rwaGOLD to seller (${sig.slice(0,16)}…)`)
  } else {
    console.log(`  ✓ Seller already has ${Number(currentSupply) / 10 ** DECIMALS} rwaGOLD`)
  }

  // ─── 6. Transfer to buyer (if buyer balance < BUYER_AMOUNT) ──────────────
  console.log('\n── Funding buyer ────────────────────────────────────')
  const buyerAtaBalance = await connection.getTokenAccountBalance(buyerAta).catch(() => null)
  const buyerTokens = BigInt(buyerAtaBalance?.value?.amount ?? '0')

  if (buyerTokens < BUYER_AMOUNT * BigInt(10 ** DECIMALS)) {
    const transferAmount = BUYER_AMOUNT * BigInt(10 ** DECIMALS)
    const tx = new Transaction().add(transferIx(sellerAta, buyerAta, seller.publicKey, transferAmount))
    const sig = await sendAndConfirmTransaction(connection, tx, [seller], { commitment: 'confirmed' })
    console.log(`  ✓ Transferred ${BUYER_AMOUNT.toLocaleString()} rwaGOLD to buyer (${sig.slice(0,16)}…)`)
  } else {
    console.log(`  ✓ Buyer already has ${Number(buyerTokens) / 10 ** DECIMALS} rwaGOLD`)
  }

  // ─── 7. Final balances ────────────────────────────────────────────────────
  console.log('\n── Final balances ───────────────────────────────────')
  const [sBal, bBal, sTokenBal, bTokenBal] = await Promise.all([
    connection.getBalance(seller.publicKey),
    connection.getBalance(buyer.publicKey),
    connection.getTokenAccountBalance(sellerAta),
    connection.getTokenAccountBalance(buyerAta),
  ])
  console.log(`  Seller SOL:     ${sBal / LAMPORTS_PER_SOL}`)
  console.log(`  Seller rwaGOLD: ${sTokenBal.value.uiAmountString}`)
  console.log(`  Buyer SOL:      ${bBal / LAMPORTS_PER_SOL}`)
  console.log(`  Buyer rwaGOLD:  ${bTokenBal.value.uiAmountString}`)

  // ─── 8. Summary ───────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════')
  console.log('  SETUP COMPLETE')
  console.log('═══════════════════════════════════════════════════')
  console.log(`\n  rwaGOLD Mint:  ${mint.toBase58()}`)
  console.log(`  Seller:        ${seller.publicKey.toBase58()}`)
  console.log(`  Buyer:         ${buyer.publicKey.toBase58()}`)
  console.log('\n  Add to server/.env and web/.env.development:')
  console.log(`    DEMO_RWA_MINT=${mint.toBase58()}`)
  console.log(`    VITE_DEMO_RWA_MINT=${mint.toBase58()}`)
  console.log('\n  Pyth XAU/USD feed hex:')
  console.log('    765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2')
  console.log('')

  // Write mint address to a file for easy copy-paste
  const mintInfo = { mint: mint.toBase58(), seller: seller.publicKey.toBase58(), buyer: buyer.publicKey.toBase58() }
  fs.writeFileSync(path.join(SCRIPTS_DIR, 'demo-addresses.json'), JSON.stringify(mintInfo, null, 2), 'utf8')
  console.log('  Saved to: solana-program/scripts/demo-addresses.json\n')

  return mint.toBase58()
}

main().catch(e => { console.error('\n[ERROR]', e.message || e); process.exit(1) })
