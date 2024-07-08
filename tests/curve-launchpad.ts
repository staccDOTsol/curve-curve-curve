import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CurveLaunchpad } from "../target/types/curve_launchpad";
import { AccountMeta, Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction, PublicKey as pk} from "@solana/web3.js";
import {
  ammFromBondingCurve,
  fundAccountSOL,
  getAnchorError,
  getSPLBalance,
  sendTransaction,
  toEvent,
} from "./util";
import { createInitializeInstruction, pack, TokenMetadata } from '@solana/spl-token-metadata';
import { AccountInfo, PublicKey } from '@solana/web3.js';

import { ACCOUNT_SIZE, ASSOCIATED_TOKEN_PROGRAM_ID, AccountLayout, addExtraAccountMetasForExecute, createExecuteInstruction, createTransferCheckedWithFeeAndTransferHookInstruction, getExtraAccountMetaAddress, getExtraAccountMetas, getMint, getTransferHook, resolveExtraAccountMeta } from '@solana/spl-token';
import type { Mint } from '@solana/spl-token';
import { MINT_SIZE, unpackMint } from '@solana/spl-token';
import { MULTISIG_SIZE } from '@solana/spl-token';
import { ACCOUNT_TYPE_SIZE } from '@solana/spl-token';
import { CPI_GUARD_SIZE } from '@solana/spl-token';
import { DEFAULT_ACCOUNT_STATE_SIZE } from '@solana/spl-token';
import { IMMUTABLE_OWNER_SIZE } from '@solana/spl-token';
import { INTEREST_BEARING_MINT_CONFIG_STATE_SIZE } from '@solana/spl-token';
import { MEMO_TRANSFER_SIZE } from '@solana/spl-token';
import { METADATA_POINTER_SIZE } from '@solana/spl-token';
import { MINT_CLOSE_AUTHORITY_SIZE } from '@solana/spl-token';
import { NON_TRANSFERABLE_SIZE, NON_TRANSFERABLE_ACCOUNT_SIZE } from '@solana/spl-token';
import { PERMANENT_DELEGATE_SIZE } from '@solana/spl-token';
import { TRANSFER_FEE_AMOUNT_SIZE, TRANSFER_FEE_CONFIG_SIZE } from '@solana/spl-token';
import { TRANSFER_HOOK_ACCOUNT_SIZE, TRANSFER_HOOK_SIZE } from '@solana/spl-token';

// Sequence from https://github.com/solana-labs/solana-program-library/blob/master/token/program-2022/src/extension/mod.rs#L903
export enum ExtensionType {
    Uninitialized,
    TransferFeeConfig,
    TransferFeeAmount,
    MintCloseAuthority,
    ConfidentialTransferMint,
    ConfidentialTransferAccount,
    DefaultAccountState,
    ImmutableOwner,
    MemoTransfer,
    NonTransferable,
    InterestBearingConfig,
    CpiGuard,
    PermanentDelegate,
    NonTransferableAccount,
    TransferHook,
    TransferHookAccount,
    // ConfidentialTransferFee, // Not implemented yet
    // ConfidentialTransferFeeAmount, // Not implemented yet
    MetadataPointer, // Remove number once above extensions implemented
    TokenMetadata, // Remove number once above extensions implemented
}


function addTypeAndLengthToLen(len: number): number {
    return len + TYPE_SIZE + LENGTH_SIZE;
}

function isVariableLengthExtension(e: ExtensionType): boolean {
    switch (e) {
        case ExtensionType.TokenMetadata:
            return true;
        default:
            return false;
    }
}

// NOTE: All of these should eventually use their type's Span instead of these
// constants.  This is provided for at least creation to work.
export function getTypeLen(e: ExtensionType): number {
    switch (e) {
        case ExtensionType.Uninitialized:
            return 0;
        case ExtensionType.TransferFeeConfig:
            return TRANSFER_FEE_CONFIG_SIZE;
        case ExtensionType.TransferFeeAmount:
            return TRANSFER_FEE_AMOUNT_SIZE;
        case ExtensionType.MintCloseAuthority:
            return MINT_CLOSE_AUTHORITY_SIZE;
        case ExtensionType.ConfidentialTransferMint:
            return 97;
        case ExtensionType.ConfidentialTransferAccount:
            return 286;
        case ExtensionType.CpiGuard:
            return CPI_GUARD_SIZE;
        case ExtensionType.DefaultAccountState:
            return DEFAULT_ACCOUNT_STATE_SIZE;
        case ExtensionType.ImmutableOwner:
            return IMMUTABLE_OWNER_SIZE;
        case ExtensionType.MemoTransfer:
            return MEMO_TRANSFER_SIZE;
        case ExtensionType.MetadataPointer:
            return METADATA_POINTER_SIZE;
        case ExtensionType.NonTransferable:
            return NON_TRANSFERABLE_SIZE;
        case ExtensionType.InterestBearingConfig:
            return INTEREST_BEARING_MINT_CONFIG_STATE_SIZE;
        case ExtensionType.PermanentDelegate:
            return PERMANENT_DELEGATE_SIZE;
        case ExtensionType.NonTransferableAccount:
            return NON_TRANSFERABLE_ACCOUNT_SIZE;
        case ExtensionType.TransferHook:
            return TRANSFER_HOOK_SIZE;
        case ExtensionType.TransferHookAccount:
            return TRANSFER_HOOK_ACCOUNT_SIZE;
        case ExtensionType.TokenMetadata:
            throw Error(`Cannot get type length for variable extension type: ${e}`);
        default:
            throw Error(`Unknown extension type: ${e}`);
    }
}

