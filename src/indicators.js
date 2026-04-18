function sma(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stddev(values, mean) {
  if (!values.length) return null;
  const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function ema(values, period) {
  if (values.length < period) return [];
  const multiplier = 2 / (period + 1);
  const result = [];
  let prev = sma(values.slice(0, period));
  result.push(prev);

  for (let i = period; i < values.length; i++) {
    prev = (values[i] - prev) * multiplier + prev;
    result.push(prev);
  }
  return result;
}

export function calculateBollingerBands(closes, period = 20, multiplier = 2) {
  if (closes.length < period) return null;
  const window = closes.slice(-period);
  const middle = sma(window);
  const deviation = stddev(window, middle);
  return {
    middle,
    upper: middle + deviation * multiplier,
    lower: middle - deviation * multiplier,
  };
}

export function calculateRsi(closes, period = 14) {
  if (closes.length < period + 1) return null;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) gains += change;
    else losses += Math.abs(change);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

export function calculateMacd(closes, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  if (closes.length < slowPeriod + signalPeriod) return null;

  const fast = ema(closes, fastPeriod);
  const slow = ema(closes, slowPeriod);
  const offset = slowPeriod - fastPeriod;
  const macdLine = [];

  for (let i = 0; i < slow.length; i++) {
    macdLine.push(fast[i + offset] - slow[i]);
  }

  const signalLine = ema(macdLine, signalPeriod);
  const histOffset = macdLine.length - signalLine.length;
  const histogram = signalLine.map((signalValue, index) => macdLine[index + histOffset] - signalValue);

  return {
    macdLine,
    signalLine,
    histogram,
  };
}
