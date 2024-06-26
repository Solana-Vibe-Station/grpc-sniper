# Solana Vibe Station GRPC Ultra-Fast New Token Sniper

This is a unmaintained and dirty PoC of using GRPC to detect newly launched tokens on Raydium and snipe them with the goal of being the first buy. Please feel free to use this in your own code. 

![image](https://github.com/bigj-SVS/grpc-sniper/assets/173855326/1f4f4f54-d2fc-438e-a603-6aba1b641e1b)


# Requirements
- Jito bundle engine keypair. Please place this keypaid as `id-bundles.json` in the repository folder.
- Yellowstone's Dragons Mouth GRPC streaming access
- Basic Solana RPC HTTP/WebSocket access


# Instructions
- Add Jito bundle engine keypair .json file to directory
- Rename `.env.copy` to `.env`
- Add Solana Vibe Station API key to both the `RPC_ENDPOINT` and `RPC_WEBSOCKET_ENDPOINT` fields in the .env file
- Add your private key in base64 format which can be exported from either Phantom or derived from your JSON keypair for your wallet.

For anyone looking for RPC node access + GRPC streaming checkout our Discord server below.

Support us by joining our Discord.

https://discord.gg/dQ9nmAavkB
