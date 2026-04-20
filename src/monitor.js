import { config } from "./config.js";
import { getPoolCandles } from "./chart.js";
import { log } from "./logger.js";
import { closePosition, getOpenPositions } from "./meteora.js";
import { evaluateExitSignal } from "./strategy.js";
import { formatTelegramMessage, formatTelegramTableMessage, sendTelegramMessage } from "./telegram.js";
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
    return {
      action: "HOLD",
      reason: decision.reason,
      pair: position.pair,
      position: position.position,
      candles: chart.candles.length,
      source: chart.source,
    };
  }

  log("info", `${position.pair}: exit triggered (${decision.reason})`);
  await sendTelegramMessage(
    formatTelegramMessage("EXIT TRIGGERED", [
      { label: "Pair", value: position.pair },
      { label: "Position", value: position.position, code: true },
      { label: "Reason", value: decision.reason },
    ], "Exit signal confirmed. Bot is executing close flow."),
    { dedupeKey: `exit-trigger:${position.position}:${decision.reason}`, dedupeMs: 15 * 60 * 1000 }
  );
  const closeResult = await closePosition({
    positionAddress: position.position,
    reason: decision.reason,
  });

  await sendTelegramMessage(
    formatTelegramMessage(`CLOSE ${closeResult?.success ? "SUCCESS" : "RESULT"}`, [
      { label: "Pair", value: position.pair },
      { label: "Position", value: position.position, code: true },
      { label: "Reason", value: decision.reason },
      { label: "Txs", value: closeResult?.txs?.join(", ") || "-", code: true },
    ]),
    { dedupeKey: `close:${position.position}:${closeResult?.txs?.[0] || decision.reason}`, dedupeMs: 24 * 60 * 60 * 1000 }
  );

  let swapResult = null;
  if (config.exitSwapToSol) {
    swapResult = await maybeSwapToSol(position.baseMint);
    if (swapResult?.success || swapResult?.dryRun) {
      await sendTelegramMessage(
        formatTelegramMessage(`SWAP TO SOL ${swapResult?.dryRun ? "DRY RUN" : "SUCCESS"}`, [
          { label: "Pair", value: position.pair },
          { label: "Mint", value: position.baseMint, code: true },
          { label: "Tx", value: swapResult?.tx || "-", code: true },
        ]),
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
        const cycleResults = [];
        for (const position of positions) {
          try {
            const result = await processPosition(position);
            cycleResults.push(result);
          } catch (error) {
            log("error", `Failed processing ${position.position}: ${error.message}`);
            if (config.telegram.notifyErrors) {
              await sendTelegramMessage(
                formatTelegramMessage("ERROR", [
                  { label: "Scope", value: "processPosition" },
                  { label: "Position", value: position.position, code: true },
                  { label: "Message", value: error.message },
                ]),
                { dedupeKey: `proc-error:${position.position}:${error.message}`, dedupeMs: 10 * 60 * 1000 }
              );
            }
          }
        }

        if (config.telegram.notifyHold) {
          const summaryRows = cycleResults
            .filter((item) => item?.pair)
            .map((item) => [
              item.pair,
              item.action,
              item.candles ?? "-",
              item.source ?? "-",
              item.reason ?? "-",
            ]);

          if (summaryRows.length > 0) {
            await sendTelegramMessage(
              formatTelegramTableMessage(
                "POSITION SUMMARY",
                [
                  { header: "Pair", width: 14 },
                  { header: "Status", width: 8 },
                  { header: "Candles", width: 7 },
                  { header: "Src", width: 14 },
                  { header: "Reason", width: 28 },
                ],
                summaryRows,
                `Polling every ${config.pollIntervalMinutes}m`
              ),
              { dedupeKey: `summary:${summaryRows.map((row) => row.join("|")).join("||")}`, dedupeMs: 30 * 60 * 1000 }
            );
          }
        }
      }
    } catch (error) {
      log("error", `Monitor loop failed: ${error.message}`);
      if (config.telegram.notifyErrors) {
        await sendTelegramMessage(
          formatTelegramMessage("ERROR", [
            { label: "Scope", value: "monitorLoop" },
            { label: "Message", value: error.message },
          ]),
          { dedupeKey: `loop-error:${error.message}`, dedupeMs: 10 * 60 * 1000 }
        );
      }
    }

    await sleep(intervalMs);
  }
}
