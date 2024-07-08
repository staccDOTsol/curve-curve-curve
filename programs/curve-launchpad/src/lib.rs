use anchor_lang::prelude::*;
use instructions::*;
use anchor_lang::solana_program::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
};

pub mod instructions;
pub mod state;
pub mod amm;
pub use state::{BondingCurve, Team};
use anchor_lang::{
    prelude::*,
    system_program::{create_account, CreateAccount},
};
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
};
use spl_tlv_account_resolution::{
    account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList,
};
use spl_transfer_hook_interface::instruction::{ExecuteInstruction, TransferHookInstruction};

// Order of accounts matters for this struct.
// The first 4 accounts are the accounts required for token transfer (source, mint, destination, owner)
// Remaining accounts are the extra accounts required from the ExtraAccountMetaList account
// These accounts are provided via CPI to this program from the token2022 program
#[derive(Accounts)]
pub struct TransferHook<'info> {
    #[account(
        token::mint = mint, 
        token::authority = owner,
    )]
    pub source_token: Box<InterfaceAccount<'info, TokenAccount>>,
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        token::mint = mint,
    )]
    pub destination_token: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: source token account owner, can be SystemAccount or PDA owned by another program
    pub owner: UncheckedAccount<'info>,
    /// CHECK: ExtraAccountMetaList Account,
    #[account(
        seeds = [b"extra-account-metas", mint.key().as_ref()], 
        bump
    )]
    pub extra_account_meta_list: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"delegate"], 
        bump
    )]
    pub delegate: SystemAccount<'info>,
    #[account(mut, seeds = [b"user", owner.key().as_ref(), mint.key().as_ref()], bump)]
    pub user: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
    #[account(mut,
        seeds = [BondingCurve::SEED_PREFIX, bonding_curve.creator.as_ref()],
        bump,
    )]
    bonding_curve: Box<Account<'info, BondingCurve>>,
}

declare_id!("FYnpDiZVejAbvnme7WZrxUE2T5K4Fv4MwDsZQ2JLzMYm");

#[program]
pub mod curve_launchpad {

    use super::*;

   /*
    pub fn transfer_hook(ctx: Context<TransferHook>, amount: u64) -> Result<()> {
        let signer_seeds: &[&[&[u8]]] = &[&[b"delegate", &[ctx.bumps.delegate]]];
    
        // Anti-bot measures
        let clock = Clock::get()?;
        let current_timestamp = clock.unix_timestamp;
    
        // Get or initialize the user's transfer data
        let mut user_transfer_data = UserTransferData::get_or_init(
            &ctx.accounts.user.to_account_info(),
            &ctx.accounts.delegate.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            signer_seeds,
        )?;
    
        // Check if the user is a dev
        let is_dev = ctx.accounts.bonding_curve.creator == ctx.accounts.user.key();
    
        // Calculate the maximum allowed transfer amount
        let max_transfer_percentage = if is_dev {
            let seconds_since_last_transfer = (current_timestamp - user_transfer_data.last_transfer_timestamp) as f64;
            // This is in seconds
            let max_percentage = (seconds_since_last_transfer / 3600.0) * 0.005;
            max_percentage.min(0.005) // Cap at 0.5% maximum
        } else {
            1.0 // 100% for regular users
        };
    
        let total_supply = ctx.accounts.bonding_curve.token_total_supply;
        let max_allowed_amount = (total_supply as f64 * max_transfer_percentage) as u64;
    
        // Check if the transfer amount exceeds the maximum allowed
        if amount > max_allowed_amount {
            return Err(ProgramError::InvalidInstructionData.into());
        }
    
        // Update user's transfer data
        user_transfer_data.last_transfer_timestamp = current_timestamp;
        user_transfer_data.save(
            &ctx.accounts.user.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            signer_seeds,
        )?;
    
        // Proceed with the transfer if all checks pass
        Ok(())
    }
 
    // fallback instruction handler as workaround to anchor instruction discriminator check
    pub fn fallback<'info>(
        program_id: &Pubkey,
        accounts: &'info [AccountInfo<'info>],
        data: &[u8],
    ) -> Result<()> {
        let instruction = TransferHookInstruction::unpack(data)?;

        // match instruction discriminator to transfer hook interface execute instruction  
        // token2022 program CPIs this instruction on token transfer
        match instruction {
            TransferHookInstruction::Execute { amount } => {
                let amount_bytes = amount.to_le_bytes();

                // invoke custom transfer hook instruction on our program
                __private::__global::transfer_hook(program_id, accounts, &amount_bytes)
            }
            _ => return Err(ProgramError::InvalidInstructionData.into()),
        }
    }
*/
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        initialize::initialize(ctx)
    }

    pub fn create(ctx: Context<Create>, name: String, symbol: String, uri: String, team: Team) -> Result<()> {
        create::create(ctx, name, symbol, uri, team)
    }

    pub fn buy(ctx: Context<Buy>, token_amount: u64, max_sol_cost: u64) -> Result<()> {
        buy::buy(ctx, token_amount, max_sol_cost)
    }

    pub fn sell(ctx: Context<Sell>, token_amount: u64, min_sol_output: u64) -> Result<()> {
        sell::sell(ctx, token_amount, min_sol_output)
    }

    pub fn set_params(
        ctx: Context<SetParams>,
        initial_virtual_token_reserves: u64,
        initial_virtual_sol_reserves: u64,
        initial_real_token_reserves: u64,
        inital_token_supply: u64,
        fee_basis_points: u64,
    ) -> Result<()> {
        set_params::set_params(
            ctx,
            initial_virtual_token_reserves,
            initial_virtual_sol_reserves,
            initial_real_token_reserves,
            inital_token_supply,
            fee_basis_points,
        )
    }
}