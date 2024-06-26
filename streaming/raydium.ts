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
import { LIQUIDITY_STATE_LAYOUT_V4, MARKET_STATE_LAYOUT_V3 } from "@raydium-io/raydium-sdk";
import { PublicKey } from "@solana/web3.js";
import { bufferRing } from "./openbook";
import { buy } from "../transaction/transaction";
import { storeJitoLeaderSchedule } from "../jito/bundle";

// Array to store Jito leaders for current epoch
let leaderSchedule = new Set<number>();

// Function to populate the Jito leader array
export async function populateJitoLeaderArray() {
  leaderSchedule = await storeJitoLeaderSchedule();
}

// uncomment this line to enable Jito leader schedule check and delete the return line.
function slotExists(slot: number): boolean {
  //return leaderSchedule.has(slot);
  return true
}

const client = new Client("https://grpc.solanavibestation.com", undefined, undefined); //grpc endpoint from Solana Vibe Station obviously

(async () => {
  const version = await client.getVersion(); // gets the version information
  console.log(version);
})();

let latestBlockHash: string = "";

export async function streamNewTokens() {
  const stream = await client.subscribe();
  // Collecting all incoming events.
  stream.on("data", (data) => {
    if (data.blockMeta) {
      latestBlockHash = data.blockMeta.blockhash;
    }

    if (data.account != undefined) {
      logger.info(`New token alert!`);
      let slotCheckResult = false;
      let slotCheck = Number(data.account.slot);
      for (let i = 0; i < 2; i++) {
        logger.info(`Start slot check. Attempt ${i}`);
        const exists = slotExists(slotCheck + i);
        logger.info(`End slot check`);
        if (exists === true) {
          slotCheckResult = true;
          break;
        }
      }

      if (slotCheckResult) {
        const poolstate = LIQUIDITY_STATE_LAYOUT_V4.decode(data.account.account.data);
        const tokenAccount = new PublicKey(data.account.account.pubkey);
        logger.info(`Token Account: ${tokenAccount}`);

        let attempts = 0;
        const maxAttempts = 2;

        const intervalId = setInterval(async () => {
          const marketDetails = bufferRing.findPattern(poolstate.baseMint);
          if (Buffer.isBuffer(marketDetails)) {
            const fullMarketDetailsDecoded = MARKET_STATE_LAYOUT_V3.decode(marketDetails);
            const marketDetailsDecoded = {
              bids: fullMarketDetailsDecoded.bids,
              asks: fullMarketDetailsDecoded.asks,
              eventQueue: fullMarketDetailsDecoded.eventQueue,
            };
            buy(latestBlockHash, tokenAccount, poolstate, marketDetailsDecoded);
            clearInterval(intervalId); // Stop retrying when a match is found
          } else if (attempts >= maxAttempts) {
            logger.error("Invalid market details");
            clearInterval(intervalId); // Stop retrying after maxAttempts
          }
          attempts++;
        }, 10); // Retry every 10ms
      }
      else {
        logger.info(`No up coming Jito leaders. Slot: ${data.account.slot}`)
      }



    }
  });

  // Create a subscription request.
  const request: SubscribeRequest = {
    "slots": {},
    "accounts": {
      "raydium": {
        "account": [],
        "filters": [
          {
            "memcmp": {
              "offset": LIQUIDITY_STATE_LAYOUT_V4.offsetOf('quoteMint').toString(), // Filter for only tokens paired with SOL
              "base58": "So11111111111111111111111111111111111111112"
            }
          },
          {
            "memcmp": {
              "offset": LIQUIDITY_STATE_LAYOUT_V4.offsetOf('marketProgramId').toString(), // Filter for only Raydium markets that contain references to Serum
              "base58": "srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX"
            }
          },
          {
            "memcmp": {
              "offset": LIQUIDITY_STATE_LAYOUT_V4.offsetOf('swapQuoteInAmount').toString(), // Hack to filter for only new tokens. There is probably a better way to do this
              "bytes": Uint8Array.from([0])
            }
          },
          {
            "memcmp": {
              "offset": LIQUIDITY_STATE_LAYOUT_V4.offsetOf('swapBaseOutAmount').toString(), // Hack to filter for only new tokens. There is probably a better way to do this
              "bytes": Uint8Array.from([0])
            }
          }
        ],
        "owner": ["675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"] // raydium program id to subscribe to
      }
    },
    "transactions": {},
    "blocks": {},
    "blocksMeta": {
      "block": []
    },
    "accountsDataSlice": [],
    "commitment": CommitmentLevel.PROCESSED,  // Subscribe to processed blocks for the fastest updates
    entry: {}
  }

  // Sending a subscription request.
  await new Promise<void>((resolve, reject) => {
    stream.write(request, (err: null | undefined) => {
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
