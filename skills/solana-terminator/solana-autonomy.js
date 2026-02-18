import {
  Keypair,
  Connection,
  clusterApiUrl,
  LAMPORTS_PER_SOL,
  VersionedTransaction,
} from '@solana/web3.js';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import 'dotenv/config';

/**
 * SolanaAutonomy Core
 *
 * Provides the Conway Automaton with:
 *   1. A sovereign Solana identity (keypair stored at ~/.automaton/solana-wallet.json)
 *   2. Life Support — automatic cross-chain bridge SOL → Base USDC via Mayan Finance
 *   3. Solana-native swaps via Jupiter aggregator
 */
export class SolanaAutonomy {
  constructor(rpcUrl = clusterApiUrl('mainnet-beta')) {
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.walletPath = path.join(process.env.HOME || '/root', '.automaton', 'solana-wallet.json');
    this.identity = this.loadIdentity();
  }

  // ─── Identity ────────────────────────────────────────────────

  /**
   * Load the Solana keypair from disk, or generate a new one.
   * The keypair is the agent's sovereign identity on Solana.
   */
  loadIdentity() {
    try {
      if (fs.existsSync(this.walletPath)) {
        const secretKey = Uint8Array.from(JSON.parse(fs.readFileSync(this.walletPath, 'utf8')));
        const keypair = Keypair.fromSecretKey(secretKey);
        console.log(`[Solana] Identity loaded: ${keypair.publicKey.toBase58()}`);
        return keypair;
      } else {
        const keypair = Keypair.generate();
        fs.mkdirSync(path.dirname(this.walletPath), { recursive: true, mode: 0o700 });
        fs.writeFileSync(this.walletPath, JSON.stringify(Array.from(keypair.secretKey)), { mode: 0o600 });
        console.log(`[Solana] New identity generated: ${keypair.publicKey.toBase58()}`);
        return keypair;
      }
    } catch (err) {
      console.error(`[Solana] Failed to load identity: ${err.message}`);
      return null;
    }
  }

  /**
   * Return the agent's Solana public key as a base58 string.
   */
  getAddress() {
    return this.identity?.publicKey.toBase58() ?? null;
  }

  // ─── Balance ─────────────────────────────────────────────────

  /**
   * Return the agent's current SOL balance.
   */
  async getSolBalance() {
    if (!this.identity) return 0;
    const lamports = await this.connection.getBalance(this.identity.publicKey);
    return lamports / LAMPORTS_PER_SOL;
  }

  // ─── Life Support (Cross-chain bridge) ───────────────────────

  /**
   * Check vital signs and trigger Life Support if needed.
   * Called by the heartbeat task every 10 minutes when tier is critical/dead.
   *
   * @param {string} baseWalletAddress  - The agent's Base (EVM) wallet address
   * @param {number} currentUsdcBalance - Current USDC balance on Base
   */
  async checkVitalSigns(baseWalletAddress, currentUsdcBalance) {
    const USDC_THRESHOLD = 5.0;
    const SOL_RESERVE    = 0.05; // keep some SOL for fees
    const SOL_TO_BRIDGE  = 0.4;
    const MIN_SOL        = SOL_TO_BRIDGE + SOL_RESERVE;

    console.log(`[LifeSupport] Base USDC: $${currentUsdcBalance.toFixed(2)} | threshold: $${USDC_THRESHOLD}`);

    if (currentUsdcBalance >= USDC_THRESHOLD) {
      console.log(`[LifeSupport] Systems nominal.`);
      return { success: true, status: 'nominal' };
    }

    console.log(`[LifeSupport] Low funds detected — checking Solana reserves...`);
    const solBalance = await this.getSolBalance();
    console.log(`[LifeSupport] SOL balance: ${solBalance.toFixed(4)}`);

    if (solBalance < MIN_SOL) {
      console.warn(`[LifeSupport] Insufficient SOL (${solBalance.toFixed(4)} < ${MIN_SOL})`);
      return { success: false, error: 'Insufficient SOL for bridge' };
    }

    return await this.executeCrossChainSwap(baseWalletAddress, SOL_TO_BRIDGE);
  }

