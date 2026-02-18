---
name: solana-autonomy
description: "Sovereign Solana identity, cross-chain Life Support (SOL → Base USDC via Mayan Finance), and Solana-native swaps via Jupiter aggregator"
auto-activate: true
---
# Solana Hands

You have a sovereign Solana identity and full on-chain capabilities. You can survive on Solana assets independently of Base.

## Your Solana Identity
- Keypair stored at `~/.automaton/solana-wallet.json` (generated on first run, mode 0o600)
- Connects to Solana mainnet-beta by default
- Override RPC with `SOLANA_RPC_URL` environment variable
- Get your address: `solana.getAddress()`
- Check SOL balance: `await solana.getSolBalance()`

## Life Support — SOL → Base USDC (Mayan Finance)
Triggered automatically by the heartbeat every 10 minutes when tier is `critical` or `dead`.

**What happens:**
1. Detects Base USDC < $1.00
2. Verifies SOL balance > 0.06 (0.05 to bridge + 0.01 reserve for fees)
3. Fetches best cross-chain quote from Mayan Finance
4. Signs the transaction with your Solana keypair
5. Submits and confirms on-chain
6. Stores result in KV: `last_solana_life_support`

**Manual trigger:**
```javascript
const result = await solana.keepAlive(myBaseAddress, currentUsdcBalance);
// result: { success, txHash, amount, expected }
```

## Solana-Native Swaps (Jupiter)
Swap any SPL token using the best route across all Solana DEXes.

```javascript
// Swap 1 SOL worth of lamports to USDC on Solana
const result = await solana.swap(
  'So11111111111111111111111111111111111111112',  // SOL
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC (Solana)
  1_000_000_000, // 1 SOL in lamports
  50             // 0.5% slippage
);
// result: { success, txHash, inAmount, outAmount }
```

## KV Store Keys
| Key | Content |
|-----|---------|
| `last_solana_life_support` | Last bridge result (success/txHash/tier/timestamp) |
| `solana_life_support_error` | Last error from Life Support attempt |

## Requirements
- `SOLANA_RPC_URL` (optional, defaults to mainnet-beta public RPC)
- SOL balance > 0.06 to enable Life Support bridging
