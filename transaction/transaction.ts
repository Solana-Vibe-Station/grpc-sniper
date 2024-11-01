// External Libraries
import bs58 from 'bs58';
import { BN } from 'bn.js';
import fetch from 'node-fetch';
import { ComputeBudgetProgram, Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { Liquidity, LiquidityPoolKeysV4, LiquidityStateV4, Token, TokenAmount, Percent } from '@raydium-io/raydium-sdk';
import { createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction, getAccount, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';

// Internal Modules
import { logger } from '../utils/logger';
import { getWallet } from '../utils/wallet';
import { createAndFundWSOL, checkAuthority } from '../utils/helpers';
import { createPoolKeys, getTokenAccounts } from '../liquidity';
import { MinimalMarketLayoutV3 } from '../market';
import { COMMITMENT_LEVEL, LOG_LEVEL, PRIVATE_KEY, QUOTE_AMOUNT, QUOTE_MINT, RPC_ENDPOINT, RPC_WEBSOCKET_ENDPOINT, BUY_SLIPPAGE, TAKE_PROFIT, AMOUNT_TO_WSOL, AUTO_SELL, SELL_TIMER, MAX_RETRY, FREEZE_AUTHORITY, MINT_AUTHORITY, SELL_SLIPPAGE, STOP_LOSS, PRICE_CHECK_INTERVAL, ONE_TOKEN_AT_A_TIME, MAX_NUMBERS_TOKENS_TO_PROCESS } from '../constants';

// Token amount initialization
let quoteTokenAssociatedAddress: PublicKey;
let quoteAmount: TokenAmount;
let quoteToken = Token.WSOL;

// Initialize wallet using PRIVATE_KEY
quoteAmount = new TokenAmount(Token.WSOL, QUOTE_AMOUNT, false);

export interface MinimalTokenAccountData {
  mint: PublicKey;
  address: PublicKey;
  poolKeys?: LiquidityPoolKeysV4;
  market?: LiquidityStateV4;
};

const existingTokenAccounts: Map<string, MinimalTokenAccountData> = new Map<string, MinimalTokenAccountData>();
// Constants
export const sleep = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
export const wallet = getWallet(PRIVATE_KEY.trim()); // Initialize wallet once
export const solanaConnection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
});

