import { config } from "./config.js";
import { log } from "./logger.js";
import { runMonitorLoop } from "./monitor.js";
import { formatTelegramMessage, sendTelegramMessage } from "./telegram.js";

log("info", `Starting DLMM Exit Bot | dryRun=${config.dryRun} | timeframe=${config.timeframe} | poll=${config.pollIntervalMinutes}m`);
if (config.telegram.notifyStartup) {
  sendTelegramMessage(
    formatTelegramMessage("DLMM Exit Bot Started", [
      { label: "Dry run", value: String(config.dryRun) },
      { label: "Timeframe", value: config.timeframe },
      { label: "Poll", value: `${config.pollIntervalMinutes}m` },
      { label: "Timezone", value: config.timezone },
    ]),
    { dedupeKey: "startup", dedupeMs: 5 * 60 * 1000 }
  ).catch(() => {});
}
runMonitorLoop().catch((error) => {
  log("error", `Fatal error: ${error.stack || error.message}`);
  if (config.telegram.notifyErrors) {
    sendTelegramMessage(
      formatTelegramMessage("FATAL ERROR", [
        { label: "Message", value: error.stack || error.message },
      ]),
      { dedupeKey: `fatal:${error.message}`, dedupeMs: 10 * 60 * 1000 }
    ).catch(() => {});
  }
  process.exit(1);
});
