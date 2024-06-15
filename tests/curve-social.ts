import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CurveSocial } from "../target/types/curve_social";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { getTxDetails } from "./util";
import {
  getAssociatedTokenAddress,
  getAssociatedTokenAddressSync,
  getMint,
  getOrCreateAssociatedTokenAccount,
  getTokenMetadata,
} from "@solana/spl-token";
import { BN } from "bn.js";
import { assert } from "chai";
import { Metaplex } from "@metaplex-foundation/js";

const GLOBAL_SEED = "global";
const METADATA_SEED = "metadata";
const MINT_AUTHORITY_SEED = "mint-authority";
const BONDING_CURVE_SEED = "bonding-curve";
const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

import IDL from "../target/idl/curve_social.json";

describe("curve-social", () => {
  const DEFAULT_DECIMALS = 6n;
  const DEFAULT_TOKEN_BALANCE = 1_000_000_0000n * BigInt(10 ** Number(DEFAULT_DECIMALS));

  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  let newProgram = new Program<CurveSocial>(IDL as any);

  //newProgram.account.

  const program = anchor.workspace.CurveSocial as Program<CurveSocial>;

  const connection = provider.connection;
  const authority = anchor.web3.Keypair.generate();
  const tokenCreator = anchor.web3.Keypair.generate();

  const mint = anchor.web3.Keypair.generate();

  const [globalPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from(GLOBAL_SEED)],
    program.programId
  );

  const [mintAuthorityPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from(MINT_AUTHORITY_SEED)],
    program.programId
  );

  before(async () => {
    let fundSig = await connection.requestAirdrop(
      authority.publicKey,
      5 * LAMPORTS_PER_SOL
    );

    await getTxDetails(connection, fundSig);

    let fundSigtokenCreator = await connection.requestAirdrop(
      tokenCreator.publicKey,
      90 * LAMPORTS_PER_SOL
    );

    await getTxDetails(connection, fundSigtokenCreator);
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
  });

  it("can mint a token", async () => {
    const [metadataPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from(METADATA_SEED),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        mint.publicKey.toBuffer(),
      ],
      TOKEN_METADATA_PROGRAM_ID
    );

    const [bondingCurvePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from(BONDING_CURVE_SEED), mint.publicKey.toBuffer()],
      program.programId
    );

    const bondingCurveTokenAccount = await getAssociatedTokenAddress(
      mint.publicKey,
      bondingCurvePDA,
      true
    );

    let name = "test";
    let symbol = "tst";
    let uri = "https://www.test.com";

    await program.methods
      .create(name, symbol, uri)
      .accounts({
        mint: mint.publicKey,
        creator: tokenCreator.publicKey,
        bondingCurveTokenAccount: bondingCurveTokenAccount,
        metadata: metadataPDA,
        program: program.programId,
      })
      .signers([mint, tokenCreator])
      .rpc();

    const tokenAmount = await connection.getTokenAccountBalance(
      bondingCurveTokenAccount
    );
    assert.equal(tokenAmount.value.amount, DEFAULT_TOKEN_BALANCE.toString());

    const createdMint = await getMint(connection, mint.publicKey);
    assert.equal(createdMint.isInitialized, true);
    assert.equal(createdMint.decimals, Number(DEFAULT_DECIMALS));
    assert.equal(createdMint.supply, DEFAULT_TOKEN_BALANCE);
    assert.equal(createdMint.mintAuthority, null);

    const metaplex = Metaplex.make(connection);
    const token = await metaplex
      .nfts()
      .findByMint({ mintAddress: mint.publicKey });
    assert.equal(token.name, name);
    assert.equal(token.symbol, symbol);
    assert.equal(token.uri, uri);
  });

  it("can buy a token", async () => {
    const [bondingCurvePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from(BONDING_CURVE_SEED), mint.publicKey.toBuffer()],
      program.programId
    );

    const bondingCurveTokenAccount = await getAssociatedTokenAddressSync(
      mint.publicKey,
      bondingCurvePDA,
      true
    );

    const userTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      tokenCreator,
      mint.publicKey,
      tokenCreator.publicKey
    );
  
    let buySOLAmount = new BN(1 * LAMPORTS_PER_SOL);
    let buyTokenAmount = new BN(32442896181016);
    
    await program.methods
      .buy(new BN(buyTokenAmount), new BN(buySOLAmount))
      .accounts({
        user: tokenCreator.publicKey,
        mint: mint.publicKey,
        bondingCurveTokenAccount: bondingCurveTokenAccount,
        userTokenAccount: userTokenAccount.address,
      })
      .signers([tokenCreator])
      .rpc();
  });

  it("can sell a token", async () => {
    const [bondingCurvePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from(BONDING_CURVE_SEED), mint.publicKey.toBuffer()],
      program.programId
    );

    const bondingCurveTokenAccount = await getAssociatedTokenAddress(
      mint.publicKey,
      bondingCurvePDA,
      true
    );

    const userTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      tokenCreator,
      mint.publicKey,
      tokenCreator.publicKey
    );

    await program.methods
      .sell(new BN(1000), new BN(1))
      .accounts({
        user: tokenCreator.publicKey,
        mint: mint.publicKey,
        bondingCurveTokenAccount: bondingCurveTokenAccount,
        userTokenAccount: userTokenAccount.address,
      })
      .signers([tokenCreator])
      .rpc();
  });

  it("can set params", async () => {
    await program.methods
      .setParams(
        TOKEN_METADATA_PROGRAM_ID,
        new BN(1000),
        new BN(2000),
        new BN(3000),
        new BN(4000),
        new BN(100)
      )
      .accounts({
        user: authority.publicKey,
      })
      .signers([authority])
      .rpc();

    let global = await program.account.global.fetch(globalPDA);

    assert.equal(
      global.feeRecipient.toBase58(),
      TOKEN_METADATA_PROGRAM_ID.toBase58()
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
});
