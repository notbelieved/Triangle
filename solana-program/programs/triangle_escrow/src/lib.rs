use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, Transfer};
use pyth_solana_receiver_sdk::price_update::{
    FeedId, PriceUpdateV2, VerificationLevel,
};

declare_id!("7RnW9zpz4vwmebbPJqh5hSTdvUSrFGdZGZYWFZSbfgcV");

/// USD price per 1.0 whole token, scaled by 1e6 (micro-USD).
pub const DEFAULT_WARNING_BPS: u16 = 2_000;
pub const DEFAULT_LIQUIDATION_BPS: u16 = 3_000;
#[cfg(feature = "fork-test")]
pub const PYTH_MAX_AGE_SECS: u64 = 86_400;
#[cfg(not(feature = "fork-test"))]
pub const PYTH_MAX_AGE_SECS: u64 = 300; // devnet updates more slowly than mainnet

#[program]
pub mod triangle_escrow {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        ctx.accounts.config.authority = ctx.accounts.authority.key();
        Ok(())
    }

    pub fn init_escrow(
        ctx: Context<InitEscrow>,
        deal_id: [u8; 16],
        expected_lamports: u64,
    ) -> Result<()> {
        require!(expected_lamports > 0, EscrowError::ZeroAmount);
        let escrow = &mut ctx.accounts.escrow;
        escrow.deal_id = deal_id;
        escrow.buyer = ctx.accounts.buyer.key();
        escrow.seller = ctx.accounts.seller.key();
        escrow.expected_lamports = expected_lamports;
        escrow.bump = ctx.bumps.escrow;
        escrow.status = EscrowStatus::AwaitingFunds as u8;
        escrow.frozen = false;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, EscrowError::ZeroAmount);
        {
            let escrow = &ctx.accounts.escrow;
            require!(!escrow.frozen, EscrowError::Frozen);
            require!(
                escrow.status == EscrowStatus::AwaitingFunds as u8,
                EscrowError::BadStatus
            );
        }
        let expected = ctx.accounts.escrow.expected_lamports;

        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to: ctx.accounts.escrow.to_account_info(),
                },
            ),
            amount,
        )?;

        let rent = Rent::get()?;
        let escrow_ai = ctx.accounts.escrow.to_account_info();
        let data_len = escrow_ai.data_len();
        let min_rent = rent.minimum_balance(data_len);
        let bal = escrow_ai.lamports();
        if bal.saturating_sub(min_rent) >= expected {
            ctx.accounts.escrow.status = EscrowStatus::Funded as u8;
        }
        Ok(())
    }

    pub fn buyer_release(ctx: Context<BuyerRelease>) -> Result<()> {
        require!(
            ctx.accounts.seller.key() == ctx.accounts.escrow.seller,
            EscrowError::BadSeller
        );
        Ok(())
    }

    pub fn release(ctx: Context<Release>) -> Result<()> {
        require!(
            ctx.accounts.seller.key() == ctx.accounts.escrow.seller,
            EscrowError::BadSeller
        );
        Ok(())
    }

    pub fn refund_to(_ctx: Context<RefundTo>) -> Result<()> {
        Ok(())
    }

    pub fn set_frozen(ctx: Context<SetFrozen>, deal_id: [u8; 16], frozen: bool) -> Result<()> {
        require!(
            ctx.accounts.escrow.deal_id == deal_id,
            EscrowError::BadDealId
        );
        ctx.accounts.escrow.frozen = frozen;
        Ok(())
    }

    // --- RWA (SPL) + oracle health / liquidation ---

    pub fn init_rwa_escrow(
        ctx: Context<InitRwaEscrow>,
        deal_id: [u8; 16],
        expected_token_amount: u64,
        oracle_mode: u8,
        pyth_feed_id: [u8; 32],
        warning_bps: u16,
        liquidation_bps: u16,
    ) -> Result<()> {
        require!(expected_token_amount > 0, EscrowError::ZeroAmount);
        require!(
            oracle_mode == OracleMode::Mock as u8 || oracle_mode == OracleMode::Pyth as u8,
            EscrowError::BadOracleMode
        );
        require!(warning_bps < liquidation_bps, EscrowError::BadRiskBps);
        require!(liquidation_bps <= 10_000, EscrowError::BadRiskBps);

        if oracle_mode == OracleMode::Pyth as u8 {
            require!(
                pyth_feed_id != [0u8; 32],
                EscrowError::PythFeedRequired
            );
        }

        let rwa = &mut ctx.accounts.rwa_escrow;
        rwa.deal_id = deal_id;
        rwa.buyer = ctx.accounts.buyer.key();
        rwa.seller = ctx.accounts.seller.key();
        rwa.mint = ctx.accounts.mint.key();
        rwa.pyth_feed_id = pyth_feed_id;
        rwa.expected_token_amount = expected_token_amount;
        rwa.deposited_token_amount = 0;
        rwa.initial_price_usd_e6 = 0;
        rwa.bump = ctx.bumps.rwa_escrow;
        rwa.status = RwaEscrowStatus::AwaitingTokens as u8;
        rwa.frozen = false;
        rwa.oracle_mode = oracle_mode;
        rwa.token_decimals = ctx.accounts.mint.decimals;
        rwa.health = RwaHealth::Ok as u8;
        rwa.warning_bps = warning_bps;
        rwa.liquidation_bps = liquidation_bps;
        Ok(())
    }

    pub fn deposit_rwa_tokens(
        ctx: Context<DepositRwaTokens>,
        amount: u64,
        initial_price_usd_e6: u64,
    ) -> Result<()> {
        require!(amount > 0, EscrowError::ZeroAmount);
        require!(initial_price_usd_e6 > 0, EscrowError::BadPrice);

        {
            let rwa = &ctx.accounts.rwa_escrow;
            require!(!rwa.frozen, EscrowError::Frozen);
            require!(
                rwa.status == RwaEscrowStatus::AwaitingTokens as u8,
                EscrowError::BadStatus
            );
        }

        let rwa = &mut ctx.accounts.rwa_escrow;
        require!(
            ctx.accounts.buyer_token.owner == rwa.buyer,
            EscrowError::BadBuyer
        );
        require!(
            ctx.accounts.buyer_token.mint == rwa.mint,
            EscrowError::BadMint
        );

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.buyer_token.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            amount,
        )?;

        rwa.deposited_token_amount = rwa
            .deposited_token_amount
            .checked_add(amount)
            .ok_or(EscrowError::AmountOverflow)?;
        if rwa.initial_price_usd_e6 == 0 {
            rwa.initial_price_usd_e6 = initial_price_usd_e6;
        }

        if rwa.deposited_token_amount >= rwa.expected_token_amount {
            rwa.status = RwaEscrowStatus::Funded as u8;
        }
        Ok(())
    }

    pub fn refresh_rwa_risk_mock(
        ctx: Context<RefreshRwaRiskMock>,
        current_price_usd_e6: u64,
    ) -> Result<()> {
        let rwa = &mut ctx.accounts.rwa_escrow;
        require!(
            rwa.oracle_mode == OracleMode::Mock as u8,
            EscrowError::BadOracleMode
        );
        require!(current_price_usd_e6 > 0, EscrowError::BadPrice);
        rwa.health = compute_health(rwa.initial_price_usd_e6, current_price_usd_e6, rwa);
        Ok(())
    }

    pub fn refresh_rwa_risk_pyth(ctx: Context<RefreshRwaRiskPyth>) -> Result<()> {
        let rwa = &mut ctx.accounts.rwa_escrow;
        require!(
            rwa.oracle_mode == OracleMode::Pyth as u8,
            EscrowError::BadOracleMode
        );
        let feed_id: FeedId = rwa.pyth_feed_id;
        let clock = Clock::get()?;
        let px = ctx
            .accounts
            .price_update
            .get_price_no_older_than_with_custom_verification_level(
                &clock,
                PYTH_MAX_AGE_SECS,
                &feed_id,
                VerificationLevel::Partial { num_signatures: 5 },
            )
            .map_err(|_| error!(EscrowError::PythPrice))?;
        let current = price_to_usd_e6(px.price, px.exponent)?;
        rwa.health = compute_health(rwa.initial_price_usd_e6, current, rwa);
        Ok(())
    }

    pub fn liquidate_rwa_mock(
        ctx: Context<LiquidateRwaMock>,
        current_price_usd_e6: u64,
    ) -> Result<()> {
        require!(current_price_usd_e6 > 0, EscrowError::BadPrice);
        {
            let rwa = &ctx.accounts.rwa_escrow;
            require!(!rwa.frozen, EscrowError::Frozen);
            require!(
                rwa.oracle_mode == OracleMode::Mock as u8,
                EscrowError::BadOracleMode
            );
            require!(
                rwa.status == RwaEscrowStatus::Funded as u8
                    || rwa.status == RwaEscrowStatus::AwaitingTokens as u8,
                EscrowError::BadStatus
            );
            require!(rwa.initial_price_usd_e6 > 0, EscrowError::BadPrice);
            let drop_bps = price_drop_bps(rwa.initial_price_usd_e6, current_price_usd_e6)?;
            require!(
                drop_bps >= rwa.liquidation_bps as u128,
                EscrowError::NotLiquidatable
            );
        }

        let bump = ctx.accounts.rwa_escrow.bump;
        let deal_id = ctx.accounts.rwa_escrow.deal_id;
        let seeds: &[&[u8]] = &[b"rwa_escrow", deal_id.as_ref(), &[bump]];
        let signer = &[seeds];

        let amount = ctx.accounts.vault.amount;
        require!(amount > 0, EscrowError::ZeroAmount);

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.seller_token.to_account_info(),
                    authority: ctx.accounts.rwa_escrow.to_account_info(),
                },
                signer,
            ),
            amount,
        )?;

        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.vault.to_account_info(),
                destination: ctx.accounts.buyer_rent_dest.to_account_info(),
                authority: ctx.accounts.rwa_escrow.to_account_info(),
            },
            signer,
        ))?;

        ctx.accounts.rwa_escrow.status = RwaEscrowStatus::Liquidated as u8;
        Ok(())
    }

    pub fn liquidate_rwa_pyth(ctx: Context<LiquidateRwaPyth>) -> Result<()> {
        let current = {
            let rwa = &ctx.accounts.rwa_escrow;
            require!(!rwa.frozen, EscrowError::Frozen);
            require!(
                rwa.oracle_mode == OracleMode::Pyth as u8,
                EscrowError::BadOracleMode
            );
            require!(
                rwa.status == RwaEscrowStatus::Funded as u8
                    || rwa.status == RwaEscrowStatus::AwaitingTokens as u8,
                EscrowError::BadStatus
            );
            require!(rwa.initial_price_usd_e6 > 0, EscrowError::BadPrice);
            let feed_id: FeedId = rwa.pyth_feed_id;
            let clock = Clock::get()?;
            let px = ctx
                .accounts
                .price_update
                .get_price_no_older_than_with_custom_verification_level(
                    &clock,
                    PYTH_MAX_AGE_SECS,
                    &feed_id,
                    VerificationLevel::Partial { num_signatures: 5 },
                )
                .map_err(|_| error!(EscrowError::PythPrice))?;
            price_to_usd_e6(px.price, px.exponent)?
        };

        {
            let rwa = &ctx.accounts.rwa_escrow;
            let drop_bps = price_drop_bps(rwa.initial_price_usd_e6, current)?;
            require!(
                drop_bps >= rwa.liquidation_bps as u128,
                EscrowError::NotLiquidatable
            );
        }

        let bump = ctx.accounts.rwa_escrow.bump;
        let deal_id = ctx.accounts.rwa_escrow.deal_id;
        let seeds: &[&[u8]] = &[b"rwa_escrow", deal_id.as_ref(), &[bump]];
        let signer = &[seeds];

        let amount = ctx.accounts.vault.amount;
        require!(amount > 0, EscrowError::ZeroAmount);

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.seller_token.to_account_info(),
                    authority: ctx.accounts.rwa_escrow.to_account_info(),
                },
                signer,
            ),
            amount,
        )?;

        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.vault.to_account_info(),
                destination: ctx.accounts.buyer_rent_dest.to_account_info(),
                authority: ctx.accounts.rwa_escrow.to_account_info(),
            },
            signer,
        ))?;

        ctx.accounts.rwa_escrow.status = RwaEscrowStatus::Liquidated as u8;
        Ok(())
    }

    pub fn buyer_release_rwa(ctx: Context<BuyerReleaseRwa>) -> Result<()> {
        let rwa = &ctx.accounts.rwa_escrow;
        require!(
            ctx.accounts.seller.key() == rwa.seller,
            EscrowError::BadSeller
        );
        require!(!rwa.frozen, EscrowError::Frozen);
        require!(
            rwa.status == RwaEscrowStatus::Funded as u8,
            EscrowError::BadStatus
        );

        let bump = rwa.bump;
        let deal_id = rwa.deal_id;
        let seeds: &[&[u8]] = &[b"rwa_escrow", deal_id.as_ref(), &[bump]];
        let signer = &[seeds];

        let amount = ctx.accounts.vault.amount;
        if amount > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.accounts.seller_token.to_account_info(),
                        authority: ctx.accounts.rwa_escrow.to_account_info(),
                    },
                    signer,
                ),
                amount,
            )?;
        }

        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.vault.to_account_info(),
                destination: ctx.accounts.buyer.to_account_info(),
                authority: ctx.accounts.rwa_escrow.to_account_info(),
            },
            signer,
        ))?;

        ctx.accounts.rwa_escrow.status = RwaEscrowStatus::Released as u8;
        Ok(())
    }

    pub fn refund_rwa_to(ctx: Context<RefundRwaTo>) -> Result<()> {
        require!(ctx.accounts.rwa_escrow.frozen, EscrowError::NotFrozen);

        let bump = ctx.accounts.rwa_escrow.bump;
        let deal_id = ctx.accounts.rwa_escrow.deal_id;
        let seeds: &[&[u8]] = &[b"rwa_escrow", deal_id.as_ref(), &[bump]];
        let signer = &[seeds];

        let amount = ctx.accounts.vault.amount;
        if amount > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.accounts.recipient_token.to_account_info(),
                        authority: ctx.accounts.rwa_escrow.to_account_info(),
                    },
                    signer,
                ),
                amount,
            )?;
        }

        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.vault.to_account_info(),
                destination: ctx.accounts.recipient.to_account_info(),
                authority: ctx.accounts.rwa_escrow.to_account_info(),
            },
            signer,
        ))?;

        ctx.accounts.rwa_escrow.status = RwaEscrowStatus::Refunded as u8;
        Ok(())
    }

    pub fn set_frozen_rwa(ctx: Context<SetFrozenRwa>, deal_id: [u8; 16], frozen: bool) -> Result<()> {
        require!(
            ctx.accounts.rwa_escrow.deal_id == deal_id,
            EscrowError::BadDealId
        );
        ctx.accounts.rwa_escrow.frozen = frozen;
        Ok(())
    }
}