export function isMintExtension(e: ExtensionType): boolean {
    switch (e) {
        case ExtensionType.TransferFeeConfig:
        case ExtensionType.MintCloseAuthority:
        case ExtensionType.ConfidentialTransferMint:
        case ExtensionType.DefaultAccountState:
        case ExtensionType.NonTransferable:
        case ExtensionType.InterestBearingConfig:
        case ExtensionType.PermanentDelegate:
        case ExtensionType.TransferHook:
        case ExtensionType.MetadataPointer:
        case ExtensionType.TokenMetadata:
            return true;
        case ExtensionType.Uninitialized:
        case ExtensionType.TransferFeeAmount:
        case ExtensionType.ConfidentialTransferAccount:
        case ExtensionType.ImmutableOwner:
        case ExtensionType.MemoTransfer:
        case ExtensionType.CpiGuard:
        case ExtensionType.NonTransferableAccount:
        case ExtensionType.TransferHookAccount:
            return false;
        default:
            throw Error(`Unknown extension type: ${e}`);
    }
}

export function isAccountExtension(e: ExtensionType): boolean {
    switch (e) {
        case ExtensionType.TransferFeeAmount:
        case ExtensionType.ConfidentialTransferAccount:
        case ExtensionType.ImmutableOwner:
        case ExtensionType.MemoTransfer:
        case ExtensionType.CpiGuard:
        case ExtensionType.NonTransferableAccount:
        case ExtensionType.TransferHookAccount:
            return true;
        case ExtensionType.Uninitialized:
        case ExtensionType.TransferFeeConfig:
        case ExtensionType.MintCloseAuthority:
        case ExtensionType.ConfidentialTransferMint:
        case ExtensionType.DefaultAccountState:
        case ExtensionType.NonTransferable:
        case ExtensionType.InterestBearingConfig:
        case ExtensionType.PermanentDelegate:
        case ExtensionType.TransferHook:
        case ExtensionType.MetadataPointer:
        case ExtensionType.TokenMetadata:
            return false;
        default:
            throw Error(`Unknown extension type: ${e}`);
    }
}

export function getAccountTypeOfMintType(e: ExtensionType): ExtensionType {
    switch (e) {
        case ExtensionType.TransferFeeConfig:
            return ExtensionType.TransferFeeAmount;
        case ExtensionType.ConfidentialTransferMint:
            return ExtensionType.ConfidentialTransferAccount;
        case ExtensionType.NonTransferable:
            return ExtensionType.NonTransferableAccount;
        case ExtensionType.TransferHook:
            return ExtensionType.TransferHookAccount;
        case ExtensionType.TransferFeeAmount:
        case ExtensionType.ConfidentialTransferAccount:
        case ExtensionType.CpiGuard:
        case ExtensionType.DefaultAccountState:
        case ExtensionType.ImmutableOwner:
        case ExtensionType.MemoTransfer:
        case ExtensionType.MintCloseAuthority:
        case ExtensionType.MetadataPointer:
        case ExtensionType.TokenMetadata:
        case ExtensionType.Uninitialized:
        case ExtensionType.InterestBearingConfig:
        case ExtensionType.PermanentDelegate:
        case ExtensionType.NonTransferableAccount:
        case ExtensionType.TransferHookAccount:
            return ExtensionType.Uninitialized;
    }
}

function getLen(
    extensionTypes: ExtensionType[],
    baseSize: number,
    variableLengthExtensions: { [E in ExtensionType]?: number } = {}
): number {
    if (extensionTypes.length === 0 && Object.keys(variableLengthExtensions).length === 0) {
        return baseSize;
    } else {
        const accountLength =
            ACCOUNT_SIZE +
            ACCOUNT_TYPE_SIZE +
            extensionTypes
                .filter((element, i) => i === extensionTypes.indexOf(element))
                .map((element) => addTypeAndLengthToLen(getTypeLen(element)))
                .reduce((a, b) => a + b, 0) +
            Object.entries(variableLengthExtensions)
                .map(([extension, len]) => {
                    if (!isVariableLengthExtension(Number(extension))) {
                        throw Error(`Extension ${extension} is not variable length`);
                    }
                    return addTypeAndLengthToLen(len);
                })
                .reduce((a, b) => a + b, 0);
        if (accountLength === MULTISIG_SIZE) {
            return accountLength + TYPE_SIZE;
        } else {
            return accountLength;
        }
    }
}

export function getMintLen(
    extensionTypes: ExtensionType[],
    variableLengthExtensions: { [E in ExtensionType]?: number } = {}
): number {
    return getLen(extensionTypes, MINT_SIZE, variableLengthExtensions);
}

export function getAccountLen(extensionTypes: ExtensionType[]): number {
    // There are currently no variable length extensions for accounts
    return getLen(extensionTypes, ACCOUNT_SIZE);
}

export function getExtensionData(extension: ExtensionType, tlvData: Buffer): Buffer | null {
    let extensionTypeIndex = 0;
    while (addTypeAndLengthToLen(extensionTypeIndex) <= tlvData.length) {
        const entryType = tlvData.readUInt16LE(extensionTypeIndex);
        const entryLength = tlvData.readUInt16LE(extensionTypeIndex + TYPE_SIZE);
        const typeIndex = addTypeAndLengthToLen(extensionTypeIndex);
        if (entryType == extension) {
            return tlvData.slice(typeIndex, typeIndex + entryLength);
        }
        extensionTypeIndex = typeIndex + entryLength;
    }
    return null;
}

