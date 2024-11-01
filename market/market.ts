import { Commitment, Connection, PublicKey } from '@solana/web3.js';
import { GetStructureSchema, MARKET_STATE_LAYOUT_V3, LiquidityStateV4 } from '@raydium-io/raydium-sdk';
import { MINIMAL_MARKET_STATE_LAYOUT_V3 } from '../liquidity';
import { logger } from '../utils';

export type MinimalMarketStateLayoutV3 = typeof MINIMAL_MARKET_STATE_LAYOUT_V3;
export type MinimalMarketLayoutV3 = GetStructureSchema<MinimalMarketStateLayoutV3>;

export async function getMinimalMarketV3(
  connection: Connection,
  marketId: PublicKey,
  commitment?: Commitment,
): Promise<MinimalMarketLayoutV3 | null> {
  try {
    const marketInfo = await connection.getAccountInfo(marketId, {
      commitment,
      dataSlice: {
        offset: MARKET_STATE_LAYOUT_V3.offsetOf('eventQueue'),
        length: 32 * 3,
      },
    });

    // Check if marketInfo is null
    if (!marketInfo) {
      logger.error(`Market info not found for ID: ${marketId.toString()}`);
      return null; // Early return if no market info found
    }

    return MINIMAL_MARKET_STATE_LAYOUT_V3.decode(marketInfo.data);
  } catch (error) {
    logger.error(`Error fetching minimal market for ID ${marketId.toString()}:`, error);
    return null; // Return null on error to signify failure
  }
}