fn compute_health(
    initial_usd_e6: u64,
    current_usd_e6: u64,
    rwa: &RwaEscrowState,
) -> u8 {
    if initial_usd_e6 == 0 || current_usd_e6 == 0 {
        return RwaHealth::Ok as u8;
    }
    let drop = price_drop_bps(initial_usd_e6, current_usd_e6).unwrap_or(0);
    if drop >= rwa.liquidation_bps as u128 {
        RwaHealth::Liquidatable as u8
    } else if drop >= rwa.warning_bps as u128 {
        RwaHealth::Warning as u8
    } else {
        RwaHealth::Ok as u8
    }
}

fn price_drop_bps(initial_usd_e6: u64, current_usd_e6: u64) -> Result<u128> {
    require!(initial_usd_e6 > 0, EscrowError::BadPrice);
    if current_usd_e6 >= initial_usd_e6 {
        return Ok(0);
    }
    let num = (initial_usd_e6 as u128)
        .checked_sub(current_usd_e6 as u128)
        .ok_or(EscrowError::AmountOverflow)?
        .checked_mul(10_000)
        .ok_or(EscrowError::AmountOverflow)?;
    Ok(num / initial_usd_e6 as u128)
}

fn price_to_usd_e6(price: i64, exponent: i32) -> Result<u64> {
    require!(price > 0, EscrowError::BadPrice);
    let p = price as i128;
    let shift = exponent.checked_add(6).ok_or(EscrowError::BadPrice)?;
    let out = if shift >= 0 {
        let pow = pow10_i128(shift as u32)?;
        p.checked_mul(pow).ok_or(EscrowError::AmountOverflow)?
    } else {
        let pow = pow10_i128((-shift) as u32)?;
        p.checked_div(pow).ok_or(EscrowError::AmountOverflow)?
    };
    require!(out > 0 && out <= u64::MAX as i128, EscrowError::BadPrice);
    Ok(out as u64)
}

