import { config } from "./config.js";
import { fetchJsonWithRetry } from "./net.js";

const METEORA_OHLCV_BASE = "https://dlmm.datapi.meteora.ag";
const candleCache = new Map();
const CANDLE_BUFFER = 10;

function formatTimeframe(timeframe) {
  const normalized = String(timeframe || "1H").trim().toLowerCase();
  const supported = new Set(["5m", "30m", "1h", "2h", "4h", "12h", "24h"]);
  if (!supported.has(normalized)) {
    throw new Error(`Unsupported Meteora timeframe: ${timeframe}`);
  }
  return normalized;
}

function getMinimumCandlesRequired(indicatorConfig) {
  const bbNeed = indicatorConfig.bbPeriod;
  const rsiNeed = indicatorConfig.rsiPeriod + 1;
  const macdNeed = indicatorConfig.macdSlow + indicatorConfig.macdSignal;
  return Math.max(bbNeed, rsiNeed, macdNeed);
}

function resolveTimeframeSeconds(timeframe) {
  switch (timeframe) {
    case "5m":
      return 5 * 60;
    case "30m":
      return 30 * 60;
    case "1h":
      return 60 * 60;
    case "2h":
      return 2 * 60 * 60;
    case "4h":
      return 4 * 60 * 60;
    case "12h":
      return 12 * 60 * 60;
    case "24h":
      return 24 * 60 * 60;
    default:
      return 60 * 60;
  }
}

function resolveLookbackSeconds(timeframe) {
  const minCandles = getMinimumCandlesRequired(config.indicators);
  const targetCandles = minCandles + CANDLE_BUFFER;
  return targetCandles * resolveTimeframeSeconds(timeframe);
}

function resolveChunkSeconds(timeframe) {
  const timeframeSeconds = resolveTimeframeSeconds(timeframe);
  const minCandles = getMinimumCandlesRequired(config.indicators);
  const targetCandles = minCandles + CANDLE_BUFFER;
  const targetSpan = targetCandles * timeframeSeconds;

  switch (timeframe) {
    case "5m":
      return Math.min(targetSpan, 8 * 60 * 60);
    case "30m":
      return Math.min(targetSpan, 36 * 60 * 60);
    case "1h":
      return Math.min(targetSpan, 36 * 60 * 60);
    case "2h":
      return Math.min(targetSpan, 3 * 24 * 60 * 60);
    case "4h":
      return Math.min(targetSpan, 5 * 24 * 60 * 60);
    case "12h":
      return Math.min(targetSpan, 14 * 24 * 60 * 60);
    case "24h":
      return Math.min(targetSpan, 30 * 24 * 60 * 60);
    default:
      return Math.min(targetSpan, 36 * 60 * 60);
  }
}

function normalizeCandles(candles) {
  return candles
    .map((candle) => ({
      time: candle.timestamp ?? candle.time ?? candle.t,
      open: Number(candle.open ?? candle.o),
      high: Number(candle.high ?? candle.h),
      low: Number(candle.low ?? candle.l),
      close: Number(candle.close ?? candle.c),
      volume: Number(candle.volume ?? candle.v ?? 0),
    }))
    .filter((c) => Number.isFinite(c.close) && Number.isFinite(c.high) && Number.isFinite(c.time))
    .sort((a, b) => a.time - b.time);
}

async function fetchWindow(poolAddress, timeframe, startTime, endTime) {
  const url = `${METEORA_OHLCV_BASE}/pools/${encodeURIComponent(poolAddress)}/ohlcv?timeframe=${encodeURIComponent(timeframe)}&start_time=${startTime}&end_time=${endTime}`;
  const data = await fetchJsonWithRetry(url, {
    label: `Meteora OHLCV ${poolAddress.slice(0, 8)} [${startTime}-${endTime}]`,
    retries: 3,
    retryDelayMs: 900,
  });
  return normalizeCandles(data.data || []);
}

function mergeCandles(chunks) {
  const byTime = new Map();
  for (const chunk of chunks) {
    for (const candle of chunk) {
      byTime.set(candle.time, candle);
    }
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

async function getMeteoraPoolCandles(poolAddress) {
  const timeframe = formatTimeframe(config.timeframe);
  const endTime = Math.floor(Date.now() / 1000);
  const lookbackSeconds = resolveLookbackSeconds(timeframe);
  const chunkSeconds = resolveChunkSeconds(timeframe);
  const startTime = endTime - lookbackSeconds;

  const chunks = [];
  let cursor = startTime;
  while (cursor < endTime) {
    const next = Math.min(cursor + chunkSeconds, endTime);
    chunks.push([cursor, next]);
    cursor = next;
  }

  const fetched = [];
  let successCount = 0;
  let lastError = null;

  for (const [from, to] of chunks) {
    try {
      const candles = await fetchWindow(poolAddress, timeframe, from, to);
      if (candles.length > 0) {
        fetched.push(candles);
      }
      successCount++;
    } catch (error) {
      lastError = error;
      const span = to - from;
      if (/time range too large/i.test(error.message) && span > 6 * 60 * 60) {
        const mid = Math.floor((from + to) / 2);
        const left = await fetchWindow(poolAddress, timeframe, from, mid).catch(() => []);
        const right = await fetchWindow(poolAddress, timeframe, mid, to).catch(() => []);
        if (left.length > 0) fetched.push(left);
        if (right.length > 0) fetched.push(right);
        successCount++;
        continue;
      }
    }
  }

  const merged = mergeCandles(fetched);
  if (merged.length > 0) {
    const minCandles = getMinimumCandlesRequired(config.indicators);
    const targetCandles = minCandles + CANDLE_BUFFER;
    const trimmed = merged.length > targetCandles ? merged.slice(-targetCandles) : merged;
    candleCache.set(poolAddress, {
      candles: trimmed,
      cachedAt: Date.now(),
      partial: successCount < chunks.length,
    });
    return {
      source: successCount < chunks.length ? "meteora-partial" : "meteora",
      candles: trimmed,
      partial: successCount < chunks.length,
    };
  }

  const cached = candleCache.get(poolAddress);
  if (cached?.candles?.length) {
    return {
      source: "meteora-cache",
      candles: cached.candles,
      partial: true,
      cachedAt: cached.cachedAt,
    };
  }

  throw new Error(lastError?.message || "Meteora OHLCV request failed and no cache is available");
}

export async function getPoolCandles({ poolAddress }) {
  if (config.candleSource !== "meteora") {
    throw new Error(`Unsupported candle source: ${config.candleSource}`);
  }
  return getMeteoraPoolCandles(poolAddress);
}
