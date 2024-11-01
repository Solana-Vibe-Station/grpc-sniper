import { CommitmentLevel, SubscribeRequest } from "@triton-one/yellowstone-grpc";
import pino from "pino";
import Client from "@triton-one/yellowstone-grpc";
import { LIQUIDITY_STATE_LAYOUT_V4, MARKET_STATE_LAYOUT_V3 } from "@raydium-io/raydium-sdk";
import { PublicKey, Transaction, sendAndConfirmTransaction, Connection } from "@solana/web3.js";
import { bufferRing } from "./openbook";
import { buy } from "../transaction/transaction";

const transport = pino.transport({
  target: 'pino-pretty',
});

export const logger = pino(
  {
    level: 'info',
    serializers: {
      error: pino.stdSerializers.err,
    },
    base: undefined,
  },
  transport,
);

const client = new Client("https://grpc.solanavibestation.com", undefined, undefined);
let latestBlockHash: string = "";

export async function streamNewTokens() {
  try {
    const stream = await client.subscribe();

    stream.on("data", (data) => {
      if (data.blockMeta) {
        latestBlockHash = data.blockMeta.blockhash;
      }

      if (data.account) {
        const poolstate = LIQUIDITY_STATE_LAYOUT_V4.decode(data.account.account.data);
        const tokenAccount = new PublicKey(data.account.account.pubkey);

        // Get the current time in seconds
        const currentTime = Math.floor(Date.now() / 1000);
        const poolOpenTime = poolstate.poolOpenTime.toNumber();
        console.log("Pool Open Time:", poolOpenTime);

        // Check if the poolOpenTime is within the last 30 seconds
        const isRecentOpenTime = poolOpenTime >= currentTime - 30 && poolOpenTime <= currentTime;
        if (isRecentOpenTime) {
          logger.info(`New token detected with recent open time! Token Account: ${tokenAccount}`);
          
          // Use a retry mechanism to check market details
          checkMarketDetails(poolstate, tokenAccount);
        } else {
          logger.info(`Ignored token due to non-recent open time: ${tokenAccount}`);
        }
      }
    });

    // Subscribe to account updates with improved error handling
    const request: SubscribeRequest = {
      slots: {},
      accounts: {
        raydium: {
          account: [],
          filters: [
            { memcmp: { offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('quoteMint').toString(), base58: "So11111111111111111111111111111111111111112" }},
            { memcmp: { offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('marketProgramId').toString(), base58: "srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX" }},
            { memcmp: { offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('swapQuoteInAmount').toString(), bytes: Uint8Array.from([0]) }},
            { memcmp: { offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('swapBaseOutAmount').toString(), bytes: Uint8Array.from([0]) }},
          ],
          owner: ["675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"],
        },
      },
      transactions: {},
      blocks: {},
      blocksMeta: { block: [] },
      accountsDataSlice: [],
      commitment: CommitmentLevel.PROCESSED,
      entry: {},
    };

    await new Promise<void>((resolve, reject) => {
      stream.write(request, (err: null | undefined) => {
        if (err) reject(err);
        else resolve();
      });
    }).catch((reason) => {
      logger.error("Failed to write subscription request:", reason);
      throw reason;
    });

    // Handle possible stream errors
    stream.on("error", (error) => {
      logger.error("Stream encountered an error:", error);
    });

    // Gracefully handle stream ending
    stream.on("end", () => {
      logger.info("Stream ended unexpectedly. Reconnecting...");
      streamNewTokens(); // Attempt to reconnect if stream ends
    });

  } catch (error) {
    logger.error("Failed to initiate token streaming:", error);
    setTimeout(streamNewTokens, 2000); // Retry after 5 seconds if the initial connection fails
  }
}

async function checkMarketDetails(poolstate: any, tokenAccount: PublicKey) {
  let attempts = 0;
  const maxAttempts = 5;
  const retryDelay = 20; // 20ms delay between retries

  const attemptCheck = async () => {
    const marketDetails = bufferRing.findPattern(poolstate.baseMint);
    if (Buffer.isBuffer(marketDetails)) {
      const fullMarketDetailsDecoded = MARKET_STATE_LAYOUT_V3.decode(marketDetails);
      const marketDetailsDecoded = {
        bids: fullMarketDetailsDecoded.bids,
        asks: fullMarketDetailsDecoded.asks,
        eventQueue: fullMarketDetailsDecoded.eventQueue,
      };
      // Modify the buy function to include the latest block hash and additional parameters as needed
      await buy(latestBlockHash, tokenAccount, poolstate, marketDetailsDecoded);
    } else if (attempts < maxAttempts) {
      attempts++;
      setTimeout(attemptCheck, retryDelay); // Retry after 20ms
    } else {
      logger.error("Invalid market details. Attempts exceeded.");
      logger.error(`Token Account: ${tokenAccount}, Pool Base Mint: ${poolstate.baseMint}`);
    }
  };

  attemptCheck();
}