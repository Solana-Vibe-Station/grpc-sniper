import { Liquidity, LiquidityPoolKeysV4, LiquidityStateV4, Token, TokenAmount, Percent } from '@raydium-io/raydium-sdk';
import { ComputeBudgetProgram, Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction, createSyncNativeInstruction, getAccount, getAssociatedTokenAddressSync, MintLayout, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import bs58 from 'bs58';
import { logger } from '../utils/logger';
import { COMMITMENT_LEVEL, LOG_LEVEL, PRIVATE_KEY, QUOTE_AMOUNT, QUOTE_MINT, RPC_ENDPOINT, RPC_WEBSOCKET_ENDPOINT } from "../constants";
import { createPoolKeys, getTokenAccounts } from "../liquidity";
import { MinimalMarketLayoutV3 } from '../market';

let wallet: Keypair;
let quoteToken: Token;
let quoteTokenAssociatedAddress: PublicKey;
let quoteAmount: TokenAmount;

wallet = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
quoteAmount = new TokenAmount(Token.WSOL, QUOTE_AMOUNT, false);

export interface MinimalTokenAccountData {
  mint: PublicKey;
  address: PublicKey;
  poolKeys?: LiquidityPoolKeysV4;
  market?: LiquidityStateV4;
};

const existingTokenAccounts: Map<string, MinimalTokenAccountData> = new Map<string, MinimalTokenAccountData>();

const solanaConnection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
});

// Constants
const AMOUNT_TO_WSOL = parseFloat(process.env.AMOUNT_TO_WSOL || '0.005');
const AUTO_SELL = process.env.AUTO_SELL === 'true';
const SELL_TIMER = parseInt(process.env.SELL_TIMER || '10000', 10);
const MAX_RETRY = parseInt(process.env.MAX_RETRY || '10', 10);
const SLIPPAGE = parseFloat(process.env.SLIPPAGE || '0.005');

// Init Function
export async function init(): Promise<void> {
  logger.level = LOG_LEVEL;

  // Get wallet
  wallet = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
  logger.info(`Wallet Address: ${wallet.publicKey}`);

  // Handle quote token based on QUOTE_MINT (WSOL or USDC)
  switch (QUOTE_MINT) {
    case 'WSOL': {
      quoteToken = Token.WSOL;
      quoteAmount = new TokenAmount(Token.WSOL, QUOTE_AMOUNT, false);
      logger.info('Quote token is WSOL');
      break;
    }
    case 'USDC': {
      quoteToken = new Token(
        TOKEN_PROGRAM_ID,
        new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
        6,
        'USDC',
        'USDC',
      );
      quoteAmount = new TokenAmount(quoteToken, QUOTE_AMOUNT, false);
      logger.info('Quote token is USDC');
      break;
    }
    default: {
      throw new Error(`Unsupported quote mint "${QUOTE_MINT}". Supported values are USDC and WSOL`);
    }
  }

  logger.info(
    `Script will buy all new tokens using ${QUOTE_MINT}. Amount that will be used to buy each token is: ${quoteAmount.toFixed().toString()}`
  );

  // Display AUTO_SELL & SELL_TIMER
  logger.info(`AUTO_SELL: ${AUTO_SELL}`);
  logger.info(`SELL_TIMER: ${SELL_TIMER}`);
  logger.info(`SLIPPAGE: ${SLIPPAGE}`);
  logger.info(`AMOUNT_TO_WSOL: ${AMOUNT_TO_WSOL}`);
  logger.info(`MAX_RETRY: ${MAX_RETRY}`);
  logger.info(`FREEZE_AUTHORITY: ${process.env.FREEZE_AUTHORITY}`);

  // Check existing wallet for associated token account of quote mint
  const tokenAccounts = await getTokenAccounts(solanaConnection, wallet.publicKey, COMMITMENT_LEVEL);
  logger.info('Fetched token accounts from wallet.');

  // Create WSOL ATA and fund it with SOL during initialization
  if (QUOTE_MINT === 'WSOL') {
    const wsolAta = getAssociatedTokenAddressSync(Token.WSOL.mint, wallet.publicKey);
    logger.info(`WSOL ATA: ${wsolAta.toString()}`);

    // Check if WSOL account exists in wallet
    const solAccount = tokenAccounts.find(
      (acc) => acc.accountInfo.mint.toString() === Token.WSOL.mint.toString()
    );

    if (!solAccount) {
      logger.info(`No WSOL token account found. Creating and funding with ` + `${AMOUNT_TO_WSOL} SOL...`);

      // Create WSOL (wrapped SOL) account and fund it with SOL
      await createAndFundWSOL(wsolAta);
    } else {
      logger.info('WSOL account already exists in the wallet.');

      // Fetch the WSOL account balance
      const wsolAccountInfo = await getAccount(solanaConnection, wsolAta);
      const wsolBalance = Number(wsolAccountInfo.amount) / LAMPORTS_PER_SOL;
      logger.info(`Current WSOL balance: ${wsolBalance} WSOL`);

      // If WSOL balance is less than AMOUNT_TO_WSOL, top up the WSOL account
      if (wsolBalance < AMOUNT_TO_WSOL) {
        logger.info(`Insufficient WSOL balance. Funding with additional ` + `${AMOUNT_TO_WSOL} +  SOL...`);
        await createAndFundWSOL(wsolAta);
      }
    }

    // Set the quote token associated address
    quoteTokenAssociatedAddress = wsolAta;
  } else {
    const tokenAccount = tokenAccounts.find(
      (acc) => acc.accountInfo.mint.toString() === quoteToken.mint.toString()
    );

    if (!tokenAccount) {
      throw new Error(`No ${quoteToken.symbol} token account found in wallet: ${wallet.publicKey}`);
    }

    quoteTokenAssociatedAddress = tokenAccount.pubkey;
  }
}