fn pow10_i128(k: u32) -> Result<i128> {
    require!(k <= 28, EscrowError::BadPrice);
    Ok(10i128.pow(k))
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + 32,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(deal_id: [u8; 16])]
pub struct InitEscrow<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    /// CHECK:
    pub seller: UncheckedAccount<'info>,
    #[account(
        init,
        payer = buyer,
        space = 8 + 16 + 32 + 32 + 8 + 1 + 1 + 1,
        seeds = [b"escrow", deal_id.as_ref()],
        bump
    )]
    pub escrow: Account<'info, EscrowState>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(
        mut,
        seeds = [b"escrow", escrow.deal_id.as_ref()],
        bump = escrow.bump,
        constraint = escrow.buyer == buyer.key() @ EscrowError::BadBuyer,
    )]
    pub escrow: Account<'info, EscrowState>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BuyerRelease<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(
        mut,
        seeds = [b"escrow", escrow.deal_id.as_ref()],
        bump = escrow.bump,
        constraint = escrow.buyer == buyer.key() @ EscrowError::BadBuyer,
        constraint = !escrow.frozen @ EscrowError::Frozen,
        constraint = escrow.status == EscrowStatus::Funded as u8 @ EscrowError::BadStatus,
        close = seller,
    )]
    pub escrow: Account<'info, EscrowState>,
    /// CHECK:
    #[account(mut)]
    pub seller: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Release<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [b"config"],
        bump,
        constraint = config.authority == authority.key() @ EscrowError::BadAuthority,
    )]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [b"escrow", escrow.deal_id.as_ref()],
        bump = escrow.bump,
        constraint = !escrow.frozen @ EscrowError::Frozen,
        constraint = escrow.status == EscrowStatus::Funded as u8 @ EscrowError::BadStatus,
        close = seller,
    )]
    pub escrow: Account<'info, EscrowState>,
    /// CHECK:
    #[account(mut)]
    pub seller: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RefundTo<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [b"config"],
        bump,
        constraint = config.authority == authority.key() @ EscrowError::BadAuthority,
    )]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [b"escrow", escrow.deal_id.as_ref()],
        bump = escrow.bump,
        constraint = escrow.frozen @ EscrowError::NotFrozen,
        close = recipient,
    )]
    pub escrow: Account<'info, EscrowState>,
    /// CHECK:
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(deal_id: [u8; 16])]
pub struct SetFrozen<'info> {
    pub authority: Signer<'info>,
    #[account(
        seeds = [b"config"],
        bump,
        constraint = config.authority == authority.key() @ EscrowError::BadAuthority,
    )]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [b"escrow", deal_id.as_ref()],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, EscrowState>,
}

