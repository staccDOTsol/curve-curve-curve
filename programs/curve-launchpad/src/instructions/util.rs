use anchor_lang::{accounts::account::Account, solana_program::{account_info::AccountInfo, clock::Clock, program_error::ProgramError, sysvar::Sysvar}};

use crate::{BondingCurve, state::UserTransferData};


pub fn calculate_fee(
    amount: u64,
    fee_basis_points: u64,
) -> u64 {
    amount * fee_basis_points / 10000
}
pub fn check_buy_sell<'a>( user_transfer_data: &mut Account<'a, UserTransferData>,user_account: AccountInfo<'a>,  system_account: AccountInfo<'a>, bonding_curve: Account<'a, BondingCurve>, amount: u64) -> Result<(), ProgramError>
{
    
    // Anti-bot measures
    let clock = Clock::get()?;
    let current_timestamp = clock.unix_timestamp;

    // Get or initialize the user's transfer data

    // Check if the user is a dev
    let is_dev = bonding_curve.creator == *user_account.key;

    // Calculate the maximum allowed transfer amount
    let max_transfer_percentage = if is_dev {
        let seconds_since_last_transfer = (current_timestamp - user_transfer_data.last_transfer_timestamp) as f64;
        // This is in seconds
        let max_percentage = (seconds_since_last_transfer / 3600.0) * 0.005;
        max_percentage.min(0.005) // Cap at 0.5% maximum
    } else {
        1.0 // 100% for regular users
    };

    let total_supply = bonding_curve.token_total_supply;
    let max_allowed_amount = (total_supply as f64 * max_transfer_percentage) as u64;

    // Check if the transfer amount exceeds the maximum allowed
    if amount > max_allowed_amount {
        return Err(ProgramError::InvalidInstructionData.into());
    }

    // Update user's transfer data
    user_transfer_data.last_transfer_timestamp = current_timestamp;
 

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_fee() {
        assert_eq!(calculate_fee(100, 100), 1); //1% fee
        assert_eq!(calculate_fee(100, 1000), 10); //10% fee
        assert_eq!(calculate_fee(100, 5000), 50); //50% fee
        assert_eq!(calculate_fee(100, 50000), 500); //500% fee
        assert_eq!(calculate_fee(100, 50), 0); //0.5% fee 
        assert_eq!(calculate_fee(1000, 50), 5); //0.5% fee
        assert_eq!(calculate_fee(100, 0), 0); //0% fee
    }
}