export function getExtensionTypes(tlvData: Buffer): ExtensionType[] {
    const extensionTypes: ExtensionType[] = [];
    let extensionTypeIndex = 0;
    while (extensionTypeIndex < tlvData.length) {
        const entryType = tlvData.readUInt16LE(extensionTypeIndex);
        extensionTypes.push(entryType);
        const entryLength = tlvData.readUInt16LE(extensionTypeIndex + TYPE_SIZE);
        extensionTypeIndex += addTypeAndLengthToLen(entryLength);
    }
    return extensionTypes;
}

export function getAccountLenForMint(mint: Mint): number {
    const extensionTypes = getExtensionTypes(mint.tlvData);
    const accountExtensions = extensionTypes.map(getAccountTypeOfMintType);
    return getAccountLen(accountExtensions);
}

export function getNewAccountLenForExtensionLen(
    info: AccountInfo<Buffer>,
    address: PublicKey,
    extensionType: ExtensionType,
    extensionLen: number,
    programId = TOKEN_2022_PROGRAM_ID
): number {
    const mint = unpackMint(address, info, programId);
    const extensionData = getExtensionData(extensionType, mint.tlvData);

    const currentExtensionLen = extensionData ? addTypeAndLengthToLen(extensionData.length) : 0;
    const newExtensionLen = addTypeAndLengthToLen(extensionLen);

    return info.data.length + newExtensionLen - currentExtensionLen;
}

import {

  LENGTH_SIZE,
  MetadataPointerLayout,
  TOKEN_2022_PROGRAM_ID,
  TYPE_SIZE,
  createAssociatedTokenAccount,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
  initializeMetadataPointerData,
} from "@solana/spl-token";
import { BN } from "bn.js";
import { assert } from "chai";
import { Metaplex, token } from "@metaplex-foundation/js";
import { AMM, calculateFee } from "../client";

const GLOBAL_SEED = "global";
const BONDING_CURVE_SEED = "bonding-curve";

//TODO: Unit test order is essential, need to refactor to make it so its not.