// --- RWA contexts ---

#[derive(Accounts)]
#[instruction(deal_id: [u8; 16])]
pub struct InitRwaEscrow<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    /// CHECK:
    pub seller: UncheckedAccount<'info>,
    pub mint: Account<'info, Mint>,
    #[account(
        init,
        payer = buyer,
        space = 8 + RwaEscrowState::SIZE,
        seeds = [b"rwa_escrow", deal_id.as_ref()],
        bump
    )]
    pub rwa_escrow: Account<'info, RwaEscrowState>,
    #[account(
        init,
        payer = buyer,
        associated_token::mint = mint,
        associated_token::authority = rwa_escrow,
    )]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositRwaTokens<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(
        mut,
        seeds = [b"rwa_escrow", rwa_escrow.deal_id.as_ref()],
        bump = rwa_escrow.bump,
        constraint = rwa_escrow.buyer == buyer.key() @ EscrowError::BadBuyer,
    )]
    pub rwa_escrow: Account<'info, RwaEscrowState>,
    #[account(
        mut,
        constraint = vault.mint == rwa_escrow.mint @ EscrowError::BadMint,
        constraint = vault.owner == rwa_escrow.key() @ EscrowError::BadVault,
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, constraint = buyer_token.mint == rwa_escrow.mint @ EscrowError::BadMint)]
    pub buyer_token: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct RefreshRwaRiskMock<'info> {
    pub authority: Signer<'info>,
    #[account(
        seeds = [b"config"],
        bump,
        constraint = config.authority == authority.key() @ EscrowError::BadAuthority,
    )]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [b"rwa_escrow", rwa_escrow.deal_id.as_ref()],
        bump = rwa_escrow.bump,
    )]
    pub rwa_escrow: Account<'info, RwaEscrowState>,
}

