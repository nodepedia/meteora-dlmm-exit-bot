import { config } from "./config.js";
import { log } from "./logger.js";
import { runMonitorLoop } from "./monitor.js";

log("info", `Starting DLMM Exit Bot | dryRun=${config.dryRun} | timeframe=${config.timeframe} | poll=${config.pollIntervalMinutes}m`);
runMonitorLoop().catch((error) => {
  log("error", `Fatal error: ${error.stack || error.message}`);
  process.exit(1);
});
