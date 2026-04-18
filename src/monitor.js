import { config } from "./config.js";
import { getPoolCandles } from "./chart.js";
import { log } from "./logger.js";
import { closePosition, getOpenPositions } from "./meteora.js";
import { evaluateExitSignal } from "./strategy.js";
import { sendTelegramMessage } from "./telegram.js";
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

  const chart = await getPoolCandles({ poolAddress: position.pool });
  log("info", `${position.pair}: received ${chart.candles.length} candle(s) from ${chart.source}`);
  const decision = evaluateExitSignal(chart.candles, config.indicators);

  if (!decision.exit) {
    log("info", `${position.pair}: hold (${decision.reason})`);
    if (config.telegram.notifyHold) {
      await sendTelegramMessage(
        `HOLD\nPair: ${position.pair}\nPosition: ${position.position}\nReason: ${decision.reason}`,
        { dedupeKey: `hold:${position.position}:${decision.reason}`, dedupeMs: 30 * 60 * 1000 }
      );
    }
    return { action: "HOLD", reason: decision.reason };
  }

  log("info", `${position.pair}: exit triggered (${decision.reason})`);
  await sendTelegramMessage(
    `EXIT TRIGGERED\nPair: ${position.pair}\nPosition: ${position.position}\nReason: ${decision.reason}`,
    { dedupeKey: `exit-trigger:${position.position}:${decision.reason}`, dedupeMs: 15 * 60 * 1000 }
  );
  const closeResult = await closePosition({
    positionAddress: position.position,
    reason: decision.reason,
  });

  await sendTelegramMessage(
    `CLOSE ${closeResult?.success ? "SUCCESS" : "RESULT"}\nPair: ${position.pair}\nPosition: ${position.position}\nReason: ${decision.reason}\nTxs: ${closeResult?.txs?.join(", ") || "-"}`,
    { dedupeKey: `close:${position.position}:${closeResult?.txs?.[0] || decision.reason}`, dedupeMs: 24 * 60 * 60 * 1000 }
  );

  let swapResult = null;
  if (config.exitSwapToSol) {
    swapResult = await maybeSwapToSol(position.baseMint);
    if (swapResult?.success || swapResult?.dryRun) {
      await sendTelegramMessage(
        `SWAP TO SOL ${swapResult?.dryRun ? "DRY RUN" : "SUCCESS"}\nPair: ${position.pair}\nMint: ${position.baseMint}\nTx: ${swapResult?.tx || "-"}`,
        { dedupeKey: `swap:${position.position}:${swapResult?.tx || "dry-run"}`, dedupeMs: 24 * 60 * 60 * 1000 }
      );
    }
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
            if (config.telegram.notifyErrors) {
              await sendTelegramMessage(
                `ERROR\nScope: processPosition\nPosition: ${position.position}\nMessage: ${error.message}`,
                { dedupeKey: `proc-error:${position.position}:${error.message}`, dedupeMs: 10 * 60 * 1000 }
              );
            }
          }
        }
      }
    } catch (error) {
      log("error", `Monitor loop failed: ${error.message}`);
      if (config.telegram.notifyErrors) {
        await sendTelegramMessage(
          `ERROR\nScope: monitorLoop\nMessage: ${error.message}`,
          { dedupeKey: `loop-error:${error.message}`, dedupeMs: 10 * 60 * 1000 }
        );
      }
    }

    await sleep(intervalMs);
  }
}
