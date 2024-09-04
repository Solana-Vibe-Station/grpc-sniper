import { streamNewTokens } from './streaming/raydium';
import { streamOpenbook } from './streaming/openbook';

require('dotenv').config();

import { init } from './transaction/transaction';




async function start() {

  await init();

  streamNewTokens();
  streamOpenbook();

}

start();
