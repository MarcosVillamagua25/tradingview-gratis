"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Timeframe } from "@/lib/binance/types";

function toPerpSymbol(symbol: string): string {
  return `${symbol.toUpperCase().replace(/\.P$/, "")}.P`;
}

export type IndicatorKey =
  | "ema20"
  | "ema50"
  | "ema200"
  | "emaSet"
  | "bollinger"
  | "rsi"
  | "macd"
  | "adx"
  | "squeeze"
  | "volume";

export type DrawingTool =
  | "cursor"
  | "hline"
  | "measure"
  | "eraser"
  | "trendline"
  | "fibonacci"
  | "brush"
  | "position-long"
  | "position-short"
  | "rectangle";

export type DrawingShapeKind =
  | "trendline"
  | "fibonacci"
  | "brush"
  | "position-long"
  | "position-short"
  | "rectangle";

export interface DrawingPoint {
  time: number;
  price: number;
}

export interface DrawingShape {
  id: string;
  symbol: string;
  kind: DrawingShapeKind;
  points: DrawingPoint[];
  color: string;
  fill?: string;
  width?: number;
}

export interface PriceLine {
  id: string;
  symbol: string;
  price: number;
}

export interface IndicatorConfig {
  ema20: number;
  ema50: number;
  ema200: number;
  rsi: number;
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
  /** EMA set custom periods (optional) */
  emaSetPeriods?: number[];
  /** ADX period */
  adxPeriod?: number;
  adxKeyLevel?: number;
  /** Squeeze parameters */
  squeezeBBLength?: number;
  squeezeKeltnerLength?: number;
  maSet?: MAConfig[];
}

export interface MAConfig {
  enabled: boolean;
  period: number;
  color: string;
}

export interface IndicatorStyle {
  color?: string;
  lineWidth?: number;
}

export const DEFAULT_CONFIG: IndicatorConfig = {
  ema20: 20,
  ema50: 50,
  ema200: 200,
  rsi: 14,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  emaSetPeriods: [21, 55, 100, 200],
  adxPeriod: 14,
  adxKeyLevel: 23,
  squeezeBBLength: 20,
  squeezeKeltnerLength: 20,
  maSet: [
    { enabled: true, period: 10, color: "#f59e0b" },
    { enabled: true, period: 21, color: "#22c55e" },
    { enabled: true, period: 34, color: "#ef4444" },
    { enabled: true, period: 55, color: "#38bdf8" },
    { enabled: true, period: 99, color: "#a855f7" },
    { enabled: true, period: 200, color: "#facc15" },
    { enabled: false, period: 400, color: "#60a5fa" },
  ],
};

export const INDICATOR_COLORS: Record<IndicatorKey, string> = {
  ema20: "#ffb74d",
  ema50: "#2962ff",
  ema200: "#ab47bc",
  emaSet: "#f4c430",
  bollinger: "#64b5f6",
  rsi: "#ab47bc",
  macd: "#2962ff",
  adx: "#26a69a",
  squeeze: "#ef5350",
  volume: "#787b86",
};

export const DEFAULT_WATCHLIST = [
  "BTCUSDT.P",
  "ALGOUSDT.P",
  "XRPUSDT.P",
  "SOLUSDT.P",
  "AKTUSDT.P",
  "COMPUSDT.P",
  "NEARUSDT.P",
  "ADAUSDT.P",
  "EURUSDT.P",
  "GBPUSDT.P",
  "AUDUSDT.P",
];

const DEFAULT_INDICATORS: Record<IndicatorKey, boolean> = {
  ema20: false,
  ema50: false,
  ema200: false,
  emaSet: false,
  bollinger: false,
  rsi: false,
  macd: false,
  adx: false,
  squeeze: false,
  volume: true,
};

const DEFAULT_HIDDEN: Record<IndicatorKey, boolean> = {
  ema20: false,
  ema50: false,
  ema200: false,
  emaSet: false,
  bollinger: false,
  rsi: false,
  macd: false,
  adx: false,
  squeeze: false,
  volume: false,
};

