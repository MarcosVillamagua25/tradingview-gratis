import type { Candle } from "@/lib/binance/types";

export interface IndicatorPoint {
  time: number;
  value: number;
}

export interface MACDPoint {
  time: number;
  macd: number;
  signal: number;
  histogram: number;
}

export interface ADXPoint {
  time: number;
  adx: number;
  plusDI: number;
  minusDI: number;
}

export interface SqueezePoint {
  time: number;
  value: number;
  zero: number;
  squeezeOn: boolean;
  squeezeOff: boolean;
  noSqz: boolean;
}

export interface BollingerPoint {
  time: number;
  upper: number;
  middle: number;
  lower: number;
}

/**
 * Simple Moving Average
 */
export function sma(candles: Candle[], period: number): IndicatorPoint[] {
  const out: IndicatorPoint[] = [];
  if (candles.length < period) return out;
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= period) sum -= candles[i - period].close;
    if (i >= period - 1) out.push({ time: candles[i].time, value: sum / period });
  }
  return out;
}

export function stdev(candles: Candle[], period: number): IndicatorPoint[] {
  const out: IndicatorPoint[] = [];
  if (candles.length < period) return out;
  let sum = 0;
  let sumSquares = 0;
  for (let i = 0; i < candles.length; i++) {
    const close = candles[i].close;
    sum += close;
    sumSquares += close * close;
    if (i >= period) {
      const outgoing = candles[i - period].close;
      sum -= outgoing;
      sumSquares -= outgoing * outgoing;
    }
    if (i >= period - 1) {
      const mean = sum / period;
      const variance = Math.max(0, sumSquares / period - mean * mean);
      out.push({ time: candles[i].time, value: Math.sqrt(variance) });
    }
  }
  return out;
}

/**
 * Exponential Moving Average — seeded with SMA of first `period` candles.
 */
export function ema(candles: Candle[], period: number): IndicatorPoint[] {
  const out: IndicatorPoint[] = [];
  if (candles.length < period) return out;
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < period; i++) prev += candles[i].close;
  prev /= period;
  out.push({ time: candles[period - 1].time, value: prev });
  for (let i = period; i < candles.length; i++) {
    prev = candles[i].close * k + prev * (1 - k);
    out.push({ time: candles[i].time, value: prev });
  }
  return out;
}

/**
 * RSI (Wilder) — period typically 14.
 */
export function rsi(candles: Candle[], period = 14): IndicatorPoint[] {
  const out: IndicatorPoint[] = [];
  if (candles.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  gain /= period;
  loss /= period;
  let rs = loss === 0 ? 100 : gain / loss;
  out.push({ time: candles[period].time, value: 100 - 100 / (1 + rs) });
  for (let i = period + 1; i < candles.length; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    gain = (gain * (period - 1) + g) / period;
    loss = (loss * (period - 1) + l) / period;
    rs = loss === 0 ? 100 : gain / loss;
    out.push({ time: candles[i].time, value: 100 - 100 / (1 + rs) });
  }
  return out;
}

/**
 * MACD — fast EMA, slow EMA, signal EMA of the MACD line.
 * Defaults: 12 / 26 / 9.
 */
export function macd(
  candles: Candle[],
  fast = 12,
  slow = 26,
  signal = 9,
): MACDPoint[] {
  if (candles.length < slow + signal) return [];
  const emaFast = ema(candles, fast);
  const emaSlow = ema(candles, slow);
  // align: emaSlow starts later
  const slowStartTime = emaSlow[0].time;
  const fastByTime = new Map(emaFast.map((p) => [p.time, p.value]));
  const macdLine: IndicatorPoint[] = [];
  for (const p of emaSlow) {
    const f = fastByTime.get(p.time);
    if (f !== undefined) macdLine.push({ time: p.time, value: f - p.value });
  }
  // signal = EMA of MACD line. Build synthetic candles for ema()
  const synth: Candle[] = macdLine.map((p) => ({
    time: p.time,
    open: p.value,
    high: p.value,
    low: p.value,
    close: p.value,
    volume: 0,
  }));
  const sig = ema(synth, signal);
  const sigByTime = new Map(sig.map((p) => [p.time, p.value]));
  const out: MACDPoint[] = [];
  for (const p of macdLine) {
    const s = sigByTime.get(p.time);
    if (s === undefined) continue;
    out.push({ time: p.time, macd: p.value, signal: s, histogram: p.value - s });
  }
  void slowStartTime;
  return out;
}

/**
 * Bollinger Bands — middle = SMA, upper/lower = middle +/- stdDev * sigma.
 */
export function bollinger(
  candles: Candle[],
  period = 20,
  stdDev = 2,
): BollingerPoint[] {
  if (candles.length < period) return [];

  const out: BollingerPoint[] = [];
  let sum = 0;
  let sumSquares = 0;

  for (let i = 0; i < candles.length; i++) {
    const close = candles[i].close;
    sum += close;
    sumSquares += close * close;

    if (i >= period) {
      const outgoing = candles[i - period].close;
      sum -= outgoing;
      sumSquares -= outgoing * outgoing;
    }

    if (i >= period - 1) {
      const middle = sum / period;
      const variance = Math.max(0, sumSquares / period - middle * middle);
      const deviation = Math.sqrt(variance) * stdDev;
      out.push({
        time: candles[i].time,
        middle,
        upper: middle + deviation,
        lower: middle - deviation,
      });
    }
  }

  return out;
}

export function adx(
  candles: Candle[],
  diLength = 14,
  adxLength = 14,
): ADXPoint[] {
  if (candles.length <= Math.max(diLength, adxLength) + 1) return [];

  const tr: number[] = [];
  const plusDM: number[] = [];
  const minusDM: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const prev = candles[i - 1];
    const up = current.high - prev.high;
    const down = prev.low - current.low;
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
    const range = Math.max(
      current.high - current.low,
      Math.abs(current.high - prev.close),
      Math.abs(current.low - prev.close),
    );
    tr.push(range);
  }

  const smooth = (values: number[], period: number) => {
    const out: number[] = [];
    if (values.length < period) return out;
    let sum = 0;
    for (let i = 0; i < period; i++) sum += values[i];
    out.push(sum);
    for (let i = period; i < values.length; i++) {
      sum = sum - values[i - period] + values[i];
      out.push(sum);
    }
    return out;
  };

  const trSmooth = smooth(tr, diLength);
  const plusSmooth = smooth(plusDM, diLength);
  const minusSmooth = smooth(minusDM, diLength);

  const dx: number[] = [];
  const start = diLength - 1;
  for (let i = 0; i < trSmooth.length; i++) {
    const trv = trSmooth[i] || 1;
    const plus = 100 * (plusSmooth[i] || 0) / trv;
    const minus = 100 * (minusSmooth[i] || 0) / trv;
    const denom = plus + minus || 1;
    dx.push(100 * Math.abs(plus - minus) / denom);
  }

  const out: ADXPoint[] = [];
  if (dx.length < adxLength) return out;
  let adxVal = dx.slice(0, adxLength).reduce((a, b) => a + b, 0) / adxLength;
  out.push({
    time: candles[start + adxLength].time,
    adx: adxVal,
    plusDI: 0,
    minusDI: 0,
  });
  for (let i = adxLength; i < dx.length; i++) {
    adxVal = ((adxVal * (adxLength - 1)) + dx[i]) / adxLength;
    const idx = start + i + 1;
    const trv = trSmooth[i] || 1;
    const plus = 100 * (plusSmooth[i] || 0) / trv;
    const minus = 100 * (minusSmooth[i] || 0) / trv;
    out.push({ time: candles[idx].time, adx: adxVal, plusDI: plus, minusDI: minus });
  }
  return out;
}

