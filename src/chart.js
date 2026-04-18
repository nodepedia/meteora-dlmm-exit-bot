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

function normalizeJupiterInterval(timeframe) {
  const value = String(timeframe || "1H").trim().toUpperCase();
  if (/^\d+[MHDW]$/.test(value)) return value;
  return value === "1H" ? "1H" : value;
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

async function getMeteoraPoolCandles(poolAddress) {
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
    return {
      source: "meteora",
      candles: normalizeCandles(data.data || []),
    };
  }

  throw new Error(lastError || "Meteora OHLCV request failed after all lookback attempts");
}

async function getJupiterFallbackCandles(baseMint) {
  if (!config.chart.fallbackToJupiter) {
    throw new Error("Jupiter chart fallback is disabled");
  }
  if (!config.chart.jupiterCandleUrlTemplate) {
    throw new Error("JUPITER_CANDLE_URL_TEMPLATE is not set");
  }

  const url = config.chart.jupiterCandleUrlTemplate
    .replaceAll("{mint}", encodeURIComponent(baseMint))
    .replaceAll("{interval}", encodeURIComponent(normalizeJupiterInterval(config.timeframe)))
    .replaceAll("{limit}", encodeURIComponent("120"));

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Jupiter candle fallback failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return {
    source: "jupiter",
    candles: normalizeCandles(data.candles || data.data || data.items || []),
  };
}

export async function getPoolCandles({ poolAddress, baseMint }) {
  try {
    return await getMeteoraPoolCandles(poolAddress);
  } catch (meteoraError) {
    if (!config.chart.fallbackToJupiter) {
      throw meteoraError;
    }
    if (!baseMint) {
      throw meteoraError;
    }

    try {
      return await getJupiterFallbackCandles(baseMint);
    } catch (jupiterError) {
      throw new Error(`Meteora failed (${meteoraError.message}); Jupiter fallback failed (${jupiterError.message})`);
    }
  }
}