interface ChartState {
  symbol: string;
  timeframe: Timeframe;
  /** Indicator is added to the chart (appears in pill + renders unless hidden) */
  indicators: Record<IndicatorKey, boolean>;
  /** Indicator is hidden (eye icon off) — kept in pill list, just not rendered */
  hidden: Record<IndicatorKey, boolean>;
  /** Periods and parameters for each indicator */
  config: IndicatorConfig;
  /** Visual styles per indicator */
  indicatorStyles: Partial<Record<IndicatorKey, IndicatorStyle>>;
  watchlist: string[];

  // Ephemeral UI state (not persisted)
  tool: DrawingTool;
  priceLines: PriceLine[];
  drawings: DrawingShape[];
  selectedDrawingId: string | null;
  candleTheme: "default" | "classic" | "mono";
  symbolDialogOpen: boolean;
  /** Which indicator's settings dialog is open (null = closed) */
  settingsTarget: IndicatorKey | null;

  // Actions
  setSymbol: (s: string) => void;
  setTimeframe: (t: Timeframe) => void;
  toggleIndicator: (key: IndicatorKey) => void;
  removeIndicator: (key: IndicatorKey) => void;
  toggleHidden: (key: IndicatorKey) => void;
  setConfig: (patch: Partial<IndicatorConfig>) => void;
  setIndicatorStyle: (key: IndicatorKey, patch: IndicatorStyle) => void;
  addToWatchlist: (s: string) => void;
  removeFromWatchlist: (s: string) => void;
  setTool: (t: DrawingTool) => void;
  addPriceLine: (price: number, symbol: string) => void;
  clearPriceLines: (symbol?: string) => void;
  addDrawing: (shape: Omit<DrawingShape, "id">) => void;
  updateDrawing: (id: string, patch: Partial<Omit<DrawingShape, "id" | "symbol">>) => void;
  removeDrawing: (id: string) => void;
  clearDrawings: (symbol?: string) => void;
  selectDrawing: (id: string | null) => void;
  setCandleTheme: (theme: "default" | "classic" | "mono") => void;
  setSymbolDialogOpen: (v: boolean) => void;
  setSettingsTarget: (k: IndicatorKey | null) => void;
}

