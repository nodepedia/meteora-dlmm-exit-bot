import { config } from "./config.js";
import { getPoolCandles } from "./chart.js";
import { log } from "./logger.js";
import { closePosition, getOpenPositions } from "./meteora.js";
import { evaluateExitSignal } from "./strategy.js";
import { getWalletBalances, swapToken } from "./wallet.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function maybeSwapToSol(baseMint) {
  if (!config.exitSwapToSol || !baseMint) return null;

  const balances = await getWalletBalances();
  const token = balances.tokens.find((t) => t.mint === baseMint && t.balance > 0);
  if (!token) return null;

  return swapToken({
    inputMint: baseMint,
    outputMint: "SOL",
    amount: token.balance,
  });
}

async function processPosition(position) {
  log("info", `Evaluating ${position.pair} (${position.position})`);

  const candles = await getPoolCandles({ poolAddress: position.pool });
  log("info", `${position.pair}: received ${candles.length} candle(s) from Meteora OHLCV`);
  const decision = evaluateExitSignal(candles, config.indicators);

  if (!decision.exit) {
    log("info", `${position.pair}: hold (${decision.reason})`);
    return { action: "HOLD", reason: decision.reason };
  }

  log("info", `${position.pair}: exit triggered (${decision.reason})`);
  const closeResult = await closePosition({
    positionAddress: position.position,
    reason: decision.reason,
  });

  let swapResult = null;
  if (config.exitSwapToSol) {
    swapResult = await maybeSwapToSol(position.baseMint);
  }

  return { action: "EXIT", reason: decision.reason, closeResult, swapResult };
}

export async function runMonitorLoop() {
  const intervalMs = config.pollIntervalMinutes * 60 * 1000;

  while (true) {
    try {
      const positions = await getOpenPositions();

      if (!positions.length) {
        log("info", `No open DLMM positions. Sleeping ${config.pollIntervalMinutes} minute(s).`);
      } else {
        log("info", `Found ${positions.length} open position(s).`);
        for (const position of positions) {
          try {
            await processPosition(position);
          } catch (error) {
            log("error", `Failed processing ${position.position}: ${error.message}`);
          }
        }
      }
    } catch (error) {
      log("error", `Monitor loop failed: ${error.message}`);
    }

    await sleep(intervalMs);
  }
}
