
import * as anchor from '@coral-xyz/anchor'
import { Program } from '@coral-xyz/anchor'
import { assert } from 'chai'
import * as crypto from 'crypto'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createMint,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from '@solana/spl-token'
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js'


const SOL_USD_FEED_ID_HEX =
  'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d'


const PYTH_SOL_USD_PRICE_FEED = new PublicKey(
  '7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE',
)

const ORACLE_MODE_PYTH = 1

function feedIdToU8Array(hex: string): number[] {
  return Array.from(Buffer.from(hex, 'hex'))
}


function parsePriceUpdateV2Price(data: Buffer): { price: bigint; exponent: number } {
  let o = 8 + 32
  const tag = data[o]
  if (tag === 0) o += 2
  else if (tag === 1) o += 1
  else throw new Error(`unknown VerificationLevel tag ${tag}`)
  o += 32
  o += 8
  o += 8
  const price = data.readBigInt64LE(o)
  o += 8
  o += 8
  const exponent = data.readInt32LE(o)
  return { price, exponent }
}


function priceToUsdE6(price: bigint, exponent: number): anchor.BN {
  if (price <= 0n) throw new Error('non-positive Pyth price')
  const p = new anchor.BN(price.toString())
  const ten = new anchor.BN(10)
  const shift = exponent + 6
  if (shift >= 0) {
    return p.mul(ten.pow(new anchor.BN(shift)))
  }
  return p.div(ten.pow(new anchor.BN(-shift)))
}

const runFork = process.env.RWA_FORK_TEST === '1'
const describeFork = runFork ? describe : describe.skip

describeFork('triangle_escrow RWA (mainnet fork + Pyth receiver)', () => {
  const provider = anchor.AnchorProvider.env()
  anchor.setProvider(provider)
  const program = anchor.workspace.TriangleEscrow as Program
  const programId = program.programId

  const authority = (provider.wallet as anchor.Wallet).payer
  const buyer = Keypair.generate()
  const seller = Keypair.generate()

  let mint: PublicKey
  let buyerAta: PublicKey
  let sellerAta: PublicKey

  const dealId = Buffer.alloc(16)
  let rwaEscrowPda: PublicKey
  let vaultAta: PublicKey
  let configPda: PublicKey

  
  let initialUsdE6FromOracle: anchor.BN

  const airdrop = async (k: PublicKey) => {
    const sig = await provider.connection.requestAirdrop(k, 5e9)
    await provider.connection.confirmTransaction(sig, 'confirmed')
  }

  before(async () => {
    await airdrop(authority.publicKey)
    await airdrop(buyer.publicKey)
    await airdrop(seller.publicKey)

    crypto.randomFillSync(dealId)
    ;[configPda] = PublicKey.findProgramAddressSync([Buffer.from('config')], programId)
    ;[rwaEscrowPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('rwa_escrow'), dealId],
      programId,
    )

    mint = await createMint(
      provider.connection,
      authority,
      authority.publicKey,
      authority.publicKey,
      6,
    )

    buyerAta = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        authority,
        mint,
        buyer.publicKey,
      )
    ).address
    sellerAta = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        authority,
        mint,
        seller.publicKey,
      )
    ).address

    await mintTo(
      provider.connection,
      authority,
      mint,
      buyerAta,
      authority,
      10_000n * 1_000_000n,
    )

    vaultAta = getAssociatedTokenAddressSync(
      mint,
      rwaEscrowPda,
      true,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    )

    const feedAcc = await provider.connection.getAccountInfo(PYTH_SOL_USD_PRICE_FEED)
    assert.ok(feedAcc, 'Clone PYTH_SOL_USD price feed account (see start-mainnet-fork.* --clone)')
    const { price, exponent } = parsePriceUpdateV2Price(Buffer.from(feedAcc.data))
    initialUsdE6FromOracle = priceToUsdE6(price, exponent)
    console.log(
      '[fork] Pyth SOL/USD from cloned feed — price (mantissa)',
      price.toString(),
      'expo',
      exponent,
      '→ initial_price_usd_e6 (micro USD / unit)',
      initialUsdE6FromOracle.toString(),
    )
  })

  it('initializes config if missing', async () => {
    const cfg = await program.account.config.fetchNullable(configPda)
    if (!cfg) {
      await program.methods
        .initialize()
        .accounts({
          authority: authority.publicKey,
          config: configPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc()
    }
  })

  it('inits RWA escrow (Pyth oracle)', async () => {
    await program.methods
      .initRwaEscrow(
        [...dealId],
        new anchor.BN(1_000_000),
        ORACLE_MODE_PYTH,
        feedIdToU8Array(SOL_USD_FEED_ID_HEX),
        2000,
        3000,
      )
      .accounts({
        buyer: buyer.publicKey,
        seller: seller.publicKey,
        mint,
        rwaEscrow: rwaEscrowPda,
        vault: vaultAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([buyer])
      .rpc()
  })

  it('deposits collateral (initial USD mark = oracle price for this feed)', async () => {
    await program.methods
      .depositRwaTokens(new anchor.BN(1_000_000), initialUsdE6FromOracle)
      .accounts({
        buyer: buyer.publicKey,
        rwaEscrow: rwaEscrowPda,
        vault: vaultAta,
        buyerToken: buyerAta,
        mint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([buyer])
      .rpc()

    const acc = await program.account.rwaEscrowState.fetch(rwaEscrowPda)
    assert.equal(acc.status, 1)
    assert.equal(acc.initialPriceUsdE6.toString(), initialUsdE6FromOracle.toString())
  })

  it('refreshes risk from cloned Pyth price feed', async () => {
    await program.methods
      .refreshRwaRiskPyth()
      .accounts({
        rwaEscrow: rwaEscrowPda,
        priceUpdate: PYTH_SOL_USD_PRICE_FEED,
      })
      .rpc()

    const acc = await program.account.rwaEscrowState.fetch(rwaEscrowPda)
    assert.isAtLeast(acc.health, 0)
  })

  it('buyer releases to seller', async () => {
    await program.methods
      .buyerReleaseRwa()
      .accounts({
        buyer: buyer.publicKey,
        seller: seller.publicKey,
        rwaEscrow: rwaEscrowPda,
        vault: vaultAta,
        sellerToken: sellerAta,
        mint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([buyer])
      .rpc()

    const sellerInfo = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      authority,
      mint,
      seller.publicKey,
    )
    assert.isAbove(Number(sellerInfo.amount), 0)
  })
})
