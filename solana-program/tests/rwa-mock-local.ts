
import * as anchor from '@coral-xyz/anchor'
import { Program } from '@coral-xyz/anchor'
import { assert } from 'chai'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createMint,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from '@solana/spl-token'
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js'

describe('triangle_escrow RWA (mock oracle)', () => {
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
  dealId.writeUInt32LE(7, 0)

  let rwaEscrowPda: PublicKey
  let vaultAta: PublicKey
  let configPda: PublicKey

  before(async () => {
    const airdrop = async (k: PublicKey) => {
      const sig = await provider.connection.requestAirdrop(k, 5e9)
      await provider.connection.confirmTransaction(sig, 'confirmed')
    }
    await airdrop(authority.publicKey)
    await airdrop(buyer.publicKey)
    await airdrop(seller.publicKey)

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

    ;[configPda] = PublicKey.findProgramAddressSync([Buffer.from('config')], programId)
    ;[rwaEscrowPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('rwa_escrow'), dealId],
      programId,
    )
    vaultAta = getAssociatedTokenAddressSync(
      mint,
      rwaEscrowPda,
      true,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    )
  })

  it('initializes config', async () => {
    await program.methods
      .initialize()
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc()
  })

  it('inits RWA escrow (mock oracle)', async () => {
    const pythZero = new Array<number>(32).fill(0)
    await program.methods
      .initRwaEscrow(
        [...dealId],
        new anchor.BN(1_000_000),
        0,
        pythZero,
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

  it('deposits collateral and sets initial USD mark', async () => {
    const initialUsdE6 = new anchor.BN(2_000_000_000)
    await program.methods
      .depositRwaTokens(new anchor.BN(1_000_000), initialUsdE6)
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
    assert.equal(acc.initialPriceUsdE6.toString(), initialUsdE6.toString())
  })

  it('refreshes risk (mock price)', async () => {
    await program.methods
      .refreshRwaRiskMock(new anchor.BN(1_500_000_000))
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        rwaEscrow: rwaEscrowPda,
      })
      .rpc()
    const acc = await program.account.rwaEscrowState.fetch(rwaEscrowPda)
    assert.equal(acc.health, 1)
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
