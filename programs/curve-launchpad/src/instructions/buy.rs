use anchor_lang::{prelude::*, solana_program::system_instruction};
use anchor_spl::{associated_token::AssociatedToken, memo::Memo, token_interface::{self as token, Mint, TokenAccount, TokenInterface, TransferChecked}};
use whirlpool::state::{FeeTier, Position, TickArray, Whirlpool, WhirlpoolsConfig};
use std::str::FromStr;
use crate::{
    amm, calculate_fee, check_buy_sell, state::{BondingCurve, Global, LastWithdraw, UserTransferData}, CompleteEvent, CurveLaunchpadError, TradeEvent
};

#[event_cpi]
#[derive(Accounts)]
#[instruction(start_tick_index: i32)]


pub struct Buy<'info> {
    #[account(mut)]
   pub user: Signer<'info>,

    #[account(
        seeds = [Global::SEED_PREFIX],
        bump,
    )]
   pub global: Box<Account<'info, Global>>,

    /// CHECK: Using global state to validate fee_recipient account
    #[account(mut)]
    pub fee_recipient: AccountInfo<'info>,

   pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        seeds = [BondingCurve::SEED_PREFIX, bonding_curve.creator.as_ref()],
        bump,
    )]
    pub bonding_curve: Box<Account<'info, BondingCurve>>,

    #[account(
        mut,
        address = bonding_curve.token_account,
    )]
    pub bonding_curve_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
     //   associated_token::mint = mint,
     //   associated_token::authority = user,
    )]
    pub user_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub system_program: Program<'info, System>,

    pub token_program: Interface<'info, TokenInterface>,

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + UserTransferData::INIT_SPACE,
        seeds = [b"user", user.key().as_ref(), mint.key().as_ref()],
        bump
    )]
    pub user_transfer_data: Box<Account<'info, UserTransferData>>,

    #[account(
        init_if_needed,
        space = 8 + LastWithdraw::INIT_SPACE,
        seeds = [LastWithdraw::SEED_PREFIX],
        bump,
        payer = user,
    )]
    pub last_withdraw: Box<Account<'info, LastWithdraw>>,
    #[account(address = Pubkey::from_str("J5T5RStZBW2ayuTp5dGCQMHsUApCReRbytDMRd4ZP2aR").unwrap())]
    pub whirlpools_config: Box<Account<'info, WhirlpoolsConfig>>,

    pub token_mint_a: Box<InterfaceAccount<'info, Mint>>,
    pub token_mint_b: Box<InterfaceAccount<'info, Mint>>,

    #[account(seeds = [b"token_badge", whirlpools_config.key().as_ref(), token_mint_a.key().as_ref()], bump)]
    /// CHECK: checked in the handler
    pub token_badge_a: UncheckedAccount<'info>,
    #[account(seeds = [b"token_badge", whirlpools_config.key().as_ref(), token_mint_b.key().as_ref()], bump)]
    /// CHECK: checked in the handler
    pub token_badge_b: UncheckedAccount<'info>,

    #[account(mut)]
    pub funder: Signer<'info>,

    #[account(init,
      seeds = [
        b"whirlpool".as_ref(),
        whirlpools_config.key().as_ref(),
        token_mint_a.key().as_ref(),
        token_mint_b.key().as_ref(),
        256_u16.to_le_bytes().as_ref()
      ],
      bump,
      payer = funder,
      space = Whirlpool::LEN)]
    pub whirlpool: Box<Account<'info, Whirlpool>>,

    #[account(init,
      payer = funder,
      token::token_program = token_program_a,
      token::mint = token_mint_a,
      token::authority = whirlpool)]
    pub token_vault_a: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(init,
      payer = funder,
      token::token_program = token_program_b,
      token::mint = token_mint_b,
      token::authority = whirlpool)]
    pub token_vault_b: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(has_one = whirlpools_config, constraint = fee_tier.tick_spacing == 256_u16)]
    pub fee_tier: Account<'info, FeeTier>,

    #[account(address = token_mint_a.to_account_info().owner.clone())]
    pub token_program_a: Interface<'info, TokenInterface>,
    #[account(address = token_mint_b.to_account_info().owner.clone())]
    pub token_program_b: Interface<'info, TokenInterface>,
    pub rent: Sysvar<'info, Rent>,

    #[account(
      init,
      payer = funder,
      seeds = [b"tick_array", whirlpool.key().as_ref(), start_tick_index.to_string().as_bytes()],
      bump,
      space = TickArray::LEN)]
    pub tick_array: AccountLoader<'info, TickArray>,

    /// CHECK: safe, the account that will be the owner of the position can be arbitrary
    pub owner: UncheckedAccount<'info>,

    #[account(init,
      payer = funder,
      space = Position::LEN,
      seeds = [b"position".as_ref(), position_mint.key().as_ref()],
      bump,
    )]
    pub position: Box<Account<'info, Position>>,

    #[account(init,
        payer = funder,
        mint::authority = whirlpool,
        mint::decimals = 0,
    )]
    pub position_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(init,
      payer = funder,
      associated_token::mint = position_mint,
      associated_token::authority = owner,
    )]
    pub position_token_account: Box<InterfaceAccount<'info, TokenAccount>>,


    pub associated_token_program: Program<'info, AssociatedToken>,

    pub memo_program: Program<'info, Memo>,

    pub position_authority: Signer<'info>,

    #[account(mut, constraint = token_owner_account_a.mint == whirlpool.token_mint_a)]
    pub token_owner_account_a: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, constraint = token_owner_account_b.mint == whirlpool.token_mint_b)]
    pub token_owner_account_b: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, has_one = whirlpool)]
    pub tick_array_lower: AccountLoader<'info, TickArray>,
    #[account(mut, has_one = whirlpool)]
    pub tick_array_upper: AccountLoader<'info, TickArray>,
}

