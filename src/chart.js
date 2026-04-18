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

export async function getPoolCandles({ poolAddress }) {
  if (config.candleSource !== "meteora") {
    throw new Error(`Unsupported candle source: ${config.candleSource}`);
  }

  const timeframe = formatTimeframe(config.timeframe);
  const url = `${METEORA_OHLCV_BASE}/pools/${encodeURIComponent(poolAddress)}/ohlcv?timeframe=${encodeURIComponent(timeframe)}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Meteora OHLCV request failed: ${res.status} ${await res.text()}`);
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
  })).filter((c) => Number.isFinite(c.close) && Number.isFinite(c.high));
}
