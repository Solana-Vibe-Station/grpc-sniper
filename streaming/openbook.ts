import { CommitmentLevel, SubscribeRequest } from "@triton-one/yellowstone-grpc";
import pino from "pino";
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

import Client from "@triton-one/yellowstone-grpc";
import { MARKET_STATE_LAYOUT_V3 } from "@raydium-io/raydium-sdk";
import { PublicKey } from "@solana/web3.js";
import { BufferRingBuffer } from "../buffer/buffer";

const client = new Client("https://grpc.solanavibestation.com", undefined, undefined);
export const bufferRing = new BufferRingBuffer(5000);

export async function streamOpenbook() {
  const stream = await client.subscribe();

  // Buffer data batching and processing for high-frequency streaming
  const enqueueData = (data: Buffer) => {
    bufferRing.enqueue(data);
  };

  // Collect incoming events with minimal processing
  stream.on("data", (data) => {
    if (data.account?.account?.data) {
      enqueueData(Buffer.from(data.account.account.data)); // Convert Uint8Array to Buffer
    }
  });

  const quoteMintOffset = MARKET_STATE_LAYOUT_V3.offsetOf('quoteMint').toString();
  const openBookRequest: SubscribeRequest = {
    slots: {},
    accounts: {
      raydium: {
        account: [],
        filters: [
          {
            memcmp: {
              offset: quoteMintOffset,
              base58: "So11111111111111111111111111111111111111112",
            },
          },
        ],
        owner: ["srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX"],
      },
    },
    transactions: {},
    blocks: {},
    blocksMeta: {},
    accountsDataSlice: [],
    commitment: CommitmentLevel.PROCESSED,
    entry: {},
  };

  try {
    await new Promise<void>((resolve, reject) => {
      stream.write(openBookRequest, (err: null | undefined) => {
        err ? reject(err) : resolve();
      });
    });
  } catch (error) {
    logger.error("Subscription request failed:", error);
    throw error;
  }
}