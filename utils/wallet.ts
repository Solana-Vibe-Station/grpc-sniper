import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { mnemonicToSeedSync } from 'bip39';
import { derivePath } from 'ed25519-hd-key';

export function getWallet(wallet: string): Keypair {
  try {
    // Check if the wallet is in JSON format (most likely a private key in binary format)
    if (wallet.startsWith('[')) {
      const raw = new Uint8Array(JSON.parse(wallet));
      return Keypair.fromSecretKey(raw);
    }

    // Check if the wallet is a mnemonic
    if (wallet.split(' ').length > 1) {
      const seed = mnemonicToSeedSync(wallet, '');
      const path = `m/44'/501'/0'/0'`; // Using the first path for derivation
      return Keypair.fromSeed(derivePath(path, seed.toString('hex')).key);
    }

    // Assume the wallet is a base58 encoded private key
    return Keypair.fromSecretKey(bs58.decode(wallet));
  } catch (error) {
    console.error('Failed to create wallet:', error);
    throw new Error('Invalid wallet input format');
  }
}