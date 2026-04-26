import {
  PublicKey,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import BN from "bn.js";
import { config } from "./config.js";
import { log } from "./logger.js";
import { fetchJsonWithRetry } from "./net.js";
import { getConnection, getWallet } from "./wallet.js";

let _DLMM = null;
const poolCache = new Map();
let openPositionsCache = null;
let openPositionsCacheAt = 0;

function normalizeTimestamp(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    return value > 1e12 ? value : value * 1000;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric > 1e12 ? numeric : numeric * 1000;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function getDLMM() {
  if (!_DLMM) {
    const mod = await import("@meteora-ag/dlmm");
    _DLMM = mod.default;
  }
  return _DLMM;
}

async function getPool(poolAddress) {
  const key = String(poolAddress);
  if (!poolCache.has(key)) {
    const DLMM = await getDLMM();
    const pool = await DLMM.create(getConnection(), new PublicKey(poolAddress));
    poolCache.set(key, pool);
  }
  return poolCache.get(key);
}

export async function getOpenPositions() {
  const walletAddress = getWallet().publicKey.toString();
  const portfolioUrl = `https://dlmm.datapi.meteora.ag/portfolio/open?user=${walletAddress}`;
  let portfolio;
  try {
    portfolio = await fetchJsonWithRetry(portfolioUrl, {
      label: "Meteora portfolio/open",
      retries: 3,
    });
  } catch (error) {
    if (openPositionsCache?.length) {
      const ageSec = Math.max(1, Math.round((Date.now() - openPositionsCacheAt) / 1000));
      log("warn", `Using cached open positions (${openPositionsCache.length}) after portfolio/open failure; cache age ${ageSec}s`);
      return openPositionsCache;
    }
    throw error;
  }
  const pools = portfolio.pools || [];
  const pnlMaps = await Promise.all(
    pools.map(async (pool) => {
      const url = `https://dlmm.datapi.meteora.ag/positions/${pool.poolAddress}/pnl?user=${walletAddress}&status=open&pageSize=100&page=1`;
      try {
        const data = await fetchJsonWithRetry(url, {
          label: `Meteora positions/pnl ${pool.poolAddress.slice(0, 8)}`,
          retries: 2,
        });
        const positions = data.positions || data.data || [];
        return Object.fromEntries(
          positions.map((p) => [
            p.positionAddress || p.address || p.position,
            p,
          ])
        );
      } catch (error) {
        log("warn", `Skipping pnl enrichment for pool ${pool.poolAddress.slice(0, 8)}: ${error.message}`);
        return {};
      }
    })
  );

  const result = [];
  for (const [index, pool] of pools.entries()) {
    const byAddress = pnlMaps[index];
    for (const positionAddress of pool.listPositions || []) {
      const pnlData = byAddress[positionAddress] || {};
      result.push({
        position: positionAddress,
        pool: pool.poolAddress,
        pair: `${pool.tokenX}/${pool.tokenY}`,
        baseMint: pool.tokenXMint,
        quoteMint: pool.tokenYMint,
        inRange: !pnlData.isOutOfRange,
        lowerBin: pnlData.lowerBinId ?? null,
        upperBin: pnlData.upperBinId ?? null,
        activeBin: pnlData.poolActiveBinId ?? null,
        createdAt: pnlData.createdAt ?? null,
        openedAtMs: normalizeTimestamp(pnlData.createdAt),
      });
    }
  }

  openPositionsCache = result;
  openPositionsCacheAt = Date.now();
  return result;
}

async function lookupPoolForPosition(positionAddress, walletAddress) {
  const positions = await getOpenPositions();
  const match = positions.find((p) => p.position === positionAddress);
  if (match?.pool) return match.pool;

  const DLMM = await getDLMM();
  const allPositions = await DLMM.getAllLbPairPositionsByUser(
    getConnection(),
    new PublicKey(walletAddress)
  );

  for (const [lbPairKey, positionData] of Object.entries(allPositions)) {
    for (const pos of positionData.lbPairPositionsData || []) {
      if (pos.publicKey.toString() === positionAddress) return lbPairKey;
    }
  }

  throw new Error(`Position ${positionAddress} not found`);
}

export async function closePosition({ positionAddress, reason = "exit signal" }) {
  if (!config.exitCloseFull) {
    throw new Error("EXIT_CLOSE_FULL is disabled");
  }

  if (config.dryRun) {
    return { dryRun: true, wouldClose: positionAddress, reason };
  }

  const wallet = getWallet();
  const poolAddress = await lookupPoolForPosition(positionAddress, wallet.publicKey.toString());
  poolCache.delete(poolAddress.toString());
  const pool = await getPool(poolAddress);
  const positionPubKey = new PublicKey(positionAddress);
  const claimTxHashes = [];
  const closeTxHashes = [];

  try {
    const positionData = await pool.getPosition(positionPubKey);
    const claimTxs = await pool.claimSwapFee({
      owner: wallet.publicKey,
      position: positionData,
    });
    for (const tx of claimTxs || []) {
      const claimHash = await sendAndConfirmTransaction(getConnection(), tx, [wallet]);
      claimTxHashes.push(claimHash);
    }
  } catch (error) {
    log("warn", `Fee claim skipped for ${positionAddress}: ${error.message}`);
  }

  let hasLiquidity = false;
  let fromBinId = -887272;
  let toBinId = 887272;

  try {
    const positionData = await pool.getPosition(positionPubKey);
    const processed = positionData?.positionData;
    if (processed) {
      fromBinId = processed.lowerBinId ?? fromBinId;
      toBinId = processed.upperBinId ?? toBinId;
      const bins = Array.isArray(processed.positionBinData) ? processed.positionBinData : [];
      hasLiquidity = bins.some((bin) => new BN(bin.positionLiquidity || "0").gt(new BN(0)));
    }
  } catch (error) {
    log("warn", `Could not inspect liquidity for ${positionAddress}: ${error.message}`);
  }

  if (hasLiquidity) {
    const closeTx = await pool.removeLiquidity({
      user: wallet.publicKey,
      position: positionPubKey,
      fromBinId,
      toBinId,
      bps: new BN(10000),
      shouldClaimAndClose: true,
    });
    for (const tx of Array.isArray(closeTx) ? closeTx : [closeTx]) {
      const hash = await sendAndConfirmTransaction(getConnection(), tx, [wallet]);
      closeTxHashes.push(hash);
    }
  } else {
    const closeTx = await pool.closePosition({
      owner: wallet.publicKey,
      position: { publicKey: positionPubKey },
    });
    const hash = await sendAndConfirmTransaction(getConnection(), closeTx, [wallet]);
    closeTxHashes.push(hash);
  }

  await new Promise((resolve) => setTimeout(resolve, 5000));

  return {
    success: true,
    position: positionAddress,
    pool: poolAddress,
    reason,
    claimTxs: claimTxHashes,
    closeTxs: closeTxHashes,
    txs: [...claimTxHashes, ...closeTxHashes],
  };
}