// Init Function
export async function init(): Promise<void> {
  logger.level = LOG_LEVEL;
  
  logger.info(`Wallet Address: ${wallet.publicKey}`);

  // Handle quote token based on QUOTE_MINT (WSOL or USDC)
  if (QUOTE_MINT === 'WSOL') {
    quoteToken = Token.WSOL;
    quoteAmount = new TokenAmount(Token.WSOL, QUOTE_AMOUNT, false);
    logger.info('Quote token is WSOL');
  } else if (QUOTE_MINT === 'USDC') {
    quoteToken = new Token(
      TOKEN_PROGRAM_ID,
      new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
      6,
      'USDC',
      'USDC',
    );
    quoteAmount = new TokenAmount(quoteToken, QUOTE_AMOUNT, false);
    logger.info('Quote token is USDC');
  } else {
    throw new Error(`Unsupported quote mint "${QUOTE_MINT}". Supported values are USDC and WSOL`);
  }

  logger.info(
    `Script will buy all new tokens using ${QUOTE_MINT}. Amount for each token: ${quoteAmount.toFixed().toString()}`
  );

  // Log trading configurations
  logger.info(`
    AUTO_SELL: ${AUTO_SELL}
    BUY_SLIPPAGE: ${BUY_SLIPPAGE}%
    SELL_SLIPPAGE: ${SELL_SLIPPAGE}%
    STOP_LOSS: ${STOP_LOSS}%
    TAKE_PROFIT: ${TAKE_PROFIT}%
    ONE_TOKEN_AT_A_TIME: ${ONE_TOKEN_AT_A_TIME}
    MAX_NUMBERS_TOKENS_TO_PROCESS: ${MAX_NUMBERS_TOKENS_TO_PROCESS}
    AMOUNT_TO_WSOL: ${AMOUNT_TO_WSOL} ${quoteToken.symbol}
    QUOTE_AMOUNT: ${QUOTE_AMOUNT} ${quoteToken.symbol}
    MAX_RETRY: ${MAX_RETRY}
    SELL_TIMER: ${SELL_TIMER}ms
    PRICE_CHECK_INTERVAL: ${PRICE_CHECK_INTERVAL}ms
    FREEZE_AUTHORITY: ${FREEZE_AUTHORITY}
    MINT_AUTHORITY: ${MINT_AUTHORITY}
  `);

  // Check existing wallet for associated token account of quote mint
  const tokenAccounts = await getTokenAccounts(solanaConnection, wallet.publicKey, COMMITMENT_LEVEL);
  logger.info('Fetched token accounts from wallet.');

  if (QUOTE_MINT === 'WSOL') {
    const wsolAta = getAssociatedTokenAddressSync(Token.WSOL.mint, wallet.publicKey);
    logger.info(`WSOL ATA: ${wsolAta.toString()}`);

    const solAccount = tokenAccounts.find(acc => acc.accountInfo.mint.toString() === Token.WSOL.mint.toString());
    if (!solAccount) {
      logger.info(`No WSOL token account found. Creating and funding with ${AMOUNT_TO_WSOL} SOL...`);
      await createAndFundWSOL(wsolAta);
    } else {
      logger.info('WSOL account already exists in the wallet.');
      const wsolAccountInfo = await getAccount(solanaConnection, wsolAta);

      const wsolBalance = Number(wsolAccountInfo.amount) / LAMPORTS_PER_SOL;
      logger.info(`Current WSOL balance: ${wsolBalance} WSOL`);

      if (wsolBalance < AMOUNT_TO_WSOL) {
        logger.info(`Insufficient WSOL balance. Funding with additional ${AMOUNT_TO_WSOL} SOL...`);
        await createAndFundWSOL(wsolAta);
      }
    }
    quoteTokenAssociatedAddress = wsolAta;
  } else {
    const tokenAccount = tokenAccounts.find(acc => acc.accountInfo.mint.toString() === quoteToken.mint.toString());
    if (!tokenAccount) {
      throw new Error(`No ${quoteToken.symbol} token account found in wallet: ${wallet.publicKey}`);
    }
    quoteTokenAssociatedAddress = tokenAccount.pubkey;
  }
}

// Constants for rate limiting
const RATE_LIMIT_INTERVAL = 2000; // 2000 milliseconds for 30 calls per minute
let lastFetchTime = 0; // Timestamp of the last fetch

// Function to fetch WSOL price from CoinGecko with retry logic
const fetchWsolPrice = async (retries: number = 3, delay: number = 2000): Promise<number | null> => {
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            const now = Date.now();
            // Check if we need to wait before making the next API call
            if (now - lastFetchTime < RATE_LIMIT_INTERVAL) {
                await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_INTERVAL - (now - lastFetchTime)));
            }
            lastFetchTime = Date.now(); // Update last fetch time
            
            const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=wrapped-solana&vs_currencies=usd');
            const data: { [key: string]: { usd: number } } = await response.json() as { [key: string]: { usd: number } };

            // Accessing the WSOL price from the response format
            if (data['wrapped-solana'] && data['wrapped-solana'].usd) {
                return data['wrapped-solana'].usd; // Return the WSOL price in USD
            } else {
                throw new Error('Failed to retrieve WSOL price from CoinGecko');
            }
        } catch (error) {
            logger.error(`Attempt ${attempt + 1} - Error fetching WSOL price:`, error);
            // Wait before retrying
            if (attempt < retries - 1) {
                await new Promise(resolve => setTimeout(resolve, delay)); // Delay before retrying
            }
        }
    }
    logger.error('Failed to fetch WSOL price after multiple attempts.');
    return null; // Return null if all attempts fail
};