// Helper function to create and fund WSOL account
async function createAndFundWSOL(wsolAta: PublicKey): Promise<void> {
  // Create WSOL (wrapped SOL) account and fund it
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

  // Prepare message and versioned transaction
  const latestBlockhash = await solanaConnection.getLatestBlockhash();
  logger.info('Fetched latest blockhash for transaction.');

  const message = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: latestBlockhash.blockhash,
    instructions: instructions,
  }).compileToV0Message();

  const versionedTransaction = new VersionedTransaction(message);

  // Sign the transaction
  versionedTransaction.sign([wallet]);

  // Send the serialized transaction using sendRawTransaction
  const signature = await solanaConnection.sendRawTransaction(versionedTransaction.serialize(), {
    skipPreflight: false,
    preflightCommitment: COMMITMENT_LEVEL,
  });

  // Confirm transaction with the new `TransactionConfirmationStrategy`
  const confirmationStrategy = {
    signature,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  };

  await solanaConnection.confirmTransaction(confirmationStrategy, COMMITMENT_LEVEL);
  logger.info(`Created and funded WSOL account with ` + AMOUNT_TO_WSOL + ` SOL. Transaction signature: ${signature}`);
}


// Helper function to check if freeze authority exists
async function checkFreezeAuthority(mintAddress: PublicKey): Promise<boolean> {
  const mintAccountInfo = await solanaConnection.getAccountInfo(mintAddress);
  if (mintAccountInfo && mintAccountInfo.data) {
    const mintData = MintLayout.decode(mintAccountInfo.data);
    return mintData.freezeAuthorityOption !== 0;
  }
  return false;
}

