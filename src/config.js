import dotenv from "dotenv";

dotenv.config();

function toBool(value, fallback = false) {
  if (value == null || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function toNum(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export const config = {
  walletPrivateKey: required("WALLET_PRIVATE_KEY"),
  rpcUrl: required("RPC_URL"),
  heliusApiKey: required("HELIUS_API_KEY"),
  dryRun: toBool(process.env.DRY_RUN, true),
  logLevel: process.env.LOG_LEVEL || "info",
  pollIntervalMinutes: toNum(process.env.POLL_INTERVAL_MINUTES, 5),
  timeframe: process.env.TIMEFRAME || "1H",
  candleSource: process.env.CANDLE_SOURCE || "meteora",
  bbTouchRule: process.env.BB_TOUCH_RULE || "high_gte_upper_band",
  macdGreenRule: process.env.MACD_GREEN_RULE || "first_histogram_red_to_green",
  exitCloseFull: toBool(process.env.EXIT_CLOSE_FULL, true),
  exitSwapToSol: toBool(process.env.EXIT_SWAP_TO_SOL, true),
  indicators: {
    bbPeriod: toNum(process.env.BB_PERIOD, 20),
    bbStdDev: toNum(process.env.BB_STDDEV, 2),
    rsiPeriod: toNum(process.env.RSI_PERIOD, 2),
    rsiExitThreshold: toNum(process.env.RSI_EXIT_THRESHOLD, 90),
    macdFast: toNum(process.env.MACD_FAST, 12),
    macdSlow: toNum(process.env.MACD_SLOW, 26),
    macdSignal: toNum(process.env.MACD_SIGNAL, 9),
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || "",
    chatId: process.env.TELEGRAM_CHAT_ID || "",
    notifyStartup: toBool(process.env.TELEGRAM_NOTIFY_STARTUP, true),
    notifyHold: toBool(process.env.TELEGRAM_NOTIFY_HOLD, false),
    notifyErrors: toBool(process.env.TELEGRAM_NOTIFY_ERRORS, true),
  },
  tokens: {
    SOL: "So11111111111111111111111111111111111111112",
  },
};