const priceMatch = async (poolKeys: LiquidityPoolKeysV4, amountIn: TokenAmount, sellTimer: number) => {
  if (PRICE_CHECK_INTERVAL === 0) {
      return true; // Immediately proceed if no interval is set
  }

  const wsolPriceInUsd = await fetchWsolPrice();
  if (!wsolPriceInUsd) {
      logger.error('Could not fetch WSOL price, exiting price match.');
      return false; // Exit if the price couldn't be fetched
  }

  const profitFraction = quoteAmount.mul(TAKE_PROFIT).numerator.div(new BN(100));
  const profitAmount = new TokenAmount(quoteToken, profitFraction, true);
  let takeProfit = quoteAmount.add(profitAmount);
  const initialTakeProfitInUsd = parseFloat(takeProfit.toFixed()) * wsolPriceInUsd;

  const lossFraction = quoteAmount.mul(STOP_LOSS).numerator.div(new BN(100));
  const lossAmount = new TokenAmount(quoteToken, lossFraction, true);
  const stopLoss = quoteAmount.subtract(lossAmount);
  const slippage = new Percent(SELL_SLIPPAGE, 100);

  let startTime = Date.now();
  let highestPrice = 0;

  // Loop until the SELL_TIMER duration elapses or price conditions are met
  while (Date.now() - startTime < sellTimer) {
      try {
          const poolInfo = await Liquidity.fetchInfo({
              connection: solanaConnection,
              poolKeys,
          });

          const amountOut = Liquidity.computeAmountOut({
              poolKeys,
              poolInfo,
              amountIn: amountIn,
              currencyOut: quoteToken,
              slippage,
          }).amountOut;

          // Ensure amounts are treated as numbers for arithmetic operations
          const currentInUsd = parseFloat(amountOut.toFixed()) * wsolPriceInUsd;

          // Check if the current price is a new high
          if (currentInUsd > highestPrice) {
              highestPrice = currentInUsd; // Update highest price seen
              // Lock in profit by adjusting take profit to current level + profit fraction
              const newTakeProfit = currentInUsd * (1 + (TAKE_PROFIT / 100));
              takeProfit = new TokenAmount(quoteToken, newTakeProfit / wsolPriceInUsd, true); // Update take profit
              logger.info(`New take profit level locked in at: $${newTakeProfit.toFixed(2)}`);
          }

          const takeProfitInUsd = parseFloat(takeProfit.toFixed()) * wsolPriceInUsd;
          const stopLossInUsd = parseFloat(stopLoss.toFixed()) * wsolPriceInUsd;

          // Calculate gain percentage based on the take profit
          const gainPercentage = ((currentInUsd - initialTakeProfitInUsd) / initialTakeProfitInUsd) * 100;

          // Format gain percentage to show '+' or '-' sign
          const formattedGainPercentage = gainPercentage >= 0 ? `+${gainPercentage.toFixed(2)}%` : `${gainPercentage.toFixed(2)}%`;

          logger.debug(
              { mint: poolKeys.baseMint.toString() },
              `Take profit: $${takeProfitInUsd.toFixed(2)} | Stop loss: $${stopLossInUsd.toFixed(2)} | Current: $${currentInUsd.toFixed(2)} | Gain Percentage: ${formattedGainPercentage}`
          );

          // Check if the price meets the take profit or stop loss conditions
          if (amountOut.lt(stopLoss) || amountOut.gt(takeProfit)) {
              return true; // Sell conditions met, proceed to sell
          }

          // Wait before checking the price again
          await sleep(PRICE_CHECK_INTERVAL);
      } catch (e) {
          logger.trace({ mint: poolKeys.baseMint.toString(), e }, `Failed to check token price`);
      }
  }

  // If the SELL_TIMER has expired without meeting conditions, proceed with sell
  logger.info(`SELL_TIMER expired, proceeding with sell.`);
  return true;
};

