use crate::{
    state::{BondingCurve, Global, Team}, CreateEvent, CurveLaunchpadError, DEFAULT_DECIMALS
};

use anchor_lang::{prelude::*, solana_program::program::{invoke, invoke_signed}, system_program::{create_account, CreateAccount}};
use anchor_spl::{
    associated_token::AssociatedToken, token_2022::{self, SetAuthority}, token_2022_extensions, token_interface::{
        self as token, metadata_pointer_initialize, mint_to, spl_token_2022::instruction::AuthorityType, spl_token_metadata_interface::instruction::initialize, Mint, MintTo, TokenAccount, TokenInterface
    }
};
use spl_associated_token_account::instruction::AssociatedTokenAccountInstruction;
use spl_tlv_account_resolution::{account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList};
use spl_transfer_hook_interface::instruction::ExecuteInstruction;


#[event_cpi]
#[derive(Accounts)]
pub struct Create<'info> {
    #[account(
        mut, signer
    )]
    /// CHECK:
    mint: UncheckedAccount<'info>,

    #[account(mut)]
    creator: Signer<'info>,

    /// CHECK: Using seed to validate mint_authority account
    #[account(
        seeds=[b"mint-authority"],
        bump,
    )]
    mint_authority: AccountInfo<'info>,

    #[account(
        init,
        payer = creator,
        seeds = [BondingCurve::SEED_PREFIX, creator.to_account_info().key.as_ref()],
        bump,
        space = 8 + BondingCurve::INIT_SPACE,
    )]
    bonding_curve: Box<Account<'info, BondingCurve>>,
    

    #[account(
        mut
    )]
    /// CHECK:
    bonding_curve_token_account: UncheckedAccount<'info>,

    #[account(
        seeds = [Global::SEED_PREFIX],
        bump,
    )]
    global: Box<Account<'info, Global>>,

    system_program: Program<'info, System>,

    token_program: Interface<'info, TokenInterface>,

    associated_token_program: Program<'info, AssociatedToken>,

    rent: Sysvar<'info, Rent>,
    /// CHECK: ExtraAccountMetaList Account, must use these seeds
    #[account(
        mut,
        seeds = [b"extra-account-metas", mint.key().as_ref()], 
        bump
    )]
    pub extra_account_meta_list: AccountInfo<'info>,
    
}


