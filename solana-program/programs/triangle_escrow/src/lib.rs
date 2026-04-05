use anchor_lang::prelude::*;

declare_id!("7RnW9zpz4vwmebbPJqh5hSTdvUSrFGdZGZYWFZSbfgcV");

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

#[repr(u8)]
pub enum EscrowStatus {
    AwaitingFunds = 0,
    Funded = 1,
    Released = 2,
    Refunded = 3,
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
}