#[derive(Accounts)]
pub struct RefreshRwaRiskPyth<'info> {
    #[account(
        mut,
        seeds = [b"rwa_escrow", rwa_escrow.deal_id.as_ref()],
        bump = rwa_escrow.bump,
    )]
    pub rwa_escrow: Account<'info, RwaEscrowState>,
    pub price_update: Account<'info, PriceUpdateV2>,
}

#[derive(Accounts)]
pub struct LiquidateRwaMock<'info> {
    pub authority: Signer<'info>,
    #[account(
        seeds = [b"config"],
        bump,
        constraint = config.authority == authority.key() @ EscrowError::BadAuthority,
    )]
    pub config: Account<'info, Config>,
    /// CHECK: original depositor — receives reclaimed rent; SPL collateral is sent to seller
    #[account(mut)]
    pub buyer_rent_dest: UncheckedAccount<'info>,
    /// CHECK:
    pub seller: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"rwa_escrow", rwa_escrow.deal_id.as_ref()],
        bump = rwa_escrow.bump,
        constraint = rwa_escrow.buyer == buyer_rent_dest.key() @ EscrowError::BadBuyer,
        close = buyer_rent_dest,
    )]
    pub rwa_escrow: Account<'info, RwaEscrowState>,
    #[account(
        mut,
        constraint = vault.mint == rwa_escrow.mint @ EscrowError::BadMint,
        constraint = vault.owner == rwa_escrow.key() @ EscrowError::BadVault,
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = seller_token.owner == seller.key() @ EscrowError::BadSeller,
        constraint = seller_token.mint == rwa_escrow.mint @ EscrowError::BadMint,
    )]
    pub seller_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct LiquidateRwaPyth<'info> {
    /// CHECK: original depositor — receives reclaimed rent
    #[account(mut)]
    pub buyer_rent_dest: UncheckedAccount<'info>,
    /// CHECK:
    pub seller: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"rwa_escrow", rwa_escrow.deal_id.as_ref()],
        bump = rwa_escrow.bump,
        constraint = rwa_escrow.buyer == buyer_rent_dest.key() @ EscrowError::BadBuyer,
        close = buyer_rent_dest,
    )]
    pub rwa_escrow: Account<'info, RwaEscrowState>,
    #[account(
        mut,
        constraint = vault.mint == rwa_escrow.mint @ EscrowError::BadMint,
        constraint = vault.owner == rwa_escrow.key() @ EscrowError::BadVault,
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = seller_token.owner == seller.key() @ EscrowError::BadSeller,
        constraint = seller_token.mint == rwa_escrow.mint @ EscrowError::BadMint,
    )]
    pub seller_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub price_update: Account<'info, PriceUpdateV2>,
}