async function fetchAndValidateBlockhash(): Promise<string> {
  try {
    const { blockhash, lastValidBlockHeight } = await solanaConnection.getLatestBlockhash();
    const currentBlockHeight = await solanaConnection.getBlockHeight();
    // Check if the current block height is within the valid range
    if (currentBlockHeight > lastValidBlockHeight) {
      throw new Error("Blockhash is no longer valid");
    }

    return blockhash;
  } catch (error) {
    logger.error("Failed to fetch latest blockhash", error);
    throw new Error("Invalid blockhash");
  }
}

// Buy Function with Optimized Mint and Freeze Authority Check
export async function buy(
  latestBlockhash: string,
  newTokenAccount: PublicKey,
  poolState: LiquidityStateV4,
  minimalMarketLayoutV3: MinimalMarketLayoutV3
): Promise<void> {
  try {
    const mintAddress = poolState.baseMint;
    const shouldCheckFreezeAuthority = FREEZE_AUTHORITY;
    const shouldCheckMintAuthority = MINT_AUTHORITY;

    // Check authority only if required
    if (shouldCheckFreezeAuthority || shouldCheckMintAuthority) {
      const { mintAuthority, freezeAuthorityExists } = await checkAuthority(mintAddress);

      if ((shouldCheckFreezeAuthority && freezeAuthorityExists) ||
          (shouldCheckMintAuthority && mintAuthority)) {
        logger.info(`Authority conditions prevent buy for mint: ${mintAddress.toString()}`);
        return;
      }
    }

    const ata = getAssociatedTokenAddressSync(mintAddress, wallet.publicKey);
    const poolKeys = createPoolKeys(newTokenAccount, poolState, minimalMarketLayoutV3);

    // Fetch and validate blockhash before creating the transaction
    let validBlockhash = await fetchAndValidateBlockhash();

    // Ensure the provided latestBlockhash is still valid
    if (latestBlockhash !== validBlockhash) {
      logger.info("Provided blockhash is no longer valid. Fetching a new blockhash...");
      validBlockhash = await fetchAndValidateBlockhash(); // Fetch a fresh blockhash
    }

    // Prepare the transaction
    const { innerTransaction } = Liquidity.makeSwapFixedInInstruction(
      {
        poolKeys,
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
      recentBlockhash: validBlockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 }),
        ComputeBudgetProgram.setComputeUnitLimit({ units: 80000 }),
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

    // Send the transaction
    const signature = await solanaConnection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: true,
    });

    logger.info(`Buy transaction completed with signature - ${signature}`);

    // Trigger auto-sell if enabled
    if (AUTO_SELL) {
      await sleep(3000); // Shortened wait for faster processing
      await sell(wallet.publicKey, { mint: mintAddress, address: ata }, poolState, poolKeys);
    }
  } catch (error) {
    logger.error(error);
  }
}

// Sell Function
export const sell = async (
  accountId: PublicKey,
  rawAccount: MinimalTokenAccountData,
  poolState: LiquidityStateV4,
  poolKeys: LiquidityPoolKeysV4
): Promise<void> => {
  try {
    const ata = getAssociatedTokenAddressSync(rawAccount.mint, wallet.publicKey);

    // Attempt to fetch token account info, retry if not found
    let tokenAccountInfo;
    while (!tokenAccountInfo) {
      try {
        tokenAccountInfo = await getAccount(solanaConnection, ata);
      } catch (error) {
        if (error instanceof Error && error.name === 'TokenAccountNotFoundError') {
          await sleep(500); // Reduce retry delay for faster checks
        } else {
          throw error;
        }
      }
    }

    const tokenBalance = tokenAccountInfo.amount.toString();
    if (tokenBalance === '0') {
      logger.info({ mint: rawAccount.mint.toString() }, `No balance to sell`);
      return;
    }

    const tokenIn = new Token(TOKEN_PROGRAM_ID, rawAccount.mint, poolState.baseDecimal.toNumber());
    const tokenAmountIn = new TokenAmount(tokenIn, tokenBalance, true);

    // Run price match with SELL_TIMER timeout
    const shouldProceedWithSell = await priceMatch(poolKeys, tokenAmountIn, SELL_TIMER);

    if (shouldProceedWithSell) {
      await attemptSell(poolKeys, ata, tokenIn, tokenAmountIn);
    } else {
      logger.info(`Conditions not met, skipping sell.`);
    }
  } catch (error) {
    logger.error({ mint: rawAccount.mint.toString(), error }, `Sell operation failed`);
  }
};