export function squeezeMomentum(
  candles: Candle[],
  bbLength = 20,
  keltnerLength = 20,
  mult = 2,
  multKC = 1.5,
  useTrueRange = true,
): SqueezePoint[] {
  if (candles.length < Math.max(bbLength, keltnerLength)) return [];
  const out: SqueezePoint[] = [];
  const source = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);

  const basis = sma(candles, bbLength).map((p) => p.value);
  const dev = stdev(candles, bbLength).map((p) => p.value * mult);
  const maKC = sma(candles, keltnerLength).map((p) => p.value);

  const rangeSeries = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    if (!useTrueRange) return c.high - c.low;
    return Math.max(
      c.high - c.low,
      Math.abs(c.high - candles[i - 1].close),
      Math.abs(c.low - candles[i - 1].close),
    );
  });
  const rangeSma = sma(
    rangeSeries.map((value, i) => ({ ...candles[i], close: value })),
    keltnerLength,
  ).map((p) => p.value);

  const highest = (arr: number[], endIndex: number, length: number) => {
    let maxVal = -Infinity;
    const start = endIndex - length + 1;
    for (let i = start; i <= endIndex; i++) {
      if (arr[i] > maxVal) maxVal = arr[i];
    }
    return maxVal;
  };

  const lowest = (arr: number[], endIndex: number, length: number) => {
    let minVal = Infinity;
    const start = endIndex - length + 1;
    for (let i = start; i <= endIndex; i++) {
      if (arr[i] < minVal) minVal = arr[i];
    }
    return minVal;
  };

  const linregAt = (arr: number[], endIndex: number, length: number) => {
    const start = endIndex - length + 1;
    const meanX = (length - 1) / 2;
    let meanY = 0;
    for (let i = 0; i < length; i++) {
      meanY += arr[start + i];
    }
    meanY /= length;

    let num = 0;
    let den = 0;
    for (let i = 0; i < length; i++) {
      const x = i - meanX;
      const y = arr[start + i] - meanY;
      num += x * y;
      den += x * x;
    }
    const slope = den === 0 ? 0 : num / den;
    const intercept = meanY - slope * meanX;
    return intercept + slope * (length - 1);
  };

  const start = Math.max(bbLength, keltnerLength * 2 - 1) - 1;
  for (let i = start; i < candles.length; i++) {
    const basisIdx = i - (bbLength - 1);
    const kcIdx = i - (keltnerLength - 1);
    const bbBasis = basis[basisIdx] ?? source[i];
    const bbDev = dev[basisIdx] ?? 0;
    const upperBB = bbBasis + bbDev;
    const lowerBB = bbBasis - bbDev;
    const ma = maKC[kcIdx] ?? source[i];
    const rng = rangeSma[kcIdx] ?? 0;
    const upperKC = ma + rng * multKC;
    const lowerKC = ma - rng * multKC;

    const squeezeOn = lowerBB > lowerKC && upperBB < upperKC;
    const squeezeOff = lowerBB < lowerKC && upperBB > upperKC;
    const noSqz = !squeezeOn && !squeezeOff;

    const transformed: number[] = [];
    for (let j = i - keltnerLength + 1; j <= i; j++) {
      const highJ = highest(highs, j, keltnerLength);
      const lowJ = lowest(lows, j, keltnerLength);
      const kcJ = j - (keltnerLength - 1);
      const maJ = maKC[kcJ] ?? source[j];
      const avgHLSmaJ = ((highJ + lowJ) / 2 + maJ) / 2;
      transformed.push(source[j] - avgHLSmaJ);
    }

    const value = linregAt(transformed, transformed.length - 1, keltnerLength);

    out.push({
      time: candles[i].time,
      value,
      zero: 0,
      squeezeOn,
      squeezeOff,
      noSqz,
    });
  }
  return out;
}
