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

//Initialize Ring Buffer

// This portion of the code streams the Openbook data which is needed to make a buy request.
// The data is stored in a buffer ring and then queried if the raydium stream gets a liquidity event.
// We stream and store this data because a lot of the time the data we need from here is streamed before the raydium stream gets the liquidity event.
// This way we can store the data and then query it when we need it instead of making a slow web request to get the data.
// Many times it will not contain the data we need in which case the buy will be aborted. A trade-off for speed.

// I know somebody can probably improve this a lot. I'm not a pro at this stuff. I'm just a guy who likes to code.

export const bufferRing = new BufferRingBuffer(5000);

export async function streamOpenbook() {
  const stream = await client.subscribe();
  // Collecting all incoming events.
  stream.on("data", (data) => {
    if (data.account != undefined) {
      bufferRing.enqueue(data.account.account.data);
    }
  });

  const openBookRequest: SubscribeRequest = {
    "slots": {},
    "accounts": {
      "raydium": {
        "account": [],
        "filters": [
          {
            "memcmp": {
              "offset": MARKET_STATE_LAYOUT_V3.offsetOf('quoteMint').toString(),
              "base58": "So11111111111111111111111111111111111111112"
            }
          }
        ],
        "owner": ["srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX"] //Openbook program ID
      }
    },
    "transactions": {},
    "blocks": {},
    "blocksMeta": {},
    "accountsDataSlice": [],
    "commitment": CommitmentLevel.PROCESSED,
    entry: {}
  }
  // Sending a subscription request.
  await new Promise<void>((resolve, reject) => {
    stream.write(openBookRequest, (err: null | undefined) => {
      if (err === null || err === undefined) {
        resolve();
      } else {
        reject(err);
      }
    });
  }).catch((reason) => {
    console.error(reason);
    throw reason;
  });
}