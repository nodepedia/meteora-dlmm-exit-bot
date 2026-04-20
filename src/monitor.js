import { config } from "./config.js";
import { getPoolCandles } from "./chart.js";
import { log } from "./logger.js";
import { closePosition, getOpenPositions } from "./meteora.js";
import { evaluateExitSignal } from "./strategy.js";
import { formatTelegramMessage, formatTelegramReportMessage, sendTelegramMessage } from "./telegram.js";
import { getWalletBalances, swapToken } from "./wallet.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatLocalTime() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: config.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
}

function compactReason(reason) {
  if (!reason) return "-";
  if (/not enough candles/i.test(reason)) return "WARMUP";
  if (/indicator warmup/i.test(reason)) return "WARMUP";
  if (/exit conditions not met/i.test(reason)) return "WAIT";
  if (/rsi/i.test(reason)) return "EXIT_RSI";
  if (/macd/i.test(reason)) return "EXIT_MACD";
  if (/stop loss/i.test(reason)) return "STOP";
  return String(reason).slice(0, 12).toUpperCase();
}

function compactSource(source) {
  if (!source) return "-";
  if (source === "meteora") return "MTR";
  if (source === "meteora-partial") return "MTR-P";
  if (source === "meteora-cache") return "CACHE";
  return String(source).slice(0, 6).toUpperCase();
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
              compactReason(item.reason),
              item.candles ?? "-",
              compactSource(item.source),
            ]);

          if (summaryRows.length > 0) {
            const holdCount = cycleResults.filter((item) => item?.action === "HOLD").length;
            const exitCount = cycleResults.filter((item) => item?.action === "EXIT").length;
            await sendTelegramMessage(
              formatTelegramReportMessage(
                "📊 DLMM POSITION REPORT",
                [
                  `🕒 Time: ${formatLocalTime()}`,
                  `📦 Total: ${summaryRows.length} | 🟢 Hold: ${holdCount} | 🔴 Exit: ${exitCount}`,
                ],
                [
                  { header: "PAIR", width: 12 },
                  { header: "ACT", width: 6 },
                  { header: "SIG", width: 10 },
                  { header: "CDL", width: 4 },
                  { header: "SRC", width: 5 },
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