pub fn create(ctx: Context<Create>, name: String, symbol: String, uri: String, team: Team) -> Result<()> {
    //confirm program is initialized
    {
        require!(
            ctx.accounts.global.initialized,
            CurveLaunchpadError::NotInitialized
        );

        msg!("create::BondingCurve::get_lamports: {:?}", &ctx.accounts.bonding_curve.get_lamports());
    }
    let seeds = &["mint-authority".as_bytes(), &[ctx.bumps.mint_authority]];
    let signer = [&seeds[..]];
    {
    let metadata_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        anchor_spl::token_2022_extensions::MetadataPointerInitialize {
            token_program_id: ctx.accounts.token_program.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
        },
        &signer,
    );


    metadata_pointer_initialize(metadata_ctx, Some(*ctx.accounts.mint_authority.to_account_info().key), Some(*ctx.accounts.mint.to_account_info().key))?;
    
    
    let set_transfer_fee_accounts = token_2022_extensions::TransferFeeInitialize { token_program_id: ctx.accounts.token_program.to_account_info(), mint: ctx.accounts.mint.to_account_info() };
    let set_transfer_fee_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        set_transfer_fee_accounts,
        &signer,
    );
    token_2022_extensions::transfer_fee_initialize(
        set_transfer_fee_ctx,
        Some(&ctx.accounts.mint_authority.to_account_info().key),
        Some(&ctx.accounts.creator.to_account_info().key),
        10,
        0, // Maximum fee (1% of total supply)
    )?;
    
    let cpi_accounts = token::InitializeMint {
        mint: ctx.accounts.mint.to_account_info(),
        rent: ctx.accounts.rent.to_account_info(),
    };
    let cpi_context = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
    );
    token_2022::initialize_mint(
        cpi_context,
        DEFAULT_DECIMALS as u8,
        &ctx.accounts.mint_authority.key(),
        None
    )?;


    let ix = initialize(
        ctx.accounts.token_program.to_account_info().key,
        ctx.accounts.mint.to_account_info().key,
        ctx.accounts.mint_authority.to_account_info().key,
        ctx.accounts.mint.to_account_info().key,
        ctx.accounts.mint_authority.to_account_info().key,
        name.clone(),
        symbol.clone(),
        uri.clone(),
    );
    let accounts = vec![
        ctx.accounts.mint.to_account_info(),
        ctx.accounts.mint_authority.to_account_info(),
    ];
    invoke_signed(&ix, &accounts, &signer)?;
    // Set transfer fee
    // Set fee authority to creator
    let set_authority_accounts = SetAuthority {
        account_or_mint: ctx.accounts.mint.to_account_info(),
        current_authority: ctx.accounts.mint_authority.to_account_info(),
    };
    let set_authority_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        set_authority_accounts,
        &signer,
    );
    token_2022::set_authority(
        set_authority_ctx,
        AuthorityType::TransferFeeConfig,
        Some(ctx.accounts.creator.key()),
    )?;
    // Create the ExtraAccountMetaList account
  
  let data = 0u8;
    let ix = anchor_lang::solana_program::instruction::Instruction {
        program_id: *ctx.accounts.associated_token_program.to_account_info().key,
        accounts: vec![
            AccountMeta::new(*ctx.accounts.creator.to_account_info().key, true),
            AccountMeta::new(*ctx.accounts.bonding_curve_token_account.to_account_info().key, false),
            AccountMeta::new_readonly(*ctx.accounts.bonding_curve.to_account_info().key, false),
            AccountMeta::new_readonly(*ctx.accounts.mint.to_account_info().key, false),
            AccountMeta::new_readonly(*ctx.accounts.system_program.to_account_info().key, false),
            AccountMeta::new_readonly(*ctx.accounts.token_program.to_account_info().key, false),
        ],
        data: data.try_to_vec().unwrap()
};
    let accounts = vec![
    ctx.accounts.creator.to_account_info(),
        ctx.accounts.bonding_curve_token_account.to_account_info(),
        ctx.accounts.bonding_curve.to_account_info(),
        ctx.accounts.mint.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.rent.to_account_info(),
    ];
    invoke(&ix, &accounts)?;

}
{
     // index 0-3 are the accounts required for token transfer (source, mint, destination, owner)
        // index 4 is address of ExtraAccountMetaList account
        // The `addExtraAccountsToInstruction` JS helper function resolving incorrectly
        let account_metas = vec![
            // index 5, wrapped SOL mint    
            // index 6, token program
            ExtraAccountMeta::new_with_seeds(
                &[Seed::Literal {
                    bytes: "delegate".as_bytes().to_vec(),
                }],
                false,
                true
            )?,
            ExtraAccountMeta::new_with_seeds(
                &[Seed::Literal {
                    bytes: "user".as_bytes().to_vec(),
                }, Seed::AccountKey { index: 3 },
                Seed::AccountKey { index: 1 },
                ],
                false, // is_signer
                true,  // is_writable
            )?,
            ExtraAccountMeta::new_with_pubkey(&ctx.accounts.system_program.key(), false, false)?,
            ExtraAccountMeta::new_with_pubkey(&ctx.accounts.bonding_curve.key(), false, true)?,
        ];

        // calculate account size
        let account_size = ExtraAccountMetaList::size_of(account_metas.len())? as u64;
        // calculate minimum required lamports
        let lamports = Rent::get()?.minimum_balance(account_size as usize);

        let mint = ctx.accounts.mint.key();
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"extra-account-metas",
            &mint.as_ref(),
            &[ctx.bumps.extra_account_meta_list],
        ]];

        // create ExtraAccountMetaList account
        create_account(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                CreateAccount {
                    from: ctx.accounts.creator.to_account_info(),
                    to: ctx.accounts.extra_account_meta_list.to_account_info(),
                },
            )
            .with_signer(signer_seeds),
            lamports,
            account_size,
            ctx.program_id,
        )?;

        // initialize ExtraAccountMetaList account with extra accounts
        ExtraAccountMetaList::init::<ExecuteInstruction>(
            &mut ctx.accounts.extra_account_meta_list.try_borrow_mut_data()?,
            &account_metas,
        )?;
}
{
    //mint tokens to bonding_curve_token_account
    mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                authority: ctx.accounts.mint_authority.to_account_info(),
                to: ctx.accounts.bonding_curve_token_account.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
            },
            &signer,
        ),
        ctx.accounts.global.initial_token_supply,
    )?;

    //remove mint_authority
    let cpi_context = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        token_2022::SetAuthority {
            current_authority: ctx.accounts.mint_authority.to_account_info(),
            account_or_mint: ctx.accounts.mint.to_account_info(),
        },
        &signer,
    );
    token_2022::set_authority(cpi_context, AuthorityType::MintTokens, None)?;
}
{
    let bonding_curve = &mut ctx.accounts.bonding_curve;
    bonding_curve.virtual_sol_reserves = ctx.accounts.global.initial_virtual_sol_reserves;
    bonding_curve.virtual_token_reserves = ctx.accounts.global.initial_virtual_token_reserves;
    bonding_curve.real_sol_reserves = 0;
    bonding_curve.real_token_reserves = ctx.accounts.global.initial_real_token_reserves;
    bonding_curve.token_total_supply = ctx.accounts.global.initial_token_supply;
    bonding_curve.complete = false;
    bonding_curve.creator = *ctx.accounts.creator.to_account_info().key;
    bonding_curve.team = team;
    bonding_curve.token_account = *ctx.accounts.bonding_curve_token_account.to_account_info().key;

    emit_cpi!(CreateEvent {
        name,
        symbol,
        uri,
        mint: *ctx.accounts.mint.to_account_info().key,
        bonding_curve: *ctx.accounts.bonding_curve.to_account_info().key,
        creator: *ctx.accounts.creator.to_account_info().key,
    });

}
    Ok(())
}