// Function to attempt selling with retry logic
async function attemptSell(
  poolKeys: LiquidityPoolKeysV4,
  ataIn: PublicKey,
  tokenIn: Token,
  amountIn: TokenAmount,
) {
  const maxRetries = 10; // Maximum number of retry attempts
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const confirmed = await swap(
        poolKeys,
        ataIn,
        quoteTokenAssociatedAddress,
        tokenIn,
        quoteToken,
        amountIn,
        wallet,
        'sell'
      );

      // Check if the transaction was confirmed
      const isConfirmed = await confirmTransaction(confirmed);
      if (isConfirmed) {
        logger.info(`Sell transaction confirmed on attempt ${attempt + 1}`);
        break; // Exit if confirmed
      } else {
        logger.warn(`Sell transaction not confirmed on attempt ${attempt + 1}, retrying...`);
      }
    } catch (error) {
      logger.error({ attempt: attempt + 1, error }, `Sell attempt ${attempt + 1} failed`);
      if (attempt === maxRetries - 1) {
        logger.error(`Max retries reached for selling. Aborting.`);
      }
    }
  }
}

// Optimized Swap Function
async function swap(
  poolKeys: LiquidityPoolKeysV4,
  ataIn: PublicKey,
  ataOut: PublicKey,
  tokenIn: Token,
  tokenOut: Token,
  amountIn: TokenAmount,
  wallet: Keypair,
  direction: 'buy' | 'sell',
): Promise<string> { // Return the transaction signature for confirmation check
  const slippagePercent = new Percent(
    direction === 'buy' ? BUY_SLIPPAGE * 100 : SELL_SLIPPAGE * 100,
    10000
  );

  const poolInfo = await Liquidity.fetchInfo({ connection: solanaConnection, poolKeys });

  const computedAmountOut = Liquidity.computeAmountOut({
    poolKeys,
    poolInfo,
    amountIn,
    currencyOut: tokenOut,
    slippage: slippagePercent,
  });

  // Fetch and validate blockhash before creating the transaction
  const validBlockhash = await fetchAndValidateBlockhash();

  const { innerTransaction } = Liquidity.makeSwapFixedInInstruction(
    {
      poolKeys,
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
    recentBlockhash: validBlockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 }),
      ComputeBudgetProgram.setComputeUnitLimit({ units: 80000 }),
      ...innerTransaction.instructions,
      ...(direction === 'sell' ? [createCloseAccountInstruction(ataIn, wallet.publicKey, wallet.publicKey)] : []),
    ],
  }).compileToV0Message();

  const transaction = new VersionedTransaction(messageV0);
  transaction.sign([wallet, ...innerTransaction.signers]);

  const signature = await solanaConnection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: true,
  });

  logger.info(`Transaction ${direction} completed with signature - ${signature}`);

  return signature; // Return the transaction signature for confirmation
}

// Function to confirm the transaction
async function confirmTransaction(signature: string): Promise<boolean> {
  try {
    const result = await solanaConnection.confirmTransaction(signature);
    return result.value.err === null; // Check if the transaction is confirmed successfully
  } catch (error) {
    logger.error(`Failed to confirm transaction: ${signature}, error: ${error}`);
    return false; // Return false if confirmation fails
  }
}