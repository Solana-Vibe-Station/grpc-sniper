import { 
  Connection,
  PublicKey, 
  Keypair, 
  VersionedTransaction, 
  MessageV0
} 
from '@solana/web3.js';

import { Bundle } from 'jito-ts/dist/sdk/block-engine/types';

import * as Fs from 'fs';


require('dotenv').config();


import { searcherClient } from 'jito-ts/dist/sdk/block-engine/searcher';

import {
ChannelCredentials,
ChannelOptions,
ClientReadableStream,
ServiceError,
} from '@grpc/grpc-js';




import { SearcherServiceClient } from 'jito-ts/dist/gen/block-engine/searcher'
import { AuthServiceClient } from 'jito-ts/dist/gen/block-engine/auth';
import { authInterceptor, AuthProvider } from 'jito-ts/dist/sdk/block-engine/auth';


import {
  PRIVATE_KEY,
  RPC_ENDPOINT,
  RPC_WEBSOCKET_ENDPOINT,
} from '../constants';

import bs58 from 'bs58';
import { logger } from '../utils/logger';
import { bundle } from 'jito-ts';

function sleep(ms: number) {
return new Promise((resolve) => setTimeout(resolve, ms));
}

const SIGNER_WALLET = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
const JITO_TIP = process.env.JITO_TIP || '';
const jitoTip = Number(JITO_TIP) * 1000000000;
console.log('JITO_TIP:', jitoTip);




const blockEngineUrl = process.env.BLOCK_ENGINE_URL || '';
console.log('BLOCK_ENGINE_URL:', blockEngineUrl);

const authKeypairPath = process.env.AUTH_KEYPAIR_PATH || '';
console.log('AUTH_KEYPAIR_PATH:', authKeypairPath);
const decodedKey = new Uint8Array(
  JSON.parse(Fs.readFileSync(authKeypairPath).toString()) as number[]
);
const keypair = Keypair.fromSecretKey(decodedKey);

//const c = searcherClient(blockEngineUrl, keypair);
const noAuth = process.env.NO_AUTH || '';
console.log('NO_AUTH:', noAuth);

const c =
  noAuth === 'true'
    ? searcherClient(blockEngineUrl, undefined)
    : searcherClient(blockEngineUrl, keypair);

export const searcherClientAdv = (
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


// Get Tip Accounts

let tipAccounts: string[] = [];
(async () => {
try {
    tipAccounts = await c.getTipAccounts();
    console.log('Result:', tipAccounts);
} catch (error) {
    console.error('Error:', error);
}
})();



export async function sendBundle(latestBlockhash: string, message: MessageV0, mint: PublicKey) {

try {

  const transaction = new VersionedTransaction(message);

  transaction.sign([SIGNER_WALLET]);

  


  logger.info(`Fetching and adding tip`);

  const _tipAccount = tipAccounts[Math.floor(Math.random() * 6)];
  const tipAccount = new PublicKey(_tipAccount);



  const b = new Bundle([transaction], 2);
  b.addTipTx(
      SIGNER_WALLET,
      Number(jitoTip),      // Adjust Jito tip amount here
      tipAccount,
      latestBlockhash
  );


  logger.info(`Sending bundle`);
  const bundleResult = await c.sendBundle(b);
  logger.info(`Sent bundle! bundleResult = ${bundleResult}`);


  
  logger.info(
    {
      dex:`https://dexscreener.com/solana/${mint}?maker=${SIGNER_WALLET.publicKey}`
    },
    );

  
}

catch (error) {
  logger.error(error);
  
}  

}

// Get leader schedule

// This was when I was experimenting with only sending the buy tx when a Jito leader was up or going to be up in the next slot so that I wouldn't
// have to wait multiple slots for the tx to be processed. I ended up not using this feature as it couldn't get it working correctly before I moved on.

// Removed due to not working with public access, non-whitelisted keypair.