export const useChartStore = create<ChartState>()(
  persist(
    (set) => ({
      symbol: "BTCUSDT.P",
      timeframe: "15m" as Timeframe,
      indicators: { ...DEFAULT_INDICATORS },
      hidden: { ...DEFAULT_HIDDEN },
      config: { ...DEFAULT_CONFIG },
      indicatorStyles: {},
      watchlist: DEFAULT_WATCHLIST,
      tool: "cursor",
      priceLines: [],
      drawings: [],
      selectedDrawingId: null,
      candleTheme: "default",
      symbolDialogOpen: false,
      settingsTarget: null,

      setSymbol: (symbol) => set({ symbol }),
      setTimeframe: (timeframe) => set({ timeframe }),
      toggleIndicator: (key) =>
        set((s) => ({
          indicators: { ...s.indicators, [key]: !s.indicators[key] },
          // When re-adding, ensure not hidden
          hidden: !s.indicators[key]
            ? { ...s.hidden, [key]: false }
            : s.hidden,
        })),
      removeIndicator: (key) =>
        set((s) => ({
          indicators: { ...s.indicators, [key]: false },
          hidden: { ...s.hidden, [key]: false },
        })),
      toggleHidden: (key) =>
        set((s) => ({ hidden: { ...s.hidden, [key]: !s.hidden[key] } })),
      setConfig: (patch) =>
        set((s) => ({ config: { ...s.config, ...patch } })),
      setIndicatorStyle: (key, patch) =>
        set((s) => ({
          indicatorStyles: {
            ...s.indicatorStyles,
            [key]: {
              ...(s.indicatorStyles[key] ?? {}),
              ...patch,
            },
          },
        })),
      addToWatchlist: (s) =>
        set((state) => ({
          watchlist: state.watchlist.includes(toPerpSymbol(s))
            ? state.watchlist
            : [...state.watchlist, toPerpSymbol(s)],
        })),
      removeFromWatchlist: (s) =>
        set((state) => ({
          watchlist: state.watchlist.filter((x) => x !== s),
        })),
      setTool: (tool) => set({ tool }),
      addPriceLine: (price, symbol) =>
        set((state) => ({
          priceLines: [
            ...state.priceLines,
            {
              id:
                typeof crypto !== "undefined" && "randomUUID" in crypto
                  ? crypto.randomUUID()
                  : `${Date.now()}-${Math.random()}`,
              symbol,
              price,
            },
          ],
        })),
      clearPriceLines: (symbol) =>
        set((state) => ({
          priceLines: symbol
            ? state.priceLines.filter((p) => p.symbol !== symbol)
            : [],
        })),
      addDrawing: (shape) =>
        set((state) => ({
          drawings: [
            ...state.drawings,
            {
              ...shape,
              id:
                typeof crypto !== "undefined" && "randomUUID" in crypto
                  ? crypto.randomUUID()
                  : `${Date.now()}-${Math.random()}`,
            },
          ],
          selectedDrawingId: null,
        })),
      updateDrawing: (id, patch) =>
        set((state) => ({
          drawings: state.drawings.map((shape) =>
            shape.id === id ? { ...shape, ...patch } : shape,
          ),
        })),
      removeDrawing: (id) =>
        set((state) => ({
          drawings: state.drawings.filter((shape) => shape.id !== id),
          selectedDrawingId: state.selectedDrawingId === id ? null : state.selectedDrawingId,
        })),
      clearDrawings: (symbol) =>
        set((state) => ({
          drawings: symbol
            ? state.drawings.filter((shape) => shape.symbol !== symbol)
            : [],
          selectedDrawingId:
            symbol && state.selectedDrawingId
              ? state.drawings.some((shape) => shape.id === state.selectedDrawingId && shape.symbol === symbol)
                ? null
                : state.selectedDrawingId
              : null,
        })),
      selectDrawing: (selectedDrawingId) => set({ selectedDrawingId }),
      setCandleTheme: (candleTheme) => set({ candleTheme }),
      setSymbolDialogOpen: (symbolDialogOpen) => set({ symbolDialogOpen }),
      setSettingsTarget: (settingsTarget) => set({ settingsTarget }),
    }),
    {
      name: "tv-gratis-chart-state",
      version: 3,
      migrate: (persistedState, _version) => {
        const state = persistedState as Partial<ChartState> | null;
        const migratedWatchlist = Array.isArray(state?.watchlist)
          ? state.watchlist.map((s) => toPerpSymbol(s))
          : DEFAULT_WATCHLIST;
        const forexMajors = ["EURUSDT.P", "GBPUSDT.P", "AUDUSDT.P"];
        const watchlistWithForex = [...migratedWatchlist];
        for (const forex of forexMajors) {
          if (!watchlistWithForex.some((s) => toPerpSymbol(s) === forex)) {
            watchlistWithForex.push(forex);
          }
        }

        return {
          symbol: typeof state?.symbol === "string" ? toPerpSymbol(state.symbol) : "BTCUSDT.P",
          timeframe: (state?.timeframe ?? "15m") as Timeframe,
          indicators: { ...DEFAULT_INDICATORS },
          hidden: { ...DEFAULT_HIDDEN },
          config: { ...DEFAULT_CONFIG },
          indicatorStyles: {},
          watchlist: watchlistWithForex,
          tool: "cursor",
          priceLines: [],
          drawings: [],
          selectedDrawingId: null,
          candleTheme: "default" as const,
          symbolDialogOpen: false,
          settingsTarget: null,
        };
      },
      partialize: (s) => ({
        symbol: s.symbol,
        timeframe: s.timeframe,
        indicators: s.indicators,
        hidden: s.hidden,
        config: s.config,
        indicatorStyles: s.indicatorStyles,
        watchlist: s.watchlist,
        drawings: s.drawings,
        candleTheme: s.candleTheme,
      }),
    },
  ),
);