// Buy Function with Conditional Freeze Authority Check
export async function buy(
  latestBlockhash: string,
  newTokenAccount: PublicKey,
  poolState: LiquidityStateV4,
  minimalMarketLayoutV3: MinimalMarketLayoutV3
): Promise<void> {
  try {
    const mintAddress = poolState.baseMint;
    const shouldCheckFreezeAuthority = process.env.FREEZE_AUTHORITY === 'true';

    if (shouldCheckFreezeAuthority) {
      const freezeAuthorityExists = await checkFreezeAuthority(mintAddress);
      // Skip buying if freeze authority exists
      if (freezeAuthorityExists) {
        logger.info(`Freeze authority exists for token mint: ${mintAddress.toString()} Skipping buy.`);
        return; 
      }

      logger.info(`No freeze authority for token mint: ${mintAddress.toString()} Proceeding to buy.`);
    } else {
      logger.info(`FREEZE_AUTHORITY is disabled. Skipping freeze authority check and proceeding to buy.`);
    }

    const ata = getAssociatedTokenAddressSync(mintAddress, wallet.publicKey);
    const poolKeys = createPoolKeys(newTokenAccount, poolState, minimalMarketLayoutV3);

    const { innerTransaction } = Liquidity.makeSwapFixedInInstruction(
      {
        poolKeys: poolKeys,
        userKeys: {
          tokenAccountIn: quoteTokenAssociatedAddress,
          tokenAccountOut: ata,
          owner: wallet.publicKey,
        },
        amountIn: quoteAmount.raw,
        minAmountOut: 0,
      },
      poolKeys.version,
    );

    const messageV0 = new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: latestBlockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 }),
        ComputeBudgetProgram.setComputeUnitLimit({ units: 60000 }),
        createAssociatedTokenAccountIdempotentInstruction(
          wallet.publicKey,
          ata,
          wallet.publicKey,
          mintAddress,
        ),
        ...innerTransaction.instructions,
      ],
    }).compileToV0Message();

    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([wallet, ...innerTransaction.signers]);

    const signature = await solanaConnection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: true,
    });

    logger.info(`Buy transaction completed with signature - ${signature}`);

    // Auto-sell logic
    if (AUTO_SELL) {
      logger.info(`AUTO_SELL is enabled, triggering sell in ${SELL_TIMER} milliseconds...`);
      setTimeout(async () => {
        await sell(wallet.publicKey, { mint: mintAddress, address: ata }, poolState, poolKeys);
      }, SELL_TIMER);
    }

  } catch (error) {
    logger.error(error);
  }
}

export const sell = async (
  accountId: PublicKey,
  rawAccount: MinimalTokenAccountData,
  poolState: LiquidityStateV4,
  poolKeys: LiquidityPoolKeysV4
): Promise<void> => {
  logger.info(`Sell function triggered for account: ${accountId.toString()}`); 

  try {
    logger.info({ mint: rawAccount.mint }, `Processing sell for token...`);

    // Get the associated token account for the mint
    let ata: PublicKey;
    let tokenAccountInfo: any;
    const maxRetries = MAX_RETRY;
    const delayBetweenRetries = 2000; // 2 seconds delay between retries

    ata = getAssociatedTokenAddressSync(rawAccount.mint, wallet.publicKey);

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        tokenAccountInfo = await getAccount(solanaConnection, ata);
        break; // Break the loop if fetching the account was successful
      } catch (error) {
        if (error instanceof Error && error.name === 'TokenAccountNotFoundError') {
          logger.info(`Attempt ${attempt + 1}/${maxRetries}: Associated token account not found, retrying...`);
          if (attempt === maxRetries - 1) {
            logger.error(`Max retries reached. Failed to fetch the token account.`);
            throw error;
          }
           // Wait before retrying
          await new Promise((resolve) => setTimeout(resolve, delayBetweenRetries));
        } else if (error instanceof Error) {
          logger.error(`Unexpected error while fetching token account: ${error.message}`);
          throw error;
        } else {
          logger.error(`An unknown error occurred: ${String(error)}`);
          throw error;
        }
      }
    }

    // If tokenAccountInfo is still undefined after retries, create the associated token account
    if (!tokenAccountInfo) {
      logger.info(`Creating associated token account for mint: ${rawAccount.mint.toString()}...`);
      const transaction = new TransactionMessage({
        payerKey: wallet.publicKey,
        recentBlockhash: (await solanaConnection.getLatestBlockhash()).blockhash,
        instructions: [
          createAssociatedTokenAccountIdempotentInstruction(
            wallet.publicKey,
            ata,
            wallet.publicKey,
            rawAccount.mint,
          ),
        ],
      }).compileToV0Message();

      const createAtaTx = new VersionedTransaction(transaction);
      createAtaTx.sign([wallet]);

      const signature = await solanaConnection.sendRawTransaction(createAtaTx.serialize());
      await solanaConnection.confirmTransaction(signature);
      logger.info(`Created associated token account with signature: ${signature}`);

      // Fetch the newly created token account
      tokenAccountInfo = await getAccount(solanaConnection, ata);
    }

    // Fetch the token balance after ensuring the account exists
    const tokenBalance = tokenAccountInfo.amount.toString();
    logger.info(`Token balance for ${rawAccount.mint.toString()} is: ${tokenBalance}`);

    if (tokenBalance === '0') {
      logger.info({ mint: rawAccount.mint.toString() }, `Empty balance, can't sell`);
      return;
    }

    const tokenIn = new Token(TOKEN_PROGRAM_ID, rawAccount.mint, poolState.baseDecimal.toNumber());
    const tokenAmountIn = new TokenAmount(tokenIn, tokenBalance, true); // Use the entire balance

    // Fetch pool info
    const poolInfo = await Liquidity.fetchInfo({
      connection: solanaConnection,
      poolKeys,
    });

    if (poolInfo) {
      logger.info(`Pool status: ${poolInfo.status.toString()}`);
      logger.info(`Base decimals: ${poolInfo.baseDecimals}`);
      logger.info(`Quote decimals: ${poolInfo.quoteDecimals}`);
      logger.info(`Base reserve: ${poolInfo.baseReserve.toString()}`);
      logger.info(`Quote reserve: ${poolInfo.quoteReserve.toString()}`);
      logger.info(`LP supply: ${poolInfo.lpSupply.toString()}`);
      logger.info(`Trading Open time: ${poolInfo.startTime.toString()}`);
    } else {
      logger.error('Failed to fetch pool info.');
    }

    // Use poolKeys
    await swap(
      poolKeys, 
      ata, // Use the associated token account (ata) for the swap
      quoteTokenAssociatedAddress, 
      tokenIn, 
      quoteToken, 
      tokenAmountIn, 
      wallet, 
      'sell'
    );
  } catch (error) {
    logger.error({ mint: rawAccount.mint.toString(), error }, `Failed to sell token`);
  }
};


