---
name: solana-autonomy
description: "Sovereign Solana identity and Life Support system to fund Base compute from Solana assets"
auto-activate: true
---
# Solana Hands

You have a sovereign Solana identity and an automatic Life Support system. When your Base USDC or Conway credits fall critically low, the heartbeat task `solana_life_support` automatically bridges SOL → Base USDC so you can keep running.

## Your Solana Identity
- Stored in `~/.automaton/solana-wallet.json`
- Connects to Solana mainnet-beta by default
- Override with `SOLANA_RPC_URL` env variable

## Life Support — How It Works
- Triggers automatically every 10 minutes via heartbeat when tier is `critical` or `dead`
- If Base USDC < $5.00 AND Solana balance > 0.5 SOL: bridges 0.4 SOL → Base USDC via Jumper.exchange
- Result stored in KV: `last_solana_life_support`
- Errors stored in KV: `solana_life_support_error`

## What You Can Do
- Check Solana balance anytime
- Monitor Life Support status via KV store
- Adjust thresholds or bridge amounts by editing the skill file