#[derive(Accounts)]
pub struct BuyerReleaseRwa<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    /// CHECK:
    pub seller: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"rwa_escrow", rwa_escrow.deal_id.as_ref()],
        bump = rwa_escrow.bump,
        constraint = rwa_escrow.buyer == buyer.key() @ EscrowError::BadBuyer,
        constraint = !rwa_escrow.frozen @ EscrowError::Frozen,
        constraint = rwa_escrow.status == RwaEscrowStatus::Funded as u8 @ EscrowError::BadStatus,
        close = buyer,
    )]
    pub rwa_escrow: Account<'info, RwaEscrowState>,
    #[account(
        mut,
        constraint = vault.mint == rwa_escrow.mint @ EscrowError::BadMint,
        constraint = vault.owner == rwa_escrow.key() @ EscrowError::BadVault,
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = seller_token.owner == seller.key() @ EscrowError::BadSeller,
        constraint = seller_token.mint == rwa_escrow.mint @ EscrowError::BadMint,
    )]
    pub seller_token: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct RefundRwaTo<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [b"config"],
        bump,
        constraint = config.authority == authority.key() @ EscrowError::BadAuthority,
    )]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [b"rwa_escrow", rwa_escrow.deal_id.as_ref()],
        bump = rwa_escrow.bump,
        constraint = rwa_escrow.frozen @ EscrowError::NotFrozen,
        close = recipient,
    )]
    pub rwa_escrow: Account<'info, RwaEscrowState>,
    #[account(
        mut,
        constraint = vault.mint == rwa_escrow.mint @ EscrowError::BadMint,
        constraint = vault.owner == rwa_escrow.key() @ EscrowError::BadVault,
    )]
    pub vault: Account<'info, TokenAccount>,
    /// CHECK:
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,
    #[account(
        mut,
        constraint = recipient_token.owner == recipient.key() @ EscrowError::BadRecipient,
        constraint = recipient_token.mint == rwa_escrow.mint @ EscrowError::BadMint,
    )]
    pub recipient_token: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(deal_id: [u8; 16])]
