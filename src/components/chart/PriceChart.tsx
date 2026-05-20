"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type UTCTimestamp,
} from "lightweight-charts";
import { fetchKlines } from "@/lib/binance/rest";
import { getBinanceWS } from "@/lib/binance/ws";
import { adx, bollinger, ema, rsi, macd, squeezeMomentum } from "@/lib/indicators";
import type { Candle, Timeframe } from "@/lib/binance/types";
import {
  DEFAULT_CONFIG,
  INDICATOR_COLORS,
  useChartStore,
  type IndicatorKey,
} from "@/lib/store/chart-store";
import { formatPrice, formatVolume } from "@/lib/format";
import { DrawingLayer } from "./DrawingLayer";
import { IndicatorPill } from "./IndicatorPill";
import { MeasureOverlay } from "./MeasureOverlay";

interface MeasurePoint {
  time: number;
  price: number;
}
interface MeasureState {
  phase: "idle" | "placing" | "done";
  a: MeasurePoint | null;
  b: MeasurePoint | null;
}
const INITIAL_MEASURE: MeasureState = { phase: "idle", a: null, b: null };

function durationLabel(aTime: number, bTime: number): string {
  const diff = Math.abs(bTime - aTime);
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

interface Props {
  symbol: string;
  timeframe: Timeframe;
}

const TV_COLORS = {
  bg: "#131722",
  panel: "#1e222d",
  border: "#2a2e39",
  text: "#d1d4dc",
  textMuted: "#787b86",
  green: "#26a69a",
  red: "#ef5350",
  blue: "#2962ff",
  yellow: "#ffb74d",
  purple: "#ab47bc",
  grid: "#1e222d",
};

const CANDLE_THEMES = {
  default: {
    up: TV_COLORS.green,
    down: TV_COLORS.red,
    wickUp: TV_COLORS.green,
    wickDown: TV_COLORS.red,
  },
  classic: {
    up: "#0ECB81",
    down: "#F6465D",
    wickUp: "#0ECB81",
    wickDown: "#F6465D",
  },
  mono: {
    up: "#d1d4dc",
    down: "#787b86",
    wickUp: "#d1d4dc",
    wickDown: "#787b86",
  },
} as const;

const MA_SERIES_KEYS = ["ma1", "ma2", "ma3", "ma4", "ma5", "ma6", "ma7"] as const;

interface HoverInfo {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  time: number;
  pct: number;
}

interface LastValues {
  emaSet?: number;
  bollingerUpper?: number;
  bollingerMiddle?: number;
  bollingerLower?: number;
  ema20?: number;
  ema50?: number;
  ema200?: number;
  rsi?: number;
  macd?: number;
  macdSignal?: number;
  macdHist?: number;
  adx?: number;
  plusDI?: number;
  minusDI?: number;
  squeeze?: number;
  volume?: number;
}

interface PaneOffset {
  top: number;
  height: number;
}

export function PriceChart({ symbol, timeframe }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const bollingerUpperRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bollingerMiddleRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bollingerLowerRef = useRef<ISeriesApi<"Line"> | null>(null);
  const emaSetRefs = useRef<Record<string, ISeriesApi<"Line"> | null>>({});
  const ema20Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ema50Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ema200Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const rsiRef = useRef<ISeriesApi<"Line"> | null>(null);
  const rsi30Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const rsi70Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const macdRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdSignalRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdHistRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const adxRef = useRef<ISeriesApi<"Line"> | null>(null);
  const plusDIRef = useRef<ISeriesApi<"Line"> | null>(null);
  const minusDIRef = useRef<ISeriesApi<"Line"> | null>(null);
  const squeezeHistRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const squeezeZeroRef = useRef<ISeriesApi<"Line"> | null>(null);
  const adxPaneIndexRef = useRef<number | null>(null);
  const squeezePaneIndexRef = useRef<number | null>(null);
  const candlesRef = useRef<Candle[]>([]);
  const priceLinesMapRef = useRef<Map<string, IPriceLine>>(new Map());

  const indicators = useChartStore((s) => s.indicators);
  const hidden = useChartStore((s) => s.hidden);
  const config = useChartStore((s) => s.config);
  const indicatorStyles = useChartStore((s) => s.indicatorStyles);
  const tool = useChartStore((s) => s.tool);
  const candleTheme = useChartStore((s) => s.candleTheme);
  const priceLines = useChartStore((s) => s.priceLines);
  const addPriceLine = useChartStore((s) => s.addPriceLine);
  const removeIndicator = useChartStore((s) => s.removeIndicator);
  const toggleHidden = useChartStore((s) => s.toggleHidden);
  const setSettingsTarget = useChartStore((s) => s.setSettingsTarget);

  // Refs to avoid recreating subscribeClick on every tool change
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const addPriceLineRef = useRef(addPriceLine);
  addPriceLineRef.current = addPriceLine;
  const symbolRef = useRef(symbol);
  symbolRef.current = symbol;
  const setSettingsTargetRef = useRef(setSettingsTarget);
  setSettingsTargetRef.current = setSettingsTarget;
  const configRef = useRef(config);
  configRef.current = config;

  const styleRef = useRef(indicatorStyles);
  styleRef.current = indicatorStyles;

  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [lastPrice, setLastPrice] = useState<{ value: number; pct: number } | null>(null);
  const [lastValues, setLastValues] = useState<LastValues>({});
  const [paneOffsets, setPaneOffsets] = useState<PaneOffset[]>([]);
  const [measure, setMeasure] = useState<MeasureState>(INITIAL_MEASURE);
  const [renderTick, setRenderTick] = useState(0);
  const measureRef = useRef(measure);
  measureRef.current = measure;

  function getStyle(key: IndicatorKey, fallbackColor: string, fallbackWidth: number) {
    const s = styleRef.current[key];
    const widthRaw = s?.lineWidth ?? fallbackWidth;
    const width = Math.max(1, Math.min(4, Math.round(widthRaw))) as 1 | 2 | 3 | 4;
    return {
      color: s?.color ?? fallbackColor,
      lineWidth: width,
    };
  }

  function keyFromSeries(series: unknown): IndicatorKey | null {
    const s = series as ISeriesApi<"Candlestick" | "Line" | "Histogram"> | null | undefined;
    if (!s) return null;
    if (s === ema20Ref.current) return "ema20";
    if (s === ema50Ref.current) return "ema50";
    if (s === ema200Ref.current) return "ema200";
    for (const key of MA_SERIES_KEYS) {
      if (s === emaSetRefs.current[key]) return "emaSet";
    }
    if (s === bollingerUpperRef.current || s === bollingerMiddleRef.current || s === bollingerLowerRef.current) return "bollinger";
    if (s === rsiRef.current || s === rsi30Ref.current || s === rsi70Ref.current) return "rsi";
    if (s === macdRef.current || s === macdSignalRef.current || s === macdHistRef.current) return "macd";
    if (s === adxRef.current || s === plusDIRef.current || s === minusDIRef.current) return "adx";
    if (s === squeezeHistRef.current || s === squeezeZeroRef.current) return "squeeze";
    if (s === volumeSeriesRef.current) return "volume";
    return null;
  }

  // Helper — compute pane top offsets from chart layout
  function recomputePaneOffsets() {
    if (!chartRef.current) return;
    const panes = chartRef.current.panes();
    let top = 0;
    const offsets: PaneOffset[] = panes.map((p) => {
      const h = p.getHeight();
      const o = { top, height: h };
      top += h;
      return o;
    });
    setPaneOffsets(offsets);
  }

  // Create chart once
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: TV_COLORS.bg },
        textColor: TV_COLORS.text,
        fontFamily: "var(--font-sans), Inter, system-ui, sans-serif",
        fontSize: 11,
        panes: { separatorColor: TV_COLORS.border, separatorHoverColor: TV_COLORS.border },
      },
      grid: {
        vertLines: { color: TV_COLORS.grid },
        horzLines: { color: TV_COLORS.grid },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: TV_COLORS.textMuted, width: 1, style: 3, labelBackgroundColor: TV_COLORS.panel },
        horzLine: { color: TV_COLORS.textMuted, width: 1, style: 3, labelBackgroundColor: TV_COLORS.panel },
      },
      rightPriceScale: {
        borderColor: TV_COLORS.border,
        textColor: TV_COLORS.textMuted,
      },
      timeScale: {
        borderColor: TV_COLORS.border,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 12,
        barSpacing: 8,
      },
      autoSize: true,
      leftPriceScale: {
        visible: true,
        borderColor: TV_COLORS.border,
        textColor: TV_COLORS.textMuted,
      },
    });

    // PANE 0 — Candles + EMAs
    candleSeriesRef.current = chart.addSeries(CandlestickSeries, {
      ...CANDLE_THEMES[candleTheme],
      borderUpColor: CANDLE_THEMES[candleTheme].up,
      borderDownColor: CANDLE_THEMES[candleTheme].down,
      priceLineColor: TV_COLORS.textMuted,
      priceLineStyle: 2,
    });

    ema20Ref.current = chart.addSeries(LineSeries, {
      ...getStyle("ema20", INDICATOR_COLORS.ema20, 1),
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    ema50Ref.current = chart.addSeries(LineSeries, {
      ...getStyle("ema50", INDICATOR_COLORS.ema50, 1),
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    ema200Ref.current = chart.addSeries(LineSeries, {
      ...getStyle("ema200", INDICATOR_COLORS.ema200, 2),
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    MA_SERIES_KEYS.forEach((key, idx) => {
      emaSetRefs.current[key] = chart.addSeries(LineSeries, {
        ...getStyle("emaSet", DEFAULT_CONFIG.maSet?.[idx]?.color ?? "#f59e0b", 1),
        crosshairMarkerVisible: false,
        priceLineVisible: false,
        lastValueVisible: false,
      });
    });

    bollingerUpperRef.current = chart.addSeries(LineSeries, {
      ...getStyle("bollinger", "rgba(100, 181, 246, 0.45)", 1),
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    bollingerMiddleRef.current = chart.addSeries(LineSeries, {
      ...getStyle("bollinger", "rgba(255, 255, 255, 0.28)", 1),
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    bollingerLowerRef.current = chart.addSeries(LineSeries, {
      ...getStyle("bollinger", "rgba(100, 181, 246, 0.45)", 1),
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    chartRef.current = chart;

    // Click handler — add horizontal price line when hline tool is active
    chart.subscribeClick((param) => {
      const hoveredKey = keyFromSeries(param.hoveredSeries);
      if (hoveredKey) {
        setSettingsTargetRef.current(hoveredKey);
        return;
      }

      if (!param.point || !candleSeriesRef.current) return;
      const price = candleSeriesRef.current.coordinateToPrice(param.point.y);
      if (price === null || !isFinite(price)) return;

      if (toolRef.current === "hline") {
        addPriceLineRef.current(price, symbolRef.current);
        return;
      }

      if (toolRef.current === "measure") {
        if (!param.time) return;
        const time = Number(param.time);
        const current = measureRef.current;
        if (current.phase === "idle") {
          setMeasure({
            phase: "placing",
            a: { time, price },
            b: { time, price },
          });
        } else if (current.phase === "placing") {
          setMeasure({
            phase: "done",
            a: current.a,
            b: { time, price },
          });
        } else {
          setMeasure({
            phase: "placing",
            a: { time, price },
            b: { time, price },
          });
        }
      }
    });

    // Crosshair handler
    chart.subscribeCrosshairMove((param) => {
      if (
        toolRef.current === "measure" &&
        measureRef.current.phase === "placing" &&
        param.point &&
        param.time &&
        candleSeriesRef.current
      ) {
        const price = candleSeriesRef.current.coordinateToPrice(param.point.y);
        if (price !== null && isFinite(price)) {
          const time = Number(param.time);
          setMeasure((prev) =>
            prev.phase === "placing" ? { ...prev, b: { time, price } } : prev,
          );
        }
      }

      if (!param.time || !candleSeriesRef.current) {
        setHover(null);
        return;
      }
      const data = param.seriesData.get(candleSeriesRef.current);
      const vol = volumeSeriesRef.current
        ? param.seriesData.get(volumeSeriesRef.current)
        : null;
      if (data && "open" in data) {
        const o = data.open as number;
        const c = data.close as number;
        setHover({
          o,
          h: data.high as number,
          l: data.low as number,
          c,
          v: vol && "value" in vol ? (vol.value as number) : 0,
          time: Number(param.time),
          pct: o === 0 ? 0 : ((c - o) / o) * 100,
        });
      }
    });

    // Re-render measure overlay on pan / zoom so pixel coords stay in sync
    const tsRangeHandler = () => setRenderTick((t) => t + 1);
    chart.timeScale().subscribeVisibleTimeRangeChange(tsRangeHandler);
    const logicalRangeHandler = () => setRenderTick((t) => t + 1);
    chart.timeScale().subscribeVisibleLogicalRangeChange(logicalRangeHandler);

    // ResizeObserver — recompute pane offsets when chart container resizes
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(() => recomputePaneOffsets());
    });
    ro.observe(containerRef.current);
    recomputePaneOffsets();
    const priceLinesMap = priceLinesMapRef.current;

    return () => {
      chart.timeScale().unsubscribeVisibleTimeRangeChange(tsRangeHandler);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(logicalRangeHandler);
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      bollingerUpperRef.current = null;
      bollingerMiddleRef.current = null;
      bollingerLowerRef.current = null;
      priceLinesMap.clear();
      ema20Ref.current = null;
      ema50Ref.current = null;
      ema200Ref.current = null;
      emaSetRefs.current = {};
      rsiRef.current = null;
      rsi30Ref.current = null;
      rsi70Ref.current = null;
      macdRef.current = null;
      macdSignalRef.current = null;
      macdHistRef.current = null;
      adxRef.current = null;
      plusDIRef.current = null;
      minusDIRef.current = null;
      squeezeHistRef.current = null;
      squeezeZeroRef.current = null;
    };
  }, []);

  // Manage volume — overlay at the bottom of the main pane
  useEffect(() => {
    if (!chartRef.current) return;
    if (indicators.volume && !volumeSeriesRef.current) {
      const v = chartRef.current.addSeries(
        HistogramSeries,
        {
          priceFormat: { type: "volume" },
          priceScaleId: "volume",
          color: TV_COLORS.textMuted,
          priceLineVisible: false,
          lastValueVisible: false,
        },
        0,
      );
      v.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      volumeSeriesRef.current = v;
      const data = candlesRef.current.map((k) => ({
        time: k.time as UTCTimestamp,
        value: k.volume,
        color: k.close >= k.open ? `${TV_COLORS.green}66` : `${TV_COLORS.red}66`,
      }));
      v.setData(data);
    } else if (!indicators.volume && volumeSeriesRef.current && chartRef.current) {
      chartRef.current.removeSeries(volumeSeriesRef.current);
      volumeSeriesRef.current = null;
    }
    requestAnimationFrame(() => recomputePaneOffsets());
  }, [indicators.volume]);

  // Bollinger Bands overlay on the main pane
  useEffect(() => {
    if (!chartRef.current) return;
    const visible = indicators.bollinger && !hidden.bollinger;
    bollingerUpperRef.current?.applyOptions({ visible });
    bollingerMiddleRef.current?.applyOptions({ visible });
    bollingerLowerRef.current?.applyOptions({ visible });
    updateBollinger();
  }, [indicators.bollinger, hidden.bollinger, updateBollinger]);

  // RSI pane
  useEffect(() => {
    if (!chartRef.current) return;
    if (indicators.rsi && !rsiRef.current) {
      const paneIndex = 1;
      const r = chartRef.current.addSeries(
        LineSeries,
        {
          ...getStyle("rsi", INDICATOR_COLORS.rsi, 1),
          crosshairMarkerVisible: false,
          priceLineVisible: false,
          lastValueVisible: false,
        },
        paneIndex,
      );
      const r30 = chartRef.current.addSeries(
        LineSeries,
        {
          color: TV_COLORS.textMuted,
          lineWidth: 1,
          lineStyle: 2,
          crosshairMarkerVisible: false,
          priceLineVisible: false,
          lastValueVisible: false,
        },
        paneIndex,
      );
      const r70 = chartRef.current.addSeries(
        LineSeries,
        {
          color: TV_COLORS.textMuted,
          lineWidth: 1,
          lineStyle: 2,
          crosshairMarkerVisible: false,
          priceLineVisible: false,
          lastValueVisible: false,
        },
        paneIndex,
      );
      rsiRef.current = r;
      rsi30Ref.current = r30;
      rsi70Ref.current = r70;
      try {
        chartRef.current.panes()[1]?.setStretchFactor(1);
        chartRef.current.panes()[0]?.setStretchFactor(3);
      } catch {}
      updateRSI();
    } else if (!indicators.rsi && rsiRef.current && chartRef.current) {
      chartRef.current.removeSeries(rsiRef.current);
      if (rsi30Ref.current) chartRef.current.removeSeries(rsi30Ref.current);
      if (rsi70Ref.current) chartRef.current.removeSeries(rsi70Ref.current);
      rsiRef.current = null;
      rsi30Ref.current = null;
      rsi70Ref.current = null;
    }
    requestAnimationFrame(() => recomputePaneOffsets());
  }, [indicators.rsi]);

  // MACD pane
  useEffect(() => {
    if (!chartRef.current) return;
    if (indicators.macd && !macdRef.current) {
      const paneIndex = indicators.rsi ? 2 : 1;
      const m = chartRef.current.addSeries(
        LineSeries,
        {
          ...getStyle("macd", INDICATOR_COLORS.macd, 1),
          crosshairMarkerVisible: false,
          priceLineVisible: false,
          lastValueVisible: false,
        },
        paneIndex,
      );
      const s = chartRef.current.addSeries(
        LineSeries,
        {
          color: TV_COLORS.yellow,
          lineWidth: 1,
          crosshairMarkerVisible: false,
          priceLineVisible: false,
          lastValueVisible: false,
        },
        paneIndex,
      );
      const h = chartRef.current.addSeries(
        HistogramSeries,
        { priceLineVisible: false, lastValueVisible: false },
        paneIndex,
      );
      macdRef.current = m;
      macdSignalRef.current = s;
      macdHistRef.current = h;
      try {
        chartRef.current.panes()[paneIndex]?.setStretchFactor(1);
        chartRef.current.panes()[0]?.setStretchFactor(3);
      } catch {}
      updateMACD();
    } else if (!indicators.macd && macdRef.current && chartRef.current) {
      if (macdRef.current) chartRef.current.removeSeries(macdRef.current);
      if (macdSignalRef.current) chartRef.current.removeSeries(macdSignalRef.current);
      if (macdHistRef.current) chartRef.current.removeSeries(macdHistRef.current);
      macdRef.current = null;
      macdSignalRef.current = null;
      macdHistRef.current = null;
    }
    requestAnimationFrame(() => recomputePaneOffsets());
  }, [indicators.macd, indicators.rsi]);

  // Visibility — eye toggle (hidden state) + enabled state combined
  useEffect(() => {
    const v = (key: IndicatorKey) => indicators[key] && !hidden[key];
    ema20Ref.current?.applyOptions({ visible: v("ema20") });
    ema50Ref.current?.applyOptions({ visible: v("ema50") });
    ema200Ref.current?.applyOptions({ visible: v("ema200") });
    for (const key of MA_SERIES_KEYS) {
      emaSetRefs.current[key]?.applyOptions({ visible: v("emaSet") });
    }
    if (bollingerUpperRef.current) bollingerUpperRef.current.applyOptions({ visible: v("bollinger") });
    if (bollingerMiddleRef.current) bollingerMiddleRef.current.applyOptions({ visible: v("bollinger") });
    if (bollingerLowerRef.current) bollingerLowerRef.current.applyOptions({ visible: v("bollinger") });
    if (rsiRef.current) rsiRef.current.applyOptions({ visible: v("rsi") });
    if (rsi30Ref.current) rsi30Ref.current.applyOptions({ visible: v("rsi") });
    if (rsi70Ref.current) rsi70Ref.current.applyOptions({ visible: v("rsi") });
    if (macdRef.current) macdRef.current.applyOptions({ visible: v("macd") });
    if (macdSignalRef.current) macdSignalRef.current.applyOptions({ visible: v("macd") });
    if (macdHistRef.current) macdHistRef.current.applyOptions({ visible: v("macd") });
    if (adxRef.current) adxRef.current.applyOptions({ visible: v("adx") });
    if (plusDIRef.current) plusDIRef.current.applyOptions({ visible: v("adx") });
    if (minusDIRef.current) minusDIRef.current.applyOptions({ visible: v("adx") });
    if (squeezeHistRef.current) squeezeHistRef.current.applyOptions({ visible: v("squeeze") });
    if (squeezeZeroRef.current) squeezeZeroRef.current.applyOptions({ visible: v("squeeze") });
    if (volumeSeriesRef.current) volumeSeriesRef.current.applyOptions({ visible: v("volume") });
  }, [indicators, hidden]);

  // Recompute indicators when config changes (periods)
  useEffect(() => {
    updateEMAs();
  }, [config.ema20, config.ema50, config.ema200]);

  useEffect(() => {
    updateRSI();
  }, [config.rsi]);

  useEffect(() => {
    updateMACD();
  }, [config.macdFast, config.macdSlow, config.macdSignal]);

  useEffect(() => {
    if (indicators.adx) updateADX();
  }, [config.adxPeriod, indicators.adx]);

  useEffect(() => {
    if (indicators.squeeze) updateSqueeze();
  }, [config.squeezeBBLength, config.squeezeKeltnerLength, indicators.squeeze]);

  useEffect(() => {
    if (!chartRef.current) return;
    if (indicators.emaSet) {
      updateEmaSet();
    } else if (!indicators.emaSet) {
      for (const key of MA_SERIES_KEYS) {
        const series = emaSetRefs.current[key];
        series?.setData([]);
      }
    }
    requestAnimationFrame(() => recomputePaneOffsets());
  }, [indicators.emaSet, hidden.emaSet, config.maSet]);

  useEffect(() => {
    if (!chartRef.current) return;
    const basePane = 1 + (indicators.rsi ? 1 : 0) + (indicators.macd ? 1 : 0);
    const paneIndex = basePane;
    const needLowerPane = indicators.adx || indicators.squeeze;

    if (needLowerPane && (!adxRef.current || adxPaneIndexRef.current !== paneIndex || squeezePaneIndexRef.current !== paneIndex)) {
      if (adxRef.current) chartRef.current.removeSeries(adxRef.current);
      if (plusDIRef.current) chartRef.current.removeSeries(plusDIRef.current);
      if (minusDIRef.current) chartRef.current.removeSeries(minusDIRef.current);
      if (squeezeHistRef.current) chartRef.current.removeSeries(squeezeHistRef.current);
      if (squeezeZeroRef.current) chartRef.current.removeSeries(squeezeZeroRef.current);

      adxRef.current = chartRef.current.addSeries(LineSeries, {
        ...getStyle("adx", INDICATOR_COLORS.adx, 1),
        priceScaleId: "left",
        crosshairMarkerVisible: false,
        priceLineVisible: false,
        lastValueVisible: false,
      }, paneIndex);
      plusDIRef.current = chartRef.current.addSeries(LineSeries, {
        color: TV_COLORS.blue,
        lineWidth: 1,
        priceScaleId: "left",
        crosshairMarkerVisible: false,
        priceLineVisible: false,
        lastValueVisible: false,
      }, paneIndex);
      minusDIRef.current = chartRef.current.addSeries(LineSeries, {
        color: TV_COLORS.textMuted,
        lineWidth: 1,
        priceScaleId: "left",
        crosshairMarkerVisible: false,
        priceLineVisible: false,
        lastValueVisible: false,
      }, paneIndex);
      squeezeHistRef.current = chartRef.current.addSeries(HistogramSeries, {
        priceScaleId: "right",
        priceLineVisible: false,
        lastValueVisible: false,
      }, paneIndex);
      squeezeZeroRef.current = chartRef.current.addSeries(LineSeries, {
        color: TV_COLORS.textMuted,
        lineWidth: 1,
        lineStyle: 2,
        priceScaleId: "right",
        crosshairMarkerVisible: false,
        priceLineVisible: false,
        lastValueVisible: false,
      }, paneIndex);
      adxPaneIndexRef.current = paneIndex;
      squeezePaneIndexRef.current = paneIndex;
      try {
        chartRef.current.panes()[paneIndex]?.setStretchFactor(1);
        chartRef.current.panes()[0]?.setStretchFactor(3);
      } catch {}
      if (indicators.adx) updateADX();
      if (indicators.squeeze) updateSqueeze();
    }

    if (!needLowerPane && adxRef.current) {
      chartRef.current.removeSeries(adxRef.current);
      if (plusDIRef.current) chartRef.current.removeSeries(plusDIRef.current);
      if (minusDIRef.current) chartRef.current.removeSeries(minusDIRef.current);
      if (squeezeHistRef.current) chartRef.current.removeSeries(squeezeHistRef.current);
      if (squeezeZeroRef.current) chartRef.current.removeSeries(squeezeZeroRef.current);
      adxRef.current = null;
      plusDIRef.current = null;
      minusDIRef.current = null;
      squeezeHistRef.current = null;
      squeezeZeroRef.current = null;
      adxPaneIndexRef.current = null;
      squeezePaneIndexRef.current = null;
    }

    if (adxRef.current) adxRef.current.applyOptions({ visible: indicators.adx });
    if (plusDIRef.current) plusDIRef.current.applyOptions({ visible: indicators.adx });
    if (minusDIRef.current) minusDIRef.current.applyOptions({ visible: indicators.adx });
    if (squeezeHistRef.current) squeezeHistRef.current.applyOptions({ visible: indicators.squeeze });
    if (squeezeZeroRef.current) squeezeZeroRef.current.applyOptions({ visible: indicators.squeeze });

    requestAnimationFrame(() => recomputePaneOffsets());
  }, [indicators.squeeze, indicators.adx, indicators.rsi, indicators.macd]);

  // Sync price lines from store to the candle series
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;
    const map = priceLinesMapRef.current;
    const linesForThisSymbol = priceLines.filter((p) => p.symbol === symbol);
    const activeIds = new Set(linesForThisSymbol.map((p) => p.id));

    for (const [id, apiLine] of map.entries()) {
      if (!activeIds.has(id)) {
        try {
          series.removePriceLine(apiLine);
        } catch {}
        map.delete(id);
      }
    }
    for (const pl of linesForThisSymbol) {
      if (!map.has(pl.id)) {
        const apiLine = series.createPriceLine({
          price: pl.price,
          color: TV_COLORS.blue,
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: "",
        });
        map.set(pl.id, apiLine);
      }
    }
  }, [priceLines, symbol]);

  // Cursor style when drawing tools are active + reset measure on tool change
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.style.cursor =
        tool === "cursor" ? "" : "crosshair";
    }
    if (tool !== "measure" && measureRef.current.phase !== "idle") {
      requestAnimationFrame(() => setMeasure(INITIAL_MEASURE));
    }
  }, [tool]);

  useEffect(() => {
    candleSeriesRef.current?.applyOptions({
      ...CANDLE_THEMES[candleTheme],
      borderUpColor: CANDLE_THEMES[candleTheme].up,
      borderDownColor: CANDLE_THEMES[candleTheme].down,
    });
  }, [candleTheme]);

  useEffect(() => {
    const apply = (key: IndicatorKey, series: ISeriesApi<"Line"> | null, fallbackColor: string, fallbackWidth: number) => {
      if (!series) return;
      series.applyOptions(getStyle(key, fallbackColor, fallbackWidth));
    };
    apply("ema20", ema20Ref.current, INDICATOR_COLORS.ema20, 1);
    apply("ema50", ema50Ref.current, INDICATOR_COLORS.ema50, 1);
    apply("ema200", ema200Ref.current, INDICATOR_COLORS.ema200, 2);
    for (let i = 0; i < MA_SERIES_KEYS.length; i++) {
      const key = MA_SERIES_KEYS[i];
      const color = config.maSet?.[i]?.color ?? DEFAULT_CONFIG.maSet?.[i]?.color ?? "#f59e0b";
      apply("emaSet", emaSetRefs.current[key] ?? null, color, 1);
    }
    apply("bollinger", bollingerUpperRef.current, "rgba(100, 181, 246, 0.45)", 1);
    apply("bollinger", bollingerMiddleRef.current, "rgba(255, 255, 255, 0.28)", 1);
    apply("bollinger", bollingerLowerRef.current, "rgba(100, 181, 246, 0.45)", 1);
    apply("rsi", rsiRef.current, INDICATOR_COLORS.rsi, 1);
    apply("macd", macdRef.current, INDICATOR_COLORS.macd, 1);
    apply("adx", adxRef.current, INDICATOR_COLORS.adx, 1);
  }, [indicatorStyles]);

  // Update volume bar colors to match the selected candle theme
  useEffect(() => {
    if (!volumeSeriesRef.current) return;
    const data = candlesRef.current.map((k) => ({
      time: k.time as UTCTimestamp,
      value: k.volume,
      color:
        k.close >= k.open
          ? `${CANDLE_THEMES[candleTheme].up}66`
          : `${CANDLE_THEMES[candleTheme].down}66`,
    }));
    try {
      volumeSeriesRef.current.setData(data);
    } catch {}
  }, [candleTheme]);

  function updateEMAs(live = false) {
    const c = candlesRef.current;
    if (c.length === 0) return;
    const cfg = configRef.current;
    let last20: number | undefined;
    let last50: number | undefined;
    let last200: number | undefined;
    const show20 = indicators.ema20;
    const show50 = indicators.ema50;
    const show200 = indicators.ema200;

    if (show20 && ema20Ref.current) {
      const data = ema(c, cfg.ema20);
      const mapped = data.map((p) => ({ time: p.time as UTCTimestamp, value: p.value }));
      if (live && mapped.length > 0) ema20Ref.current.update(mapped[mapped.length - 1]);
      else ema20Ref.current.setData(mapped);
      last20 = mapped.at(-1)?.value;
    }
    if (show50 && ema50Ref.current) {
      const data = ema(c, cfg.ema50);
      const mapped = data.map((p) => ({ time: p.time as UTCTimestamp, value: p.value }));
      if (live && mapped.length > 0) ema50Ref.current.update(mapped[mapped.length - 1]);
      else ema50Ref.current.setData(mapped);
      last50 = mapped.at(-1)?.value;
    }
    if (show200 && ema200Ref.current) {
      const data = ema(c, cfg.ema200);
      const mapped = data.map((p) => ({ time: p.time as UTCTimestamp, value: p.value }));
      if (live && mapped.length > 0) ema200Ref.current.update(mapped[mapped.length - 1]);
      else ema200Ref.current.setData(mapped);
      last200 = mapped.at(-1)?.value;
    }
    const lastVol = c.at(-1)?.volume;
    setLastValues((prev) => ({
      ...prev,
      ema20: last20,
      ema50: last50,
      ema200: last200,
      volume: lastVol,
    }));
  }

  function updateEmaSet(live = false) {
    const c = candlesRef.current;
    if (c.length === 0) return;
    const cfg = configRef.current;
    const slots = cfg.maSet && cfg.maSet.length > 0 ? cfg.maSet : (DEFAULT_CONFIG.maSet ?? []);
    for (let i = 0; i < MA_SERIES_KEYS.length; i++) {
      const key = MA_SERIES_KEYS[i];
      const series = emaSetRefs.current[key];
      if (!series) continue;
      const slot = slots[i] ?? (DEFAULT_CONFIG.maSet?.[i] ?? { enabled: false, period: 20, color: "#f59e0b" });
      series.applyOptions({
        color: slot.color,
        lineWidth: getStyle("emaSet", slot.color, 1).lineWidth,
      });
      if (!slot.enabled) {
        series.setData([]);
        continue;
      }
      const period = Math.max(2, Math.min(500, slot.period));
      const raw = ema(c, period);
      const mapped = raw.map((p) => ({ time: p.time as UTCTimestamp, value: p.value }));
      if (live && mapped.length > 0) series.update(mapped[mapped.length - 1]);
      else series.setData(mapped);
    }
    setLastValues((prev) => ({ ...prev, emaSet: c.at(-1)?.close }));
  }

  function updateADX(live = false) {
    const c = candlesRef.current;
    if (c.length === 0 || !adxRef.current || !plusDIRef.current || !minusDIRef.current) return;
    const cfg = configRef.current;
    const period = cfg.adxPeriod ?? 14;
    const data = adx(c, period, period);
    const adxPoints = data.map((p) => ({ time: p.time as UTCTimestamp, value: p.adx }));
    const plusPoints = data.map((p) => ({ time: p.time as UTCTimestamp, value: p.plusDI }));
    const minusPoints = data.map((p) => ({ time: p.time as UTCTimestamp, value: p.minusDI }));
    if (live && adxPoints.length > 0) adxRef.current.update(adxPoints[adxPoints.length - 1]);
    else adxRef.current.setData(adxPoints);
    if (live && plusPoints.length > 0) plusDIRef.current.update(plusPoints[plusPoints.length - 1]);
    else plusDIRef.current.setData(plusPoints);
    if (live && minusPoints.length > 0) minusDIRef.current.update(minusPoints[minusPoints.length - 1]);
    else minusDIRef.current.setData(minusPoints);
    const last = data.at(-1);
    setLastValues((prev) => ({ ...prev, adx: last?.adx, plusDI: last?.plusDI, minusDI: last?.minusDI }));
  }

  function updateSqueeze(live = false) {
    const c = candlesRef.current;
    if (c.length === 0 || !squeezeHistRef.current || !squeezeZeroRef.current) return;
    const cfg = configRef.current;
    const bbLen = cfg.squeezeBBLength ?? 20;
    const kLen = cfg.squeezeKeltnerLength ?? 20;
    const data = squeezeMomentum(c, bbLen, kLen);
    const histPoints = data.map((p) => ({
      time: p.time as UTCTimestamp,
      value: p.value,
      color: p.value >= 0 ? `${TV_COLORS.green}80` : `${TV_COLORS.red}80`,
    }));
    const zeroPoints = data.map((p) => ({ time: p.time as UTCTimestamp, value: 0 }));
    if (live && histPoints.length > 0) squeezeHistRef.current.update(histPoints[histPoints.length - 1]);
    else squeezeHistRef.current.setData(histPoints);
    if (live && zeroPoints.length > 0) squeezeZeroRef.current.update(zeroPoints[zeroPoints.length - 1]);
    else squeezeZeroRef.current.setData(zeroPoints);
    const last = data.at(-1);
    setLastValues((prev) => ({ ...prev, squeeze: last?.value }));
  }

  function updateBollinger(live = false) {
    const c = candlesRef.current;
    if (c.length === 0) return;
    const visible = indicators.bollinger && !hidden.bollinger;
    if (!visible) {
      bollingerUpperRef.current?.setData([]);
      bollingerMiddleRef.current?.setData([]);
      bollingerLowerRef.current?.setData([]);
      return;
    }
    const data = bollinger(c, 20, 2);
    const upperPoints = data.map((p) => ({ time: p.time as UTCTimestamp, value: p.upper }));
    const middlePoints = data.map((p) => ({ time: p.time as UTCTimestamp, value: p.middle }));
    const lowerPoints = data.map((p) => ({ time: p.time as UTCTimestamp, value: p.lower }));

    if (bollingerUpperRef.current) {
      if (visible) {
        if (live && upperPoints.length > 0) bollingerUpperRef.current.update(upperPoints[upperPoints.length - 1]);
        else bollingerUpperRef.current.setData(upperPoints);
      } else {
        bollingerUpperRef.current.setData([]);
      }
    }
    if (bollingerMiddleRef.current) {
      if (visible) {
        if (live && middlePoints.length > 0) bollingerMiddleRef.current.update(middlePoints[middlePoints.length - 1]);
        else bollingerMiddleRef.current.setData(middlePoints);
      } else {
        bollingerMiddleRef.current.setData([]);
      }
    }
    if (bollingerLowerRef.current) {
      if (visible) {
        if (live && lowerPoints.length > 0) bollingerLowerRef.current.update(lowerPoints[lowerPoints.length - 1]);
        else bollingerLowerRef.current.setData(lowerPoints);
      } else {
        bollingerLowerRef.current.setData([]);
      }
    }

    const last = data.at(-1);
    setLastValues((prev) => ({
      ...prev,
      bollingerUpper: last?.upper,
      bollingerMiddle: last?.middle,
      bollingerLower: last?.lower,
    }));
  }

  function updateRSI(live = false) {
    const c = candlesRef.current;
    if (c.length === 0 || !rsiRef.current || !indicators.rsi) return;
    const cfg = configRef.current;
    const data = rsi(c, cfg.rsi).map((p) => ({
      time: p.time as UTCTimestamp,
      value: p.value,
    }));
    if (live && data.length > 0) rsiRef.current.update(data[data.length - 1]);
    else rsiRef.current.setData(data);
    if (rsi30Ref.current && data.length > 0) {
      const level30 = [
        { time: data[0].time, value: 30 },
        { time: data[data.length - 1].time, value: 30 },
      ];
      if (live) rsi30Ref.current.update(level30[level30.length - 1]);
      else rsi30Ref.current.setData(level30);
    }
    if (rsi70Ref.current && data.length > 0) {
      const level70 = [
        { time: data[0].time, value: 70 },
        { time: data[data.length - 1].time, value: 70 },
      ];
      if (live) rsi70Ref.current.update(level70[level70.length - 1]);
      else rsi70Ref.current.setData(level70);
    }
    setLastValues((prev) => ({ ...prev, rsi: data.at(-1)?.value }));
  }

  function updateMACD(live = false) {
    const c = candlesRef.current;
    if (c.length === 0 || !macdRef.current || !indicators.macd) return;
    const cfg = configRef.current;
    const m = macd(c, cfg.macdFast, cfg.macdSlow, cfg.macdSignal);
    const macdPoints = m.map((p) => ({ time: p.time as UTCTimestamp, value: p.macd }));
    const signalPoints = m.map((p) => ({ time: p.time as UTCTimestamp, value: p.signal }));
    const histPoints = m.map((p) => ({
      time: p.time as UTCTimestamp,
      value: p.histogram,
      color: p.histogram >= 0 ? `${TV_COLORS.green}80` : `${TV_COLORS.red}80`,
    }));
    if (live && macdPoints.length > 0) macdRef.current.update(macdPoints[macdPoints.length - 1]);
    else macdRef.current.setData(macdPoints);
    if (macdSignalRef.current) {
      if (live && signalPoints.length > 0) macdSignalRef.current.update(signalPoints[signalPoints.length - 1]);
      else macdSignalRef.current.setData(signalPoints);
    }
    if (macdHistRef.current) {
      if (live && histPoints.length > 0) macdHistRef.current.update(histPoints[histPoints.length - 1]);
      else macdHistRef.current.setData(histPoints);
    }
    const last = m.at(-1);
    setLastValues((prev) => ({
      ...prev,
      macd: last?.macd,
      macdSignal: last?.signal,
      macdHist: last?.histogram,
    }));
  }

  // Load historical data + subscribe live
  useEffect(() => {
    let unsub: (() => void) | null = null;
    let cancelled = false;

    async function load() {
      try {
        const klines = await fetchKlines(symbol, timeframe, 500);
        if (cancelled) return;
        candlesRef.current = klines;
        if (candleSeriesRef.current) {
          candleSeriesRef.current.setData(
            klines.map((k) => ({
              time: k.time as UTCTimestamp,
              open: k.open,
              high: k.high,
              low: k.low,
              close: k.close,
            })),
          );
        }
        if (volumeSeriesRef.current) {
          volumeSeriesRef.current.setData(
            klines.map((k) => ({
              time: k.time as UTCTimestamp,
              value: k.volume,
              color: k.close >= k.open ? `${TV_COLORS.green}66` : `${TV_COLORS.red}66`,
            })),
          );
        }
        if (indicators.ema20 || indicators.ema50 || indicators.ema200) updateEMAs();
        if (indicators.emaSet) updateEmaSet();
        if (indicators.bollinger) updateBollinger();
        if (indicators.rsi) updateRSI();
        if (indicators.macd) updateMACD();
        if (indicators.adx) updateADX();
        if (indicators.squeeze) updateSqueeze();
        chartRef.current?.timeScale().fitContent();
        requestAnimationFrame(() => recomputePaneOffsets());

        if (klines.length > 0) {
          const last = klines[klines.length - 1];
          const prev = klines[klines.length - 2] ?? last;
          setLastPrice({
            value: last.close,
            pct: prev.close === 0 ? 0 : ((last.close - prev.close) / prev.close) * 100,
          });
        }

        const ws = getBinanceWS();
        unsub = ws.subscribeKline({
          symbol,
          interval: timeframe,
          onCandle: (k) => {
            if (!candleSeriesRef.current) return;
            const arr = candlesRef.current;
            const lastCandle = arr[arr.length - 1];
            if (lastCandle && lastCandle.time === k.time) {
              arr[arr.length - 1] = k;
            } else if (!lastCandle || k.time > lastCandle.time) {
              arr.push(k);
              if (arr.length > 2000) arr.shift();
            } else {
              return;
            }
            candleSeriesRef.current.update({
              time: k.time as UTCTimestamp,
              open: k.open,
              high: k.high,
              low: k.low,
              close: k.close,
            });
            if (volumeSeriesRef.current) {
              volumeSeriesRef.current.update({
                time: k.time as UTCTimestamp,
                value: k.volume,
                color: k.close >= k.open ? `${TV_COLORS.green}66` : `${TV_COLORS.red}66`,
              });
            }
            if (indicators.ema20 || indicators.ema50 || indicators.ema200) updateEMAs(true);
            if (indicators.emaSet) updateEmaSet(true);
            if (indicators.bollinger) updateBollinger(true);
            if (indicators.rsi) updateRSI(true);
            if (indicators.macd) updateMACD(true);
            if (indicators.adx) updateADX(true);
            if (indicators.squeeze) updateSqueeze(true);
            const prev = arr[arr.length - 2] ?? lastCandle;
            setLastPrice({
              value: k.close,
              pct: prev && prev.close !== 0 ? ((k.close - prev.close) / prev.close) * 100 : 0,
            });
          },
        });
      } catch (e) {
        console.error("Failed to load chart data:", e);
      }
    }

    load();

    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [symbol, timeframe]);

  const greenOrRed = (n: number) =>
    n >= 0 ? "text-tv-green" : "text-tv-red";

  // Helpers for pill rendering
  const isShown = (key: IndicatorKey) =>
    indicators[key] && (key === "volume" || true); // always renderable if enabled
  void isShown;

  // Determine which pane each indicator lives in (based on current layout)
  const rsiPaneIdx = 1;
  const macdPaneIdx = indicators.rsi ? 2 : 1;
  const lowerPaneIdx = 1 + (indicators.rsi ? 1 : 0) + (indicators.macd ? 1 : 0);

  let measureRender: React.ReactNode = null;
  if (
    measure.a &&
    measure.b &&
    chartRef.current &&
    candleSeriesRef.current
  ) {
    const ts = chartRef.current.timeScale();
    const aX = ts.timeToCoordinate(measure.a.time as UTCTimestamp);
    const bX = ts.timeToCoordinate(measure.b.time as UTCTimestamp);
    const aY = candleSeriesRef.current.priceToCoordinate(measure.a.price);
    const bY = candleSeriesRef.current.priceToCoordinate(measure.b.price);

    if (aX !== null && bX !== null && aY !== null && bY !== null) {
      const priceDiff = measure.b.price - measure.a.price;
      const pctChange =
        measure.a.price === 0 ? 0 : (priceDiff / measure.a.price) * 100;
      const isUp = priceDiff >= 0;
      const start = Math.min(measure.a.time, measure.b.time);
      const end = Math.max(measure.a.time, measure.b.time);
      const inRange = candlesRef.current.filter(
        (c) => c.time >= start && c.time <= end,
      );
      const bars = inRange.length;
      const volume = inRange.reduce((s, c) => s + c.volume, 0);
      const dur = durationLabel(measure.a.time, measure.b.time);

      measureRender = (
        <MeasureOverlay
          aX={aX}
          aY={aY}
          bX={bX}
          bY={bY}
          priceDiff={priceDiff}
          pctChange={pctChange}
          bars={bars}
          volume={volume}
          durationText={dur}
          isUp={isUp}
          isPreview={measure.phase === "placing"}
        />
      );
    }
  }
  void renderTick;

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <DrawingLayer
        tool={tool}
        symbol={symbol}
        renderTick={renderTick}
        chartRef={chartRef}
        candleSeriesRef={candleSeriesRef}
        candlesRef={candlesRef}
        mainPaneHeight={paneOffsets[0]?.height ?? 0}
      />
      {measureRender}

      {/* Top-left of main pane: symbol info + OHLC + Volume pill + EMA pills */}
      <div
        style={{ top: (paneOffsets[0]?.top ?? 0) + 12, left: 12 }}
        className="pointer-events-none absolute z-10 flex flex-col gap-1 text-xs tabular-nums"
      >
        {/* Row 1: symbol info + OHLC stats inline on hover (fixed height, never wraps) */}
        <div className="flex h-5 flex-nowrap items-center gap-x-3 overflow-hidden whitespace-nowrap">
          <div className="flex shrink-0 items-center gap-2 text-[13px] font-semibold">
            <span className="text-tv-text">{symbol}</span>
            <span className="text-tv-text-muted">·</span>
            <span className="uppercase text-tv-text-muted">{timeframe}</span>
            <span className="text-tv-text-muted">·</span>
            <span className="text-tv-text-muted">Binance</span>
          </div>
          {hover && (
            <div className="flex items-center gap-x-3 text-[11px]">
              <span className="text-tv-text-muted">
                O <span className={greenOrRed(hover.c - hover.o)}>{formatPrice(hover.o)}</span>
              </span>
              <span className="text-tv-text-muted">
                H <span className={greenOrRed(hover.c - hover.o)}>{formatPrice(hover.h)}</span>
              </span>
              <span className="text-tv-text-muted">
                L <span className={greenOrRed(hover.c - hover.o)}>{formatPrice(hover.l)}</span>
              </span>
              <span className="text-tv-text-muted">
                C <span className={greenOrRed(hover.c - hover.o)}>{formatPrice(hover.c)}</span>
              </span>
              <span className={greenOrRed(hover.pct)}>
                {hover.pct >= 0 ? "+" : ""}
                {hover.pct.toFixed(2)}%
              </span>
              <span className="text-tv-text-muted">
                Vol <span className="text-tv-text">{formatVolume(hover.v)}</span>
              </span>
            </div>
          )}
        </div>

        {/* Row 2: big live price (always present — reserves space even while loading) */}
        <div className="flex h-7 items-center gap-2">
          {lastPrice ? (
            <>
              <span className={`text-lg font-semibold tabular-nums ${greenOrRed(lastPrice.pct)}`}>
                {formatPrice(lastPrice.value)}
              </span>
              <span className={`text-xs ${greenOrRed(lastPrice.pct)}`}>
                {lastPrice.pct >= 0 ? "+" : ""}
                {lastPrice.pct.toFixed(2)}%
              </span>
            </>
          ) : (
            <span className="text-xs text-tv-text-muted">Cargando…</span>
          )}
        </div>

        {/* Indicator pills for the main pane (fixed position below price) */}
        <div className="mt-1 flex flex-col items-start gap-1">
          {indicators.ema20 && (
            <IndicatorPill
              name={`EMA ${config.ema20}`}
              value={lastValues.ema20 !== undefined ? formatPrice(lastValues.ema20) : undefined}
              color={INDICATOR_COLORS.ema20}
              hidden={hidden.ema20}
              onToggleHide={() => toggleHidden("ema20")}
              onSettings={() => setSettingsTarget("ema20")}
              onRemove={() => removeIndicator("ema20")}
            />
          )}
          {indicators.ema50 && (
            <IndicatorPill
              name={`EMA ${config.ema50}`}
              value={lastValues.ema50 !== undefined ? formatPrice(lastValues.ema50) : undefined}
              color={INDICATOR_COLORS.ema50}
              hidden={hidden.ema50}
              onToggleHide={() => toggleHidden("ema50")}
              onSettings={() => setSettingsTarget("ema50")}
              onRemove={() => removeIndicator("ema50")}
            />
          )}
          {indicators.ema200 && (
            <IndicatorPill
              name={`EMA ${config.ema200}`}
              value={lastValues.ema200 !== undefined ? formatPrice(lastValues.ema200) : undefined}
              color={INDICATOR_COLORS.ema200}
              hidden={hidden.ema200}
              onToggleHide={() => toggleHidden("ema200")}
              onSettings={() => setSettingsTarget("ema200")}
              onRemove={() => removeIndicator("ema200")}
            />
          )}
          {indicators.bollinger && (
            <IndicatorPill
              name="BB 20,2"
              value={lastValues.bollingerMiddle !== undefined ? formatPrice(lastValues.bollingerMiddle) : undefined}
              color={INDICATOR_COLORS.bollinger}
              hidden={hidden.bollinger}
              onToggleHide={() => toggleHidden("bollinger")}
              onSettings={() => setSettingsTarget("bollinger")}
              onRemove={() => removeIndicator("bollinger")}
            />
          )}
          {indicators.volume && (
            <IndicatorPill
              name="Vol"
              value={lastValues.volume !== undefined ? formatVolume(lastValues.volume) : undefined}
              color={INDICATOR_COLORS.volume}
              hidden={hidden.volume}
              onToggleHide={() => toggleHidden("volume")}
              onSettings={() => setSettingsTarget("volume")}
              onRemove={() => removeIndicator("volume")}
            />
          )}
        </div>
      </div>

      {/* RSI pane label */}
      {indicators.rsi && paneOffsets[rsiPaneIdx] && (
        <div
          style={{ top: paneOffsets[rsiPaneIdx].top + 6, left: 12 }}
          className="pointer-events-none absolute z-10"
        >
          <IndicatorPill
            name={`RSI ${config.rsi}`}
            value={lastValues.rsi !== undefined ? lastValues.rsi.toFixed(2) : undefined}
            color={INDICATOR_COLORS.rsi}
            hidden={hidden.rsi}
            onToggleHide={() => toggleHidden("rsi")}
            onSettings={() => setSettingsTarget("rsi")}
            onRemove={() => removeIndicator("rsi")}
          />
        </div>
      )}

      {/* MACD pane label */}
      {indicators.macd && paneOffsets[macdPaneIdx] && (
        <div
          style={{ top: paneOffsets[macdPaneIdx].top + 6, left: 12 }}
          className="pointer-events-none absolute z-10"
        >
          <IndicatorPill
            name={`MACD ${config.macdFast}, ${config.macdSlow}, ${config.macdSignal}`}
            value={
              lastValues.macd !== undefined
                ? `${lastValues.macd.toFixed(2)} / ${(lastValues.macdSignal ?? 0).toFixed(2)}`
                : undefined
            }
            color={INDICATOR_COLORS.macd}
            hidden={hidden.macd}
            onToggleHide={() => toggleHidden("macd")}
            onSettings={() => setSettingsTarget("macd")}
            onRemove={() => removeIndicator("macd")}
          />
        </div>
      )}

      {(indicators.adx || indicators.squeeze) && paneOffsets[lowerPaneIdx] && (
        <div
          style={{ top: paneOffsets[lowerPaneIdx].top + 6, left: 12 }}
          className="pointer-events-none absolute z-10 flex flex-col gap-1"
        >
          {indicators.adx && (
            <IndicatorPill
              name="ADX / DI"
              value={
                lastValues.adx !== undefined
                  ? `${lastValues.adx.toFixed(2)} / ${(lastValues.plusDI ?? 0).toFixed(2)} / ${(lastValues.minusDI ?? 0).toFixed(2)}`
                  : undefined
              }
              color={INDICATOR_COLORS.adx}
              hidden={hidden.adx}
              onToggleHide={() => toggleHidden("adx")}
              onSettings={() => setSettingsTarget("adx")}
              onRemove={() => removeIndicator("adx")}
            />
          )}
          {indicators.squeeze && (
            <IndicatorPill
              name="Squeeze"
              value={lastValues.squeeze !== undefined ? lastValues.squeeze.toFixed(2) : undefined}
              color={INDICATOR_COLORS.squeeze}
              hidden={hidden.squeeze}
              onToggleHide={() => toggleHidden("squeeze")}
              onSettings={() => setSettingsTarget("squeeze")}
              onRemove={() => removeIndicator("squeeze")}
            />
          )}
        </div>
      )}
    </div>
  );
}
