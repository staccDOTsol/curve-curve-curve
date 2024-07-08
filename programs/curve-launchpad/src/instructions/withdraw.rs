use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{self as token, Mint, TokenInterface, TokenAccount, TransferChecked},
};

use crate::{
    state::{BondingCurve, Global, LastWithdraw},
    CurveLaunchpadError,
};