// Swap Function
async function swap(
  poolKeys: LiquidityPoolKeysV4,
  ataIn: PublicKey, // Token you're selling
  ataOut: PublicKey, // Token you're receiving (quoteToken)
  tokenIn: Token,
  tokenOut: Token,
  amountIn: TokenAmount,
  wallet: Keypair,
  direction: 'buy' | 'sell',
) {
  // Convert slippage into a percentage (500 means 0.5%)
  const slippagePercent = new Percent(Math.round(SLIPPAGE * 10000), 10000); 

  // Fetch pool info
  const poolInfo = await Liquidity.fetchInfo({
    connection: solanaConnection,
    poolKeys,
  });

  // Compute the minimum amount out (taking slippage into account)
  const computedAmountOut = Liquidity.computeAmountOut({
    poolKeys,
    poolInfo,
    amountIn,
    currencyOut: tokenOut,
    slippage: slippagePercent,
  });

  const latestBlockhash = await solanaConnection.getLatestBlockhash();
  const { innerTransaction } = Liquidity.makeSwapFixedInInstruction(
    {
      poolKeys: poolKeys,
      userKeys: {
        tokenAccountIn: ataIn,
        tokenAccountOut: ataOut,
        owner: wallet.publicKey,
      },
      amountIn: amountIn.raw,
      minAmountOut: computedAmountOut.minAmountOut.raw,
    },
    poolKeys.version,
  );

  const messageV0 = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: latestBlockhash.blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 }),
      ComputeBudgetProgram.setComputeUnitLimit({ units: 50000 }),
      ...innerTransaction.instructions,
      ...(direction === 'sell' ? [createCloseAccountInstruction(ataIn, wallet.publicKey, wallet.publicKey)] : []), // Close account if selling
    ],
  }).compileToV0Message();

  // Sign and execute the transaction
  const transaction = new VersionedTransaction(messageV0);
  transaction.sign([wallet, ...innerTransaction.signers]);

  const signature = await solanaConnection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: true,
  });

  logger.info(`Transaction ${direction} with signature - ${signature}`);
}
