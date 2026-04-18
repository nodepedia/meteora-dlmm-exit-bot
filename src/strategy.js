import { calculateBollingerBands, calculateMacd, calculateRsi } from "./indicators.js";

function getMinimumCandlesRequired(indicatorConfig) {
  const bbNeed = indicatorConfig.bbPeriod;
  const rsiNeed = indicatorConfig.rsiPeriod + 1;
  const macdNeed = indicatorConfig.macdSlow + indicatorConfig.macdSignal;
  return Math.max(bbNeed, rsiNeed, macdNeed);
}

export function evaluateExitSignal(candles, indicatorConfig) {
  if (!Array.isArray(candles) || candles.length === 0) {
    return { exit: false, reason: "No candles" };
  }

  const minCandles = getMinimumCandlesRequired(indicatorConfig);
  if (candles.length < minCandles) {
    return {
      exit: false,
      reason: `Not enough candles: got ${candles.length}, need at least ${minCandles}`,
      meta: { candlesReceived: candles.length, candlesRequired: minCandles },
    };
  }

  const closes = candles.map((c) => Number(c.close));
  const latest = candles[candles.length - 1];

  const bb = calculateBollingerBands(closes, indicatorConfig.bbPeriod, indicatorConfig.bbStdDev);
  const rsi = calculateRsi(closes, indicatorConfig.rsiPeriod);
  const macd = calculateMacd(
    closes,
    indicatorConfig.macdFast,
    indicatorConfig.macdSlow,
    indicatorConfig.macdSignal
  );

  if (!bb || rsi == null || !macd || macd.histogram.length < 2) {
    return {
      exit: false,
      reason: `Indicator warmup incomplete despite ${candles.length} candles`,
      meta: { candlesReceived: candles.length, candlesRequired: minCandles },
    };
  }

  const touchedUpperBand = Number(latest.high) >= bb.upper;
  const histogram = macd.histogram;
  const prevHist = histogram[histogram.length - 2];
  const currentHist = histogram[histogram.length - 1];
  const firstGreenBar = prevHist <= 0 && currentHist > 0;

  if (touchedUpperBand && rsi >= indicatorConfig.rsiExitThreshold) {
    return {
      exit: true,
      reason: `Upper BB touched and RSI(${indicatorConfig.rsiPeriod}) ${rsi.toFixed(2)} >= ${indicatorConfig.rsiExitThreshold}`,
      indicators: { bbUpper: bb.upper, rsi, macdHistogram: currentHist },
    };
  }

  if (touchedUpperBand && firstGreenBar) {
    return {
      exit: true,
      reason: `Upper BB touched and MACD histogram flipped red->green (${prevHist.toFixed(6)} -> ${currentHist.toFixed(6)})`,
      indicators: { bbUpper: bb.upper, rsi, macdHistogram: currentHist },
    };
  }

  return {
    exit: false,
    reason: "Exit conditions not met",
    indicators: { bbUpper: bb.upper, rsi, macdHistogram: currentHist },
  };
}
