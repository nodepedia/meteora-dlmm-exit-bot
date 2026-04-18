import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { config } from "./config.js";
import { log } from "./logger.js";

const JUPITER_ULTRA_API = "https://api.jup.ag/ultra/v1";
const JUPITER_QUOTE_API = "https://api.jup.ag/swap/v1";
const JUPITER_API_KEY = process.env.JUPITER_API_KEY || "";

let _connection = null;
let _wallet = null;

export function getConnection() {
  if (!_connection) {
    _connection = new Connection(config.rpcUrl, "confirmed");
  }
  return _connection;
}

export function getWallet() {
  if (!_wallet) {
    _wallet = Keypair.fromSecretKey(bs58.decode(config.walletPrivateKey));
  }
  return _wallet;
}

export function normalizeMint(mint) {
  if (!mint) return mint;
  if (mint === "SOL" || mint === "native") return config.tokens.SOL;
  return mint;
}

export async function getWalletBalances() {
  const walletAddress = getWallet().publicKey.toString();
  const url = `https://api.helius.xyz/v1/wallet/${walletAddress}/balances?api-key=${config.heliusApiKey}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Helius wallet balances failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const balances = data.balances || [];

  return {
    wallet: walletAddress,
    tokens: balances.map((b) => ({
      mint: b.mint,
      symbol: b.symbol || b.mint?.slice(0, 8),
      balance: Number(b.balance || 0),
      usd: Number(b.usdValue || 0),
    })),
  };
}

export async function swapToken({ inputMint, outputMint, amount }) {
  inputMint = normalizeMint(inputMint);
  outputMint = normalizeMint(outputMint);

  if (config.dryRun) {
    return {
      dryRun: true,
      wouldSwap: { inputMint, outputMint, amount },
    };
  }

  const wallet = getWallet();
  const connection = getConnection();

  let decimals = 9;
  if (inputMint !== config.tokens.SOL) {
    const mintInfo = await connection.getParsedAccountInfo(new PublicKey(inputMint));
    decimals = mintInfo.value?.data?.parsed?.info?.decimals ?? 9;
  }
  const amountStr = Math.floor(amount * Math.pow(10, decimals)).toString();

  const orderUrl =
    `${JUPITER_ULTRA_API}/order?inputMint=${inputMint}` +
    `&outputMint=${outputMint}` +
    `&amount=${amountStr}` +
    `&taker=${wallet.publicKey.toString()}`;

  const commonHeaders = JUPITER_API_KEY ? { "x-api-key": JUPITER_API_KEY } : {};
  const orderRes = await fetch(orderUrl, { headers: commonHeaders });
  if (!orderRes.ok) {
    log("warn", `Ultra order failed with ${orderRes.status}, falling back to quote API`);
    return swapViaQuoteApi({ wallet, connection, inputMint, outputMint, amountStr, headers: commonHeaders });
  }

  const order = await orderRes.json();
  if (order.errorCode || order.errorMessage) {
    log("warn", "Ultra returned error payload, falling back to quote API");
    return swapViaQuoteApi({ wallet, connection, inputMint, outputMint, amountStr, headers: commonHeaders });
  }

  const tx = VersionedTransaction.deserialize(Buffer.from(order.transaction, "base64"));
  tx.sign([wallet]);
  const signedTx = Buffer.from(tx.serialize()).toString("base64");

  const execRes = await fetch(`${JUPITER_ULTRA_API}/execute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...commonHeaders,
    },
    body: JSON.stringify({ signedTransaction: signedTx, requestId: order.requestId }),
  });

  if (!execRes.ok) {
    throw new Error(`Ultra execute failed: ${execRes.status} ${await execRes.text()}`);
  }

  const result = await execRes.json();
  if (result.status === "Failed") {
    throw new Error(`Swap failed on-chain: ${result.code}`);
  }

  return { success: true, tx: result.signature, inputMint, outputMint };
}

async function swapViaQuoteApi({ wallet, connection, inputMint, outputMint, amountStr, headers }) {
  const quoteRes = await fetch(
    `${JUPITER_QUOTE_API}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountStr}&slippageBps=300`,
    { headers }
  );
  if (!quoteRes.ok) {
    throw new Error(`Quote failed: ${quoteRes.status} ${await quoteRes.text()}`);
  }
  const quote = await quoteRes.json();

  const swapRes = await fetch(`${JUPITER_QUOTE_API}/swap`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: wallet.publicKey.toString(),
      wrapAndUnwrapSol: true,
    }),
  });

  if (!swapRes.ok) {
    throw new Error(`Swap tx failed: ${swapRes.status} ${await swapRes.text()}`);
  }

  const { swapTransaction } = await swapRes.json();
  const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, "base64"));
  tx.sign([wallet]);
  const txHash = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  await connection.confirmTransaction(txHash, "confirmed");
  return { success: true, tx: txHash, inputMint, outputMint };
}