describe("curve-launchpad", () => {
  const DEFAULT_DECIMALS = 6n;
  const DEFAULT_TOKEN_BALANCE =
    1_000_000_000n * BigInt(10 ** Number(DEFAULT_DECIMALS));
  const DEFAULT_INITIAL_TOKEN_RESERVES = 793_100_000_000_000n;
  const DEFAULT_INITIAL_VIRTUAL_SOL_RESERVE = 30_000_000_000n;
  const DEFUALT_INITIAL_VIRTUAL_TOKEN_RESERVE = 1_073_000_000_000_000n;
  const DEFAULT_FEE_BASIS_POINTS = 50n;

  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.CurveLaunchpad as Program<CurveLaunchpad>;

  const connection = provider.connection;
  const authority = anchor.web3.Keypair.fromSecretKey(new Uint8Array(JSON.parse(require('fs').readFileSync('/Users/jarettdunn/koii2.json' as string).toString())))
  const tokenCreator =anchor.web3.Keypair.fromSecretKey(new Uint8Array(JSON.parse(require('fs').readFileSync(process.env.ANCHOR_WALLET as string).toString())))
  const feeRecipient = authority//anchor.web3.Keypair.generate();
  const withdrawAuthority =authority//anchor.web3.Keypair.generate();
const ata = Keypair.generate()
  const mint = new PublicKey("9vTr3QEaDk59kgwLQdfWe4zjenZBq84XimcEDGUCUktS")//anchor.web3.Keypair.generate();

  const [globalPDA] = pk.findProgramAddressSync(
    [Buffer.from(GLOBAL_SEED)],
    program.programId
  );

  const [bondingCurvePDA] = pk.findProgramAddressSync(
    [Buffer.from(BONDING_CURVE_SEED), tokenCreator.publicKey.toBuffer()],
    program.programId
  );
  const bondingCurveTokenAccount = PublicKey.findProgramAddressSync(
    [
        bondingCurvePDA.toBuffer(),
        TOKEN_2022_PROGRAM_ID.toBuffer(),
        mint.toBuffer()
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID
)[0];

  const getAmmFromBondingCurve = async () => {
    let bondingCurveAccount = await program.account.bondingCurve.fetch(
      bondingCurvePDA
    );
    return ammFromBondingCurve(
      bondingCurveAccount,
      DEFUALT_INITIAL_VIRTUAL_TOKEN_RESERVE
    );
  };

  const assertBondingCurve = (
    amm: any,
    bondingCurveAccount: any,
    complete: boolean = false
  ) => {
    assert.equal(
      bondingCurveAccount.virtualTokenReserves.toString(),
      amm.virtualTokenReserves.toString()
    );
    assert.equal(
      bondingCurveAccount.virtualSolReserves.toString(),
      amm.virtualSolReserves.toString()
    );
    assert.equal(
      bondingCurveAccount.realTokenReserves.toString(),
      amm.realTokenReserves.toString()
    );
    assert.equal(
      bondingCurveAccount.realSolReserves.toString(),
      amm.realSolReserves.toString()
    );
    assert.equal(
      bondingCurveAccount.tokenTotalSupply.toString(),
      DEFAULT_TOKEN_BALANCE.toString()
    );
    assert.equal(bondingCurveAccount.complete, complete);
  };

  function deEscalateAccountMeta(accountMeta: AccountMeta, accountMetas: AccountMeta[]): AccountMeta {
    const maybeHighestPrivileges = accountMetas
        .filter((x) => x.pubkey === accountMeta.pubkey)
        .reduce<{ isSigner: boolean; isWritable: boolean } | undefined>((acc, x) => {
            if (!acc) return { isSigner: x.isSigner, isWritable: x.isWritable };
            return { isSigner: acc.isSigner || x.isSigner, isWritable: acc.isWritable || x.isWritable };
        }, undefined);
    if (maybeHighestPrivileges) {
        const { isSigner, isWritable } = maybeHighestPrivileges;
        if (!isSigner && isSigner !== accountMeta.isSigner) {
            accountMeta.isSigner = false;
        }
        if (!isWritable && isWritable !== accountMeta.isWritable) {
            accountMeta.isWritable = false;
        }
    }
    return accountMeta;
}
  const simpleBuy = async (
    user: anchor.web3.Keypair,
    tokenAmount: bigint,
    maxSolAmount: bigint,
    innerFeeRecipient: anchor.web3.Keypair = feeRecipient
  ) => {
    const userTokenAccount = PublicKey.findProgramAddressSync(
        [
            user.publicKey.toBuffer(),
            TOKEN_2022_PROGRAM_ID.toBuffer(),
            mint.toBuffer()
        ],
        ASSOCIATED_TOKEN_PROGRAM_ID
    )[0];
    createTransferCheckedWithFeeAndTransferHookInstruction
    const userAtaMaybe = await connection.getAccountInfo(userTokenAccount)
    let preixs: any [] = []
    if (!userAtaMaybe) 
    {
      preixs.push(createAssociatedTokenAccountInstruction(
        user.publicKey,
        userTokenAccount,
        user.publicKey,
        mint,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      ))
    }
    let ix = await program.methods
      .buy(new BN(tokenAmount.toString()), new BN(maxSolAmount.toString()))
      .accounts({
        user: user.publicKey,
        mint: mint,
        // @ts-ignore
        userTokenAccount: userTokenAccount,
        // @ts-ignore
        bondingCurve: bondingCurvePDA,
        global: globalPDA,
        systemProgram: anchor.web3.SystemProgram.programId,
        feeRecipient: feeRecipient.publicKey,
        program: program.programId,bondingCurveTokenAccount,
        tokenProgram: TOKEN_2022_PROGRAM_ID
      })
      .instruction();

preixs.push(ix)
const tx = new Transaction().add(...preixs)
await provider.sendAndConfirm(tx)
    let txResults = await sendTransaction(program, tx, [user], user.publicKey);

    return {
      tx: txResults,
      userTokenAccount,
      bondingCurveTokenAccount,
      bondingCurvePDA,
    };
  };

  const simpleSell = async (
    user: anchor.web3.Keypair,
    tokenAmount: bigint,
    minSolAmount: bigint,
    innerFeeRecipient: anchor.web3.Keypair = feeRecipient
  ) => {
    const userTokenAccount = PublicKey.findProgramAddressSync(
      [
          user.publicKey.toBuffer(),
          TOKEN_2022_PROGRAM_ID.toBuffer(),
          mint.toBuffer()
      ],
      ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];

    let ix = await program.methods
      .sell(new BN(tokenAmount.toString()), new BN(minSolAmount.toString()))
      .accounts({
        user: user.publicKey,
        mint: mint,
        // @ts-ignore
        bondingCurve: bondingCurvePDA,
        global: globalPDA,
        systemProgram: anchor.web3.SystemProgram.programId,
        // @ts-ignore
        userTokenAccount: userTokenAccount,
        // @ts-ignore
        feeRecipient: feeRecipient.publicKey,
        program: program.programId,
        tokenProgram: TOKEN_2022_PROGRAM_ID,bondingCurveTokenAccount
      })
      .instruction();
      
const tx = new Transaction().add(ix)
await provider.sendAndConfirm(tx)
      await provider.sendAndConfirm(tx)

    let txResults = await sendTransaction(program, tx, [user], user.publicKey);

    return {
      tx: txResults,
      userTokenAccount,
      bondingCurveTokenAccount,
      bondingCurvePDA,
    };
  };

  before(async () => {
  });

  it("Is initialized!", async () => {
    await program.methods
      .initialize()
      .accounts({
        authority: authority.publicKey,
      })
      .signers([authority])
      .rpc();

    let global = await program.account.global.fetch(globalPDA);

    assert.equal(global.authority.toBase58(), authority.publicKey.toBase58());
    assert.equal(global.initialized, true);

    await program.methods
      .setParams(
        new BN(DEFUALT_INITIAL_VIRTUAL_TOKEN_RESERVE.toString()),
        new BN(DEFAULT_INITIAL_VIRTUAL_SOL_RESERVE.toString()),
        new BN(DEFAULT_INITIAL_TOKEN_RESERVES.toString()),
        new BN(DEFAULT_TOKEN_BALANCE.toString()),
        new BN(DEFAULT_FEE_BASIS_POINTS.toString())
      )
      .accounts({
        user: authority.publicKey,
        program: program.programId,
      })
      .signers([authority])
      .rpc();
  });

  it("can mint a token", async () => {
    
    const bondingCurveTokenAccount = PublicKey.findProgramAddressSync(
        [
            bondingCurvePDA.toBuffer(),
            TOKEN_2022_PROGRAM_ID.toBuffer(),
            mint.toBuffer()
        ],
        ASSOCIATED_TOKEN_PROGRAM_ID
    )[0];
    let name = "test";
    let symbol = "tst";
    let uri = "https://pastebin.com/raw/Me8ibY8S";
    const delegate = pk.findProgramAddressSync([Buffer.from("delegate")], program.programId)

  const metadata: TokenMetadata = {
    mint: mint,
    name,
    symbol,
    uri,
    additionalMetadata: [],
  };
  const mintLen = getMintLen([ExtensionType.TransferFeeConfig, ExtensionType.MetadataPointer]);

  const metadataLen = TYPE_SIZE+ LENGTH_SIZE + pack(metadata).length;
console.log(mintLen+metadataLen)
  const mintLamports = await connection.getMinimumBalanceForRentExemption(mintLen+metadataLen);
    
  console.log(mintLen+ metadataLen);
    const tx = await program.methods
      .create(name, symbol, uri,  { blue: {} })
      .accounts({
        mint: mint,
        creator: tokenCreator.publicKey,
        program: program.programId,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        bondingCurveTokenAccount
      })
      .preInstructions([
        SystemProgram.createAccount({
          fromPubkey: authority.publicKey,
          newAccountPubkey: mint,
          space: mintLen,
          lamports: mintLamports, 
          programId: TOKEN_2022_PROGRAM_ID,
        }),
      ])
      .transaction();

    let txResult = await provider.sendAndConfirm(tx, [mint])
    console.log(txResult)

    const tokenAmount = await connection.getTokenAccountBalance(
      bondingCurveTokenAccount
    );
    assert.equal(tokenAmount.value.amount, DEFAULT_TOKEN_BALANCE.toString());

    const createdMint = await getMint(connection, mint, "confirmed", TOKEN_2022_PROGRAM_ID);
    assert.equal(createdMint.isInitialized, true);
    assert.equal(createdMint.decimals, Number(DEFAULT_DECIMALS));
    assert.equal(createdMint.supply, DEFAULT_TOKEN_BALANCE);
    assert.equal(createdMint.mintAuthority, null);

    const metaplex = Metaplex.make(connection);
    const token = await metaplex
      .nfts()
      .findByMint({ mintAddress: mint });
    assert.equal(token.name, name);
    assert.equal(token.symbol, symbol);
    assert.equal(token.uri, uri);

    let bondingCurveTokenAccountInfo = await connection.getTokenAccountBalance(
      bondingCurveTokenAccount
    );

    assert.equal(
      bondingCurveTokenAccountInfo.value.amount,
      DEFAULT_TOKEN_BALANCE.toString()
    );

    let bondingCurveAccount = await program.account.bondingCurve.fetch(
      bondingCurvePDA
    );

    assert.equal(
      bondingCurveAccount.virtualTokenReserves.toString(),
      DEFUALT_INITIAL_VIRTUAL_TOKEN_RESERVE.toString()
    );
    assert.equal(
      bondingCurveAccount.virtualSolReserves.toString(),
      DEFAULT_INITIAL_VIRTUAL_SOL_RESERVE.toString()
    );
    assert.equal(
      bondingCurveAccount.realTokenReserves.toString(),
      DEFAULT_INITIAL_TOKEN_RESERVES.toString()
    );
    assert.equal(bondingCurveAccount.realSolReserves.toString(), "0");
    assert.equal(
      bondingCurveAccount.tokenTotalSupply.toString(),
      DEFAULT_TOKEN_BALANCE.toString()
    );
    assert.equal(bondingCurveAccount.complete, false);
    
  });

  it("can buy a token", async () => {
    let currentAMM = await getAmmFromBondingCurve();

    let buyTokenAmount = BigInt(1_000)// DEFAULT_TOKEN_BALANCE / 100n;
    let buyMaxSOLAmount = currentAMM.getBuyPrice(buyTokenAmount);
    let fee = calculateFee(buyMaxSOLAmount, Number(DEFAULT_FEE_BASIS_POINTS));
    buyMaxSOLAmount = buyMaxSOLAmount + fee;

    let buyResult = currentAMM.applyBuy(buyTokenAmount);

    let feeRecipientPreBuySOLBalance = await connection.getBalance(
      feeRecipient.publicKey
    );

    let txResult = await simpleBuy(
      tokenCreator,
      buyTokenAmount,
      buyMaxSOLAmount,
      feeRecipient
    );

    let feeRecipientPostBuySOLBalance = await connection.getBalance(
      feeRecipient.publicKey
    );
    assert.equal(
      feeRecipientPostBuySOLBalance - feeRecipientPreBuySOLBalance,
      Number(fee)
    );

    let targetCurrentSupply = (
      DEFAULT_TOKEN_BALANCE - buyTokenAmount
    ).toString();

    let tradeEvents = txResult.tx.events.filter((event) => {
      return event.name === "tradeEvent";
    });
    assert.equal(tradeEvents.length, 1);

    let tradeEvent = toEvent("tradeEvent", tradeEvents[0]);
    assert.notEqual(tradeEvent, null);
    if (tradeEvent != null) {
      assert.equal(
        tradeEvent.tokenAmount.toString(),
        buyTokenAmount.toString()
      );

      assert.equal(tradeEvent.isBuy, true);
      assert.equal(
        tradeEvent.solAmount.toString(),
        buyResult.sol_amount.toString()
      );

      assert.equal(
        tradeEvent.solAmount.toString(),
        (buyMaxSOLAmount - fee).toString()
      );
    }

    const tokenAmount = await connection.getTokenAccountBalance(
      txResult.userTokenAccount
    );
    assert.equal(tokenAmount.value.amount, buyTokenAmount.toString());

    let bondingCurveTokenAccountInfo = await connection.getTokenAccountBalance(
      txResult.bondingCurveTokenAccount
    );

    assert.equal(
      bondingCurveTokenAccountInfo.value.amount,
      targetCurrentSupply
    );

    let bondingCurveAccount = await program.account.bondingCurve.fetch(
      bondingCurvePDA
    );

    assertBondingCurve(currentAMM, bondingCurveAccount);
  });

  it("can sell a token", async () => {
    let currentAMM = await getAmmFromBondingCurve();

    let tokenAmount = 1000n;
    let minSolAmount = currentAMM.getSellPrice(tokenAmount);
    let fee = calculateFee(minSolAmount, Number(DEFAULT_FEE_BASIS_POINTS));
    minSolAmount = minSolAmount - fee;

    let sellResults = currentAMM.applySell(tokenAmount);

    let userPreSaleBalance = await getSPLBalance(
      connection,
      mint,
      tokenCreator.publicKey
    );

    let curvePreSaleBalance = await getSPLBalance(
      connection,
      mint,
      bondingCurvePDA,
      true
    );

    let feeRecipientPreBuySOLBalance = await connection.getBalance(
      feeRecipient.publicKey
    );

    let txResult = await simpleSell(tokenCreator, tokenAmount, minSolAmount, feeRecipient);

    let feeRecipientPostBuySOLBalance = await connection.getBalance(
      feeRecipient.publicKey
    );
    assert.equal(
      feeRecipientPostBuySOLBalance - feeRecipientPreBuySOLBalance,
      Number(fee)
    );

    let tradeEvents = txResult.tx.events.filter((event) => {
      return event.name === "tradeEvent";
    });

    let userPostSaleBalance = await getSPLBalance(
      connection,
      mint,
      tokenCreator.publicKey
    );

    assert.equal(
      userPostSaleBalance,
      (BigInt(userPreSaleBalance) - tokenAmount).toString()
    );
    assert.equal(tradeEvents.length, 1);

    let tradeEvent = toEvent("tradeEvent", tradeEvents[0]);
    assert.notEqual(tradeEvent, null);
    if (tradeEvent != null) {
      assert.equal(tradeEvent.tokenAmount.toString(), tokenAmount.toString());
      assert.equal(tradeEvent.isBuy, false);
      assert.equal(
        tradeEvent.solAmount.toString(),
        sellResults.sol_amount.toString()
      );
    }

    let curvePostSaleBalance = await getSPLBalance(
      connection,
      mint,
      bondingCurvePDA,
      true
    );

    assert.equal(
      curvePostSaleBalance,
      (BigInt(curvePreSaleBalance) + tokenAmount).toString()
    );

    let bondingCurveAccount = await program.account.bondingCurve.fetch(
      bondingCurvePDA
    );
    assertBondingCurve(currentAMM, bondingCurveAccount);
  });

  //excpetion unit tests
  it("can't withdraw as curve is incomplete", async () => {
    let errorCode = "";

    try {
      let tx = await program.methods
        .withdraw()
        .accounts({
          user: withdrawAuthority.publicKey,
          mint: mint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          bondingCurveTokenAccount
        })
        .transaction();

        await provider.sendAndConfirm(tx)
      await sendTransaction(
        program,
        tx,
        [withdrawAuthority],
        withdrawAuthority.publicKey
      );
    } catch (err) {
      let anchorError = getAnchorError(err);
      if (anchorError) {
        errorCode = anchorError.error.errorCode.code;
      }
    }
    assert.equal(errorCode, "BondingCurveNotComplete");
  });

  it("can't buy a token, not enough SOL", async () => {
    const notEnoughSolUser = anchor.web3.Keypair.generate();

    await fundAccountSOL(
      connection,
      notEnoughSolUser.publicKey,
      0.021 * LAMPORTS_PER_SOL
    );

    let errorCode = "";
    try {
      await simpleBuy(
        notEnoughSolUser,
        5_000_000_000_000n,
        BigInt(5 * LAMPORTS_PER_SOL),
        feeRecipient
      );
    } catch (err) {
      let anchorError = getAnchorError(err);
      if (anchorError) {
        errorCode = anchorError.error.errorCode.code;
      }
    }
    assert.equal(errorCode, "InsufficientSOL");
  });

  it("can't buy a token, exceed max sol", async () => {
    let errorCode = "";
    try {
      await simpleBuy(tokenCreator, DEFAULT_TOKEN_BALANCE / 100n, 1n, feeRecipient);
    } catch (err) {
      let anchorError = getAnchorError(err);
      if (anchorError) {
        errorCode = anchorError.error.errorCode.code;
      }
    }
    assert.equal(errorCode, "MaxSOLCostExceeded");
  });

  it("can't buy 0 tokens", async () => {
    let errorCode = "";
    try {
      await simpleBuy(tokenCreator, 0n, 1n, feeRecipient);
    } catch (err) {
      let anchorError = getAnchorError(err);
      if (anchorError) {
        errorCode = anchorError.error.errorCode.code;
      }
    }
    assert.equal(errorCode, "MinBuy");
  });

  it("can't sell a token, not enough tokens", async () => {
    let errorCode = "";
    try {
      await simpleSell(tokenCreator, DEFAULT_TOKEN_BALANCE, 0n, feeRecipient);
    } catch (err) {
      let anchorError = getAnchorError(err);
      if (anchorError) {
        errorCode = anchorError.error.errorCode.code;
      }
    }
    assert.equal(errorCode, "InsufficientTokens");
  });

  it("can't sell 0 tokens", async () => {
    let errorCode = "";
    try {
      await simpleSell(tokenCreator, 0n, 0n, feeRecipient);
    } catch (err) {
      let anchorError = getAnchorError(err);
      if (anchorError) {
        errorCode = anchorError.error.errorCode.code;
      }
    }
    assert.equal(errorCode, "MinSell");
  });

  it("can't sell a token, exceed mint sol sell", async () => {
    let errorCode = "";
    try {
      await simpleSell(tokenCreator, 1n, DEFAULT_TOKEN_BALANCE, feeRecipient);
    } catch (err) {
      let anchorError = getAnchorError(err);
      if (anchorError) {
        errorCode = anchorError.error.errorCode.code;
      }
    }
    assert.equal(errorCode, "MinSOLOutputExceeded");
  });

  //curve complete unit tests
  it("can complete the curve", async () => {
    let currentAMM = await getAmmFromBondingCurve();
    let buyTokenAmount = currentAMM.realTokenReserves;
    let maxSolAmount = currentAMM.getBuyPrice(buyTokenAmount);

    maxSolAmount =
      maxSolAmount +
      calculateFee(maxSolAmount, Number(DEFAULT_FEE_BASIS_POINTS));
    let buyResult = currentAMM.applyBuy(buyTokenAmount);

    let userPrePurchaseBalance = await getSPLBalance(
      connection,
      mint,
      tokenCreator.publicKey
    );

    let txResult = await simpleBuy(tokenCreator, buyTokenAmount, maxSolAmount, feeRecipient);

    let tradeEvents = txResult.tx.events.filter((event) => {
      return event.name === "tradeEvent";
    });
    assert.equal(tradeEvents.length, 1);

    let tradeEvent = toEvent("tradeEvent", tradeEvents[0]);
    assert.notEqual(tradeEvent, null);
    if (tradeEvent != null) {
      assert.equal(tradeEvent.isBuy, true);
      assert.equal(
        tradeEvent.solAmount.toString(),
        buyResult.sol_amount.toString()
      );
    }

    let userPostPurchaseBalance = await getSPLBalance(
      connection,
      mint,
      tokenCreator.publicKey
    );

    assert.equal(
      userPostPurchaseBalance,
      (BigInt(userPrePurchaseBalance) + buyTokenAmount).toString()
    );

    let bondingCurveTokenAccountInfo = await connection.getTokenAccountBalance(
      txResult.bondingCurveTokenAccount
    );

    assert.equal(
      (
        BigInt(bondingCurveTokenAccountInfo.value.amount) +
        DEFAULT_INITIAL_TOKEN_RESERVES
      ).toString(),
      DEFAULT_TOKEN_BALANCE.toString()
    );

    let bondingCurveAccount = await program.account.bondingCurve.fetch(
      bondingCurvePDA
    );

    assertBondingCurve(currentAMM, bondingCurveAccount, true);
  });

  it("can't buy a token, curve complete", async () => {
    let currentAMM = await getAmmFromBondingCurve();

    let buyTokenAmount = 100n;
    let maxSolAmount = currentAMM.getBuyPrice(buyTokenAmount);

    let errorCode = "";
    try {
      await simpleBuy(tokenCreator, buyTokenAmount, maxSolAmount, feeRecipient);
    } catch (err) {
      let anchorError = getAnchorError(err);
      if (anchorError) {
        errorCode = anchorError.error.errorCode.code;
      }
    }
    assert.equal(errorCode, "BondingCurveComplete");
  });

  it("can't sell a token, curve complete", async () => {
    let tokenAmount = 100n;
    let minSolAmount = 0n;

    let errorCode = "";
    try {
      await simpleSell(tokenCreator, tokenAmount, minSolAmount, feeRecipient);
    } catch (err) {
      let anchorError = getAnchorError(err);
      if (anchorError) {
        errorCode = anchorError.error.errorCode.code;
      }
    }
    assert.equal(errorCode, "BondingCurveComplete");
  });

  it("can't withdraw as incorrect authority", async () => {
    let errorCode = "";

    try {
      let tx = await program.methods
        .withdraw()
        .accounts({
          user: tokenCreator.publicKey,
          mint: mint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          bondingCurveTokenAccount
        })
        .transaction();

        await provider.sendAndConfirm(tx)
      await sendTransaction(
        program,
        tx,
        [tokenCreator],
        tokenCreator.publicKey
      );
    } catch (err) {
      let anchorError = getAnchorError(err);
      if (anchorError) {
        errorCode = anchorError.error.errorCode.code;
      }
    }
    assert.equal(errorCode, "InvalidWithdrawAuthority");
  });

  //it can withdraw
  it("can withdraw", async () => {
    let withdrawAuthorityPreSOLBalance = await connection.getBalance(
      feeRecipient.publicKey
    );
    let bondingCurvePreSOLBalance = await connection.getBalance(
      bondingCurvePDA
    );

    let bondingCurvePreSPLBalance = await getSPLBalance(
      connection,
      mint,
      bondingCurvePDA,
      true
    );

    let tx = await program.methods
      .withdraw()
      .accounts({
        user: withdrawAuthority.publicKey,
        mint: mint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        bondingCurveTokenAccount
      })
      .transaction();

      await provider.sendAndConfirm(tx)
    await sendTransaction(
      program,
      tx,
      [withdrawAuthority],
      withdrawAuthority.publicKey
    );

    let minBalanceRentExempt =
      await connection.getMinimumBalanceForRentExemption(8 + 41);
    let bondingCurvePostSOLBalance = await connection.getBalance(
      bondingCurvePDA
    );

    //confirm PDA only remaining balance is rent exempt
    assert.equal(bondingCurvePostSOLBalance, minBalanceRentExempt);


    //check if there is more SOL in withdraw authority then the bonding curve pre transfer
    //TODO: Calculate the correct amount of SOL that should be in the withdraw authority
    let withdrawAuthorityPostSOLBalance = await connection.getBalance(
      withdrawAuthority.publicKey
    );
    let withdrawAuthorityBalanceDiff =
      withdrawAuthorityPostSOLBalance - withdrawAuthorityPreSOLBalance;

    let hasBalanceRisenMoreThenCurve =
      withdrawAuthorityBalanceDiff - minBalanceRentExempt >
      bondingCurvePreSOLBalance - minBalanceRentExempt;

    assert.isTrue(hasBalanceRisenMoreThenCurve);

    let withdrawAuthorityPostSPLBalance = await getSPLBalance(
      connection,
      mint,
      withdrawAuthority.publicKey
    );

    let bondingCurvePostSPLBalance = await getSPLBalance(
      connection,
      mint,
      bondingCurvePDA,
      true
    );

    assert.equal(withdrawAuthorityPostSPLBalance, bondingCurvePreSPLBalance);
    assert.equal(bondingCurvePostSPLBalance, "0");

    let bondingCurveAccount = await program.account.bondingCurve.fetch(
      bondingCurvePDA
    );

    //confirm PDA has enough rent
    assert.notEqual(bondingCurveAccount, null);
  });

  //param unit tests
  it("can set params", async () => {
    let tx = await program.methods
      .setParams(
        new BN(DEFUALT_INITIAL_VIRTUAL_TOKEN_RESERVE.toString()),
        new BN(DEFAULT_INITIAL_VIRTUAL_SOL_RESERVE.toString()),
        new BN(DEFAULT_INITIAL_TOKEN_RESERVES.toString()),
        new BN(DEFAULT_TOKEN_BALANCE.toString()),
        new BN(DEFAULT_FEE_BASIS_POINTS.toString())
      )
      .accounts({
        user: authority.publicKey,
        program: program.programId,
      })
      .transaction();
      await provider.sendAndConfirm(tx)

    let txResult = await sendTransaction(
      program,
      tx,
      [authority],
      authority.publicKey
    );

    let global = await program.account.global.fetch(globalPDA);

    let setParamsEvents = txResult.events.filter((event) => {
      return event.name === "setParamsEvent";
    });

    assert.equal(setParamsEvents.length, 1);

    let setParamsEvent = toEvent("setParamsEvent", setParamsEvents[0]);
    assert.notEqual(setParamsEvent, null);
    if (setParamsEvent != null) {
      assert.equal(
        setParamsEvent.feeRecipient.toBase58(),
        feeRecipient.publicKey.toBase58()
      );
      assert.equal(
        setParamsEvent.withdrawAuthority.toBase58(),
        withdrawAuthority.publicKey.toBase58()
      );
      assert.equal(
        setParamsEvent.initialVirtualTokenReserves.toString(),
        new BN(1000).toString()
      );
      assert.equal(
        setParamsEvent.initialVirtualSolReserves.toString(),
        new BN(2000).toString()
      );
      assert.equal(
        setParamsEvent.initialRealTokenReserves.toString(),
        new BN(3000).toString()
      );
      assert.equal(
        setParamsEvent.initialTokenSupply.toString(),
        new BN(4000).toString()
      );
      assert.equal(
        setParamsEvent.feeBasisPoints.toString(),
        new BN(100).toString()
      );
    }

    assert.equal(
      global.feeRecipient.toBase58(),
      feeRecipient.publicKey.toBase58()
    );
    assert.equal(
      global.withdrawAuthority.toBase58(),
      withdrawAuthority.publicKey.toBase58()
    );
    assert.equal(
      global.initialVirtualTokenReserves.toString(),
      new BN(1000).toString()
    );
    assert.equal(
      global.initialVirtualSolReserves.toString(),
      new BN(2000).toString()
    );
    assert.equal(
      global.initialRealTokenReserves.toString(),
      new BN(3000).toString()
    );
    assert.equal(global.initialTokenSupply.toString(), new BN(4000).toString());
    assert.equal(global.feeBasisPoints.toString(), new BN(100).toString());
  });

  it("can't set params as non-authority", async () => {
    let errorCode = "";
    try {
      const randomFeeRecipient = anchor.web3.Keypair.generate();
      const randomWithdrawAuthority = anchor.web3.Keypair.generate();

      await program.methods
        .setParams(
          
        new BN(DEFUALT_INITIAL_VIRTUAL_TOKEN_RESERVE.toString()),
        new BN(DEFAULT_INITIAL_VIRTUAL_SOL_RESERVE.toString()),
        new BN(DEFAULT_INITIAL_TOKEN_RESERVES.toString()),
        new BN(DEFAULT_TOKEN_BALANCE.toString()),
        new BN(DEFAULT_FEE_BASIS_POINTS.toString())
        )
        .accounts({
          user: tokenCreator.publicKey,
          program: program.programId,
        })
        .signers([tokenCreator])
        .rpc();
    } catch (err) {
      let anchorError = getAnchorError(err);
      if (anchorError) {
        errorCode = anchorError.error.errorCode.code;
      }
    }
    assert.equal(errorCode, "InvalidAuthority");
  });
});

//TODO: Tests
// test sell whole curve