pub fn buy(ctx: Context<Buy>, token_amount: u64, max_sol_cost: u64) -> Result<()> {
    check_buy_sell(
        &mut ctx.accounts.user_transfer_data,
        ctx.accounts.user.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        *ctx.accounts.bonding_curve.clone(),
        token_amount,
    )?;
    require!(
        ctx.accounts.global.initialized,
        CurveLaunchpadError::NotInitialized
    );

    //bonding curve is not complete
    require!(
        ctx.accounts.bonding_curve.complete == false,
        CurveLaunchpadError::BondingCurveComplete,
    );

    //invalid fee recipient
    require!(
        ctx.accounts.fee_recipient.key == &ctx.accounts.global.fee_recipient,
        CurveLaunchpadError::InvalidFeeRecipient,
    );

    //bonding curve has enough tokens
    require!(
        ctx.accounts.bonding_curve.real_token_reserves >= token_amount,
        CurveLaunchpadError::InsufficientTokens,
    );

    require!(token_amount > 0, CurveLaunchpadError::MinBuy,);

    let targe_token_amount = if ctx.accounts.bonding_curve_token_account.amount < token_amount {
        ctx.accounts.bonding_curve_token_account.amount
    } else {
        token_amount
    };

    let mut amm = amm::amm::AMM::new(
        ctx.accounts.bonding_curve.virtual_sol_reserves as u128,
        ctx.accounts.bonding_curve.virtual_token_reserves as u128,
        ctx.accounts.bonding_curve.real_sol_reserves as u128,
        ctx.accounts.bonding_curve.real_token_reserves as u128,
        ctx.accounts.global.initial_virtual_token_reserves as u128,
    );

    let buy_result = amm.apply_buy(targe_token_amount as u128).unwrap();
    let fee = calculate_fee(buy_result.sol_amount, ctx.accounts.global.fee_basis_points);
    let buy_amount_with_fee = buy_result.sol_amount + fee;

    //check if the amount of SOL to transfe plus fee is less than the max_sol_cost
    require!(
        buy_amount_with_fee <= max_sol_cost,
        CurveLaunchpadError::MaxSOLCostExceeded,
    );

    //check if the user has enough SOL
    require!(
        ctx.accounts.user.lamports() >= buy_amount_with_fee,
        CurveLaunchpadError::InsufficientSOL,
    );
    
    // transfer SOL to bonding curve
    let from_account = &ctx.accounts.user;
    let to_bonding_curve_account = &ctx.accounts.bonding_curve;

    let transfer_instruction = system_instruction::transfer(
        from_account.key,
        to_bonding_curve_account.to_account_info().key,
        buy_result.sol_amount,
    );

    anchor_lang::solana_program::program::invoke_signed(
        &transfer_instruction,
        &[
            from_account.to_account_info(),
            to_bonding_curve_account.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
        &[],
    )?;

    //transfer SOL to fee recipient
    let to_fee_recipient_account = &ctx.accounts.fee_recipient;

    let transfer_instruction = system_instruction::transfer(
        from_account.key,
        to_fee_recipient_account.key,
        fee,
    );

    anchor_lang::solana_program::program::invoke_signed(
        &transfer_instruction,
        &[
            from_account.to_account_info(),
            to_fee_recipient_account.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
        &[],
    )?;

    //transfer SPL
    let cpi_accounts = TransferChecked {
        from: ctx
            .accounts
            .bonding_curve_token_account
            .to_account_info()
            .clone(),
        to: ctx.accounts.user_token_account.to_account_info().clone(),
        authority: ctx.accounts.bonding_curve.to_account_info().clone(),
        mint: ctx.accounts.mint.to_account_info().clone(),
    };

    let signer: [&[&[u8]]; 1] = [&[
        BondingCurve::SEED_PREFIX,
        ctx.accounts.bonding_curve.creator.as_ref(),
        &[ctx.bumps.bonding_curve],
    ]];

    token::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            &signer,
        ),
        buy_result.token_amount,
        crate::DEFAULT_DECIMALS.try_into().unwrap()
    )?;

    //apply the buy to the bonding curve
    let bonding_curve = &mut ctx.accounts.bonding_curve;
    bonding_curve.real_token_reserves = amm.real_token_reserves as u64;
    bonding_curve.real_sol_reserves = amm.real_sol_reserves as u64;
    bonding_curve.virtual_token_reserves = amm.virtual_token_reserves as u64;
    bonding_curve.virtual_sol_reserves = amm.virtual_sol_reserves as u64;

    emit_cpi!(TradeEvent {
        mint: *ctx.accounts.mint.to_account_info().key,
        sol_amount: buy_result.sol_amount,
        token_amount: buy_result.token_amount,
        is_buy: true,
        user: *ctx.accounts.user.to_account_info().key,
        timestamp: Clock::get()?.unix_timestamp,
        virtual_sol_reserves: bonding_curve.virtual_sol_reserves,
        virtual_token_reserves: bonding_curve.virtual_token_reserves,
        real_sol_reserves: bonding_curve.real_sol_reserves,
        real_token_reserves: bonding_curve.real_token_reserves,
    });

    if bonding_curve.real_token_reserves == 0 {
        bonding_curve.complete = true;

        emit_cpi!(CompleteEvent {
            user: *ctx.accounts.user.to_account_info().key,
            mint: *ctx.accounts.mint.to_account_info().key,
            bonding_curve: *ctx.accounts.bonding_curve.to_account_info().key,
            timestamp: Clock::get()?.unix_timestamp,
        });
    }

    msg!("bonding_curve: {:?}", amm);

    Ok(())
}
