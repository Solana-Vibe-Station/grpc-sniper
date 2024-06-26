import { streamNewTokens } from './streaming/raydium';
import { streamOpenbook } from './streaming/openbook';

require('dotenv').config();


import * as Fs from 'fs';

import { Connection, Keypair, PublicKey, TransactionMessage, VersionedMessage, VersionedTransaction } from '@solana/web3.js';
import { logger } from './utils/logger';
import { init } from './transaction/transaction';

const blockEngineUrl = process.env.BLOCK_ENGINE_URL || '';
console.log('BLOCK_ENGINE_URL:', blockEngineUrl);

const authKeypairPath = process.env.AUTH_KEYPAIR_PATH || '';
console.log('AUTH_KEYPAIR_PATH:', authKeypairPath);
const decodedKey = new Uint8Array(
  JSON.parse(Fs.readFileSync(authKeypairPath).toString()) as number[]
);
const keypair = Keypair.fromSecretKey(decodedKey);

import {
  ChannelCredentials,
  ChannelOptions,
  ClientReadableStream,
  ServiceError,
} from '@grpc/grpc-js';




import { SearcherServiceClient } from 'jito-ts/dist/gen/block-engine/searcher'
import { AuthServiceClient } from 'jito-ts/dist/gen/block-engine/auth';
import { authInterceptor, AuthProvider } from 'jito-ts/dist/sdk/block-engine/auth';



async function start() {

  await init();

  streamNewTokens();
  streamOpenbook();

}

const searcherClient = (
  url: string,
  authKeypair: Keypair,
  grpcOptions?: Partial<ChannelOptions>
): SearcherServiceClient => {
  const authProvider = new AuthProvider(
    new AuthServiceClient(url, ChannelCredentials.createSsl()),
    authKeypair
  );
  const client: SearcherServiceClient = new SearcherServiceClient(
    url,
    ChannelCredentials.createSsl(),
    { interceptors: [authInterceptor(authProvider)], ...grpcOptions }
  );

  return client;
}

import { Transaction } from '@solana/web3.js';
import * as bs58 from 'bs58';
import { TokenInstructions } from '@project-serum/serum';
import { Liquidity, TOKEN_PROGRAM_ID } from '@raydium-io/raydium-sdk';
import { RPC_ENDPOINT, RPC_WEBSOCKET_ENDPOINT } from './constants';
import { AccountLayout } from '@solana/spl-token';
const connection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
});
async function test() {
  const poolState = await connection.getProgramAccounts(new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8'));

  logger.info(poolState);

}

start();
