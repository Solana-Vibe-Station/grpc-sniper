// helpers.ts
import { PublicKey } from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  MintLayout,
} from '@solana/spl-token';
import { TransactionMessage, VersionedTransaction, LAMPORTS_PER_SOL, SystemProgram } from '@solana/web3.js';
import { logger } from '../utils/logger';
import { solanaConnection, wallet } from '../transaction/transaction';
import { AMOUNT_TO_WSOL, COMMITMENT_LEVEL } from '../constants';
import { Token } from '@raydium-io/raydium-sdk';

// Helper function to create and fund WSOL account with improved performance
export async function createAndFundWSOL(wsolAta: PublicKey): Promise<void> {
  try {
    const latestBlockhashPromise = solanaConnection.getLatestBlockhash();

    const instructions = [
      createAssociatedTokenAccountIdempotentInstruction(
        wallet.publicKey,
        wsolAta,
        wallet.publicKey,
        Token.WSOL.mint
      ),
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: wsolAta,
        lamports: AMOUNT_TO_WSOL * LAMPORTS_PER_SOL,
      }),
      createSyncNativeInstruction(wsolAta), // Sync native to wrap SOL into WSOL
    ];

    // Fetch the latest blockhash
    const latestBlockhash = await latestBlockhashPromise;
    logger.info('Fetched latest blockhash for transaction.');

    const message = new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: instructions,
    }).compileToV0Message();

    const versionedTransaction = new VersionedTransaction(message);
    versionedTransaction.sign([wallet]);

    // Send transaction with preflight skipped
    const signature = await solanaConnection.sendRawTransaction(versionedTransaction.serialize(), {
      skipPreflight: true,
      preflightCommitment: COMMITMENT_LEVEL,
    });

    const confirmationStrategy = {
      signature,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    };

    // Confirm the transaction
    await solanaConnection.confirmTransaction(confirmationStrategy, COMMITMENT_LEVEL);
    logger.info(`Created and funded WSOL account with ${AMOUNT_TO_WSOL} SOL. Transaction signature: ${signature}`);
  } catch (error) {
    logger.error(`Failed to create and fund WSOL account: ${error}`);
    throw error;
  }
}

// Helper function to check if mint and freeze authority exist
export async function checkAuthority(
  mintAddress: PublicKey
): Promise<{ mintAuthority: PublicKey | null; freezeAuthorityExists: boolean }> {
  try {
    const mintAccountInfo = await solanaConnection.getAccountInfo(mintAddress);

    if (mintAccountInfo?.data) {
      const mintData = MintLayout.decode(mintAccountInfo.data);
      const mintAuthority = mintData.mintAuthorityOption ? new PublicKey(mintData.mintAuthority) : null;
      const freezeAuthorityExists = !!mintData.freezeAuthorityOption;

      return { mintAuthority, freezeAuthorityExists };
    }
    
    logger.warn(`Mint account data not found for address: ${mintAddress.toBase58()}`);
    return { mintAuthority: null, freezeAuthorityExists: false };

  } catch (error) {
    logger.error(`Failed to fetch mint authority info for ${mintAddress.toBase58()}: ${error}`);
    throw error;
  }
}
