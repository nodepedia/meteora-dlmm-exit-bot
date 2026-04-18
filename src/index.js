import { config } from "./config.js";
import { log } from "./logger.js";
import { runMonitorLoop } from "./monitor.js";
import { sendTelegramMessage } from "./telegram.js";

log("info", `Starting DLMM Exit Bot | dryRun=${config.dryRun} | timeframe=${config.timeframe} | poll=${config.pollIntervalMinutes}m`);
if (config.telegram.notifyStartup) {
  sendTelegramMessage(
    `DLMM Exit Bot started\nDry run: ${config.dryRun}\nTimeframe: ${config.timeframe}\nPoll: ${config.pollIntervalMinutes}m`,
    { dedupeKey: "startup", dedupeMs: 5 * 60 * 1000 }
  ).catch(() => {});
}
runMonitorLoop().catch((error) => {
  log("error", `Fatal error: ${error.stack || error.message}`);
  if (config.telegram.notifyErrors) {
    sendTelegramMessage(
      `FATAL ERROR\nMessage: ${error.stack || error.message}`,
      { dedupeKey: `fatal:${error.message}`, dedupeMs: 10 * 60 * 1000 }
    ).catch(() => {});
  }
  process.exit(1);
});
