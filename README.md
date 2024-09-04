# Solana Vibe Station GRPC Ultra-Fast New Token Sniper

This is a unmaintained and dirty PoC of using GRPC to detect newly launched tokens on Raydium and snipe them with the goal of being the first buy. Please feel free to use this in your own code. 

This program does not have any sell logic. This is not a bot. This is simply example code to demonstrate the capabilities and performance advantages that GRPC has over normal Solana RPC methods such as WebSockets.

![image](https://github.com/bigj-SVS/grpc-sniper/assets/173855326/1f4f4f54-d2fc-438e-a603-6aba1b641e1b)

# Updated branch for people without a whitelisted id.json file
You can use this branch to use the public Jito send transaction endpoint without having to have a pre-approved whitelisted Jito id.json file.

# Requirements
- Yellowstone's Dragons Mouth GRPC streaming access (SVS's gRPC service)
- RPC HTTP/WebSocket access (Ideally SVS's Staked RPC for best results)


# Instructions
- Rename `.env.copy` to `.env`
- Add Solana Vibe Station API key to both the `RPC_ENDPOINT` and `RPC_WEBSOCKET_ENDPOINT` fields in the .env file
- Add your private key in base64 format which can be exported from either Phantom or derived from your JSON keypair for your wallet.

For anyone looking for RPC node access + GRPC streaming checkout our Discord server below.

Support us by joining our Discord.

https://discord.gg/dQ9nmAavkB