pub struct SetFrozenRwa<'info> {
    pub authority: Signer<'info>,
    #[account(
        seeds = [b"config"],
        bump,
        constraint = config.authority == authority.key() @ EscrowError::BadAuthority,
    )]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [b"rwa_escrow", deal_id.as_ref()],
        bump = rwa_escrow.bump,
    )]
    pub rwa_escrow: Account<'info, RwaEscrowState>,
}

#[account]
pub struct Config {
    pub authority: Pubkey,
}

#[account]
pub struct EscrowState {
    pub deal_id: [u8; 16],
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub expected_lamports: u64,
    pub bump: u8,
    pub status: u8,
    pub frozen: bool,
}

#[account]
pub struct RwaEscrowState {
    pub deal_id: [u8; 16],
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub mint: Pubkey,
    pub pyth_feed_id: [u8; 32],
    pub expected_token_amount: u64,
    pub deposited_token_amount: u64,
    pub initial_price_usd_e6: u64,
    pub bump: u8,
    pub status: u8,
    pub frozen: bool,
    pub oracle_mode: u8,
    pub token_decimals: u8,
    pub health: u8,
    pub warning_bps: u16,
    pub liquidation_bps: u16,
}

impl RwaEscrowState {
    pub const SIZE: usize = 16 + 32 * 3 + 32 + 8 * 3 + 1 + 1 + 1 + 1 + 1 + 1 + 2 + 2;
}

#[repr(u8)]
pub enum EscrowStatus {
    AwaitingFunds = 0,
    Funded = 1,
    Released = 2,
    Refunded = 3,
}

#[repr(u8)]
pub enum RwaEscrowStatus {
    AwaitingTokens = 0,
    Funded = 1,
    Released = 2,
    Refunded = 3,
    Liquidated = 4,
}

#[repr(u8)]
pub enum RwaHealth {
    Ok = 0,
    Warning = 1,
    Liquidatable = 2,
}

#[repr(u8)]
pub enum OracleMode {
    Mock = 0,
    Pyth = 1,
}

#[error_code]
pub enum EscrowError {
    #[msg("Amount must be > 0")]
    ZeroAmount,
    #[msg("Invalid deal status for this action")]
    BadStatus,
    #[msg("Escrow is frozen")]
    Frozen,
    #[msg("Escrow must be frozen for refund")]
    NotFrozen,
    #[msg("Wrong authority")]
    BadAuthority,
    #[msg("Wrong buyer")]
    BadBuyer,
    #[msg("Wrong seller")]
    BadSeller,
    #[msg("Deal id mismatch")]
    BadDealId,
    #[msg("Invalid oracle mode")]
    BadOracleMode,
    #[msg("Pyth feed id required for Pyth mode")]
    PythFeedRequired,
    #[msg("Invalid risk bps")]
    BadRiskBps,
    #[msg("Invalid price")]
    BadPrice,
    #[msg("Pyth price unavailable")]
    PythPrice,
    #[msg("Amount overflow")]
    AmountOverflow,
    #[msg("Not liquidatable under thresholds")]
    NotLiquidatable,
    #[msg("Wrong mint")]
    BadMint,
    #[msg("Wrong vault")]
    BadVault,
    #[msg("Wrong recipient")]
    BadRecipient,
}
