import {
  clusterApiUrl,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import {
  createInitializeMetadataPointerInstruction,
  createInitializeMintInstruction,
  ExtensionType,
  getMintLen,
  LENGTH_SIZE,
  TOKEN_2022_PROGRAM_ID,
  TYPE_SIZE,
} from '@solana/spl-token';
import { createInitializeInstruction, pack, TokenMetadata } from '@solana/spl-token-metadata';

(async () => {
  const payer = Keypair.generate();

  const mint = Keypair.generate();
  const decimals = 9;

  const metadata: TokenMetadata = {
    mint: mint.publicKey,
    name: ' '.repeat(8),
    symbol: ' '.repeat(8),
    uri: ' '.repeat(16),
    additionalMetadata: [],
  };

  const mintLen = getMintLen([ExtensionType.MetadataPointer, ExtensionType.TransferFeeConfig, ExtensionType.TransferHook]);

  const metadataLen = TYPE_SIZE + LENGTH_SIZE + pack(metadata).length;

  console.log(mintLen+ metadataLen);
})();