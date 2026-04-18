import { config } from "./config.js";

const METEORA_OHLCV_BASE = "https://dlmm.datapi.meteora.ag";

function formatTimeframe(timeframe) {
  const normalized = String(timeframe || "1H").trim().toLowerCase();
  const supported = new Set(["5m", "30m", "1h", "2h", "4h", "12h", "24h"]);
  if (!supported.has(normalized)) {
    throw new Error(`Unsupported Meteora timeframe: ${timeframe}`);
  }
  return normalized;
}

function resolveLookbackSeconds(timeframe) {
  switch (timeframe) {
    case "5m":
      return 2 * 24 * 60 * 60;
    case "30m":
      return 5 * 24 * 60 * 60;
    case "1h":
      return 7 * 24 * 60 * 60;
    case "2h":
      return 10 * 24 * 60 * 60;
    case "4h":
      return 21 * 24 * 60 * 60;
    case "12h":
      return 60 * 24 * 60 * 60;
    case "24h":
      return 120 * 24 * 60 * 60;
    default:
      return 7 * 24 * 60 * 60;
  }
}

function buildLookbackAttempts(preferredSeconds) {
  const attempts = [
    preferredSeconds,
    Math.floor(preferredSeconds / 2),
    Math.floor(preferredSeconds / 4),
    3 * 24 * 60 * 60,
    2 * 24 * 60 * 60,
    36 * 60 * 60,
    24 * 60 * 60,
  ];

  return [...new Set(attempts.filter((value) => Number.isFinite(value) && value > 0))];
}

export async function getPoolCandles({ poolAddress }) {
  if (config.candleSource !== "meteora") {
    throw new Error(`Unsupported candle source: ${config.candleSource}`);
  }

  const timeframe = formatTimeframe(config.timeframe);
  const endTime = Math.floor(Date.now() / 1000);
  const attempts = buildLookbackAttempts(resolveLookbackSeconds(timeframe));

  let lastError = null;
  for (const lookbackSeconds of attempts) {
    const startTime = endTime - lookbackSeconds;
    const url = `${METEORA_OHLCV_BASE}/pools/${encodeURIComponent(poolAddress)}/ohlcv?timeframe=${encodeURIComponent(timeframe)}&start_time=${startTime}&end_time=${endTime}`;

    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text();
      lastError = `Meteora OHLCV request failed: ${res.status} ${body}`;

      if (res.status === 400 && /time range too large/i.test(body)) {
        continue;
      }
      throw new Error(lastError);
    }

    const data = await res.json();
    const candles = data.data || [];

    return candles.map((candle) => ({
      time: candle.timestamp,
      open: Number(candle.open),
      high: Number(candle.high),
      low: Number(candle.low),
      close: Number(candle.close),
      volume: Number(candle.volume || 0),
    }))
      .filter((c) => Number.isFinite(c.close) && Number.isFinite(c.high))
      .sort((a, b) => a.time - b.time);
  }

  throw new Error(lastError || "Meteora OHLCV request failed after all lookback attempts");
}