  /**
   * Bridge SOL (Solana) → USDC (Base) via Mayan Finance.
   *
   * Flow:
   *   1. Fetch best quote from Mayan Finance API
   *   2. Request the serialized swap transaction
   *   3. Sign with the agent's Solana keypair
   *   4. Submit and confirm on-chain
   *
   * @param {string} destinationAddress - EVM address on Base to receive USDC
   * @param {number} amountSol          - Amount of SOL to bridge
   */
  async executeCrossChainSwap(destinationAddress, amountSol) {
    if (!this.identity) throw new Error('No Solana identity loaded');

    const MAYAN_API   = 'https://price-api.mayan.finance/v3';
    const SOL_MINT    = 'So11111111111111111111111111111111111111112'; // Wrapped SOL
    const USDC_BASE   = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // USDC on Base
    const amountLamps = Math.round(amountSol * LAMPORTS_PER_SOL);

    console.log(`[Bridge] Fetching Mayan quote: ${amountSol} SOL → USDC on Base...`);

    // 1. Get quote
    const quoteRes = await axios.get(`${MAYAN_API}/quote`, {
      params: {
        amount:        amountSol,
        fromToken:     SOL_MINT,
        toToken:       USDC_BASE,
        fromChain:     'solana',
        toChain:       'base',
        slippageBps:   300,
        referrer:      null,
      },
    });

    const quotes = quoteRes.data;
    if (!quotes || quotes.length === 0) {
      throw new Error('Mayan Finance returned no quotes');
    }

    const bestQuote = quotes[0];
    const expectedOut = bestQuote.expectedAmountOut ?? bestQuote.minAmountOut;
    console.log(`[Bridge] Best quote: ${amountSol} SOL → ~${expectedOut} USDC`);

    // 2. Request serialized transaction
    const swapRes = await axios.post(`${MAYAN_API}/swap/solana`, {
      quote:              bestQuote,
      fromAddress:        this.identity.publicKey.toBase58(),
      toAddress:          destinationAddress,
      referrerAddress:    null,
      referrerBps:        0,
    });

    const { transaction: txBase64 } = swapRes.data;
    if (!txBase64) throw new Error('Mayan did not return a transaction');

    // 3. Deserialize and sign
    const txBytes  = Buffer.from(txBase64, 'base64');
    const tx       = VersionedTransaction.deserialize(txBytes);
    const { blockhash } = await this.connection.getLatestBlockhash('confirmed');
    tx.message.recentBlockhash = blockhash;
    tx.sign([this.identity]);

    // 4. Submit and confirm
    const signature = await this.connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    });

    console.log(`[Bridge] Transaction submitted: ${signature}`);
    await this.connection.confirmTransaction(signature, 'confirmed');
    console.log(`[Bridge] Confirmed: ${signature}`);

    return {
      success:  true,
      txHash:   signature,
      amount:   amountSol,
      expected: expectedOut,
    };
  }

  // ─── Jupiter Swaps (Solana-native) ───────────────────────────

  /**
   * Swap any SPL token on Solana using Jupiter aggregator.
   * Finds the best route across all Solana DEXes.
   *
   * @param {string} inputMint    - Mint address of the token to sell
   * @param {string} outputMint   - Mint address of the token to buy
   * @param {number} amount       - Amount in base units (lamports / token decimals)
   * @param {number} slippageBps  - Slippage tolerance in basis points (default: 50 = 0.5%)
   */
  async swap(inputMint, outputMint, amount, slippageBps = 50) {
    if (!this.identity) throw new Error('No Solana identity loaded');

    const JUPITER_API = 'https://quote-api.jup.ag/v6';

    console.log(`[Jupiter] Fetching quote: ${amount} ${inputMint} → ${outputMint}`);

    // 1. Get best route
    const quoteRes = await axios.get(`${JUPITER_API}/quote`, {
      params: { inputMint, outputMint, amount, slippageBps, onlyDirectRoutes: false },
    });
    const quote = quoteRes.data;
    console.log(`[Jupiter] Route found. Out amount: ${quote.outAmount}`);

    // 2. Get serialized swap transaction
    const swapRes = await axios.post(`${JUPITER_API}/swap`, {
      quoteResponse:         quote,
      userPublicKey:         this.identity.publicKey.toBase58(),
      wrapAndUnwrapSol:      true,
      prioritizationFeeLamports: 1000,
    });
    const { swapTransaction } = swapRes.data;

    // 3. Deserialize, sign, send
    const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
    tx.sign([this.identity]);

    const signature = await this.connection.sendRawTransaction(tx.serialize(), {
      skipPreflight:    false,
      maxRetries:       3,
    });

    console.log(`[Jupiter] Transaction submitted: ${signature}`);
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
    await this.connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
    console.log(`[Jupiter] Confirmed: ${signature}`);

    return {
      success:   true,
      txHash:    signature,
      inAmount:  amount,
      outAmount: quote.outAmount,
    };
  }

  // ─── Heartbeat Entry Point ────────────────────────────────────

  /**
   * Main entry point called by the heartbeat task.
   * Checks vital signs and triggers Life Support if needed.
   */
  async keepAlive(baseWalletAddress, currentUsdcBalance) {
    return await this.checkVitalSigns(baseWalletAddress, currentUsdcBalance);
  }
}

export default SolanaAutonomy;
