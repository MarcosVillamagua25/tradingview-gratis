"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import type { IChartApi, ISeriesApi, UTCTimestamp } from "lightweight-charts";
import type { Candle } from "@/lib/binance/types";
import {
  useChartStore,
  type DrawingShape,
  type DrawingShapeKind,
  type DrawingTool,
  type DrawingPoint,
} from "@/lib/store/chart-store";

interface Props {
  tool: DrawingTool;
  symbol: string;
  renderTick: number;
  chartRef: RefObject<IChartApi | null>;
  candleSeriesRef: RefObject<ISeriesApi<"Candlestick"> | null>;
  candlesRef: RefObject<Candle[]>;
  mainPaneHeight: number;
}

type InteractionState = {
  kind: DrawingShapeKind;
  pointerId: number;
  points: DrawingPoint[];
};

const ACTIVE_TOOLS = new Set<DrawingTool>([
  "trendline",
  "fibonacci",
  "brush",
  "position-long",
  "position-short",
  "rectangle",
]);

const TOOL_STYLES: Record<
  DrawingShapeKind,
  { stroke: string; fill: string; width: number }
> = {
  trendline: { stroke: "#64b5f6", fill: "rgba(100, 181, 246, 0.12)", width: 2 },
  fibonacci: { stroke: "#f4c430", fill: "rgba(244, 196, 48, 0.10)", width: 1.5 },
  brush: { stroke: "#ab47bc", fill: "rgba(171, 71, 188, 0.12)", width: 2.5 },
  "position-long": { stroke: "#26a69a", fill: "rgba(38, 166, 154, 0.18)", width: 1.8 },
  "position-short": { stroke: "#ef5350", fill: "rgba(239, 83, 80, 0.18)", width: 1.8 },
  rectangle: { stroke: "#64b5f6", fill: "rgba(100, 181, 246, 0.14)", width: 1.8 },
};

function isDrawingTool(tool: DrawingTool): tool is DrawingShapeKind {
  return ACTIVE_TOOLS.has(tool as DrawingTool);
}

function distance(a: DrawingPoint, b: DrawingPoint) {
  const dx = a.time - b.time;
  const dy = a.price - b.price;
  return Math.sqrt(dx * dx + dy * dy);
}

function durationLabel(start: number, end: number) {
  const diff = Math.abs(end - start);
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

function makePoint(time: number, price: number): DrawingPoint {
  return { time, price };
}

function buildShape(
  kind: DrawingShapeKind,
  symbol: string,
  points: DrawingPoint[],
): Omit<DrawingShape, "id"> {
  const style = TOOL_STYLES[kind];
  return {
    symbol,
    kind,
    points,
    color: style.stroke,
    fill: style.fill,
    width: style.width,
  };
}

export function DrawingLayer({
  tool,
  symbol,
  renderTick,
  chartRef,
  candleSeriesRef,
  candlesRef,
  mainPaneHeight,
}: Props) {
  const drawings = useChartStore((s) => s.drawings);
  const addDrawing = useChartStore((s) => s.addDrawing);
  const [draft, setDraft] = useState<DrawingShape | null>(null);
  const interactionRef = useRef<InteractionState | null>(null);

  useEffect(() => {
    interactionRef.current = null;
    setDraft(null);
  }, [tool, symbol]);

  const symbolDrawings = useMemo(
    () => drawings.filter((shape) => shape.symbol === symbol),
    [drawings, symbol],
  );

  function nearestCandle(time: number) {
    const candles = candlesRef.current;
    if (candles.length === 0) return null;
    let best = candles[0];
    let bestDiff = Math.abs(candles[0].time - time);
    for (const candle of candles) {
      const diff = Math.abs(candle.time - time);
      if (diff < bestDiff) {
        best = candle;
        bestDiff = diff;
      }
    }
    return best;
  }

  function snapPoint(x: number, y: number, ctrlKey: boolean): DrawingPoint | null {
    if (mainPaneHeight > 0 && y > mainPaneHeight) return null;
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    if (!chart || !series) return null;

    const timeValue = chart.timeScale().coordinateToTime(x);
    const rawTime = typeof timeValue === "number" ? timeValue : null;
    if (rawTime === null) return null;

    const rawPrice = series.coordinateToPrice(y);
    if (rawPrice === null || !isFinite(rawPrice)) return null;

    const candle = nearestCandle(rawTime);
    if (!candle) return makePoint(rawTime, rawPrice);

    if (!ctrlKey) {
      return makePoint(rawTime, rawPrice);
    }

    const priceCandidates = [candle.open, candle.close, candle.high, candle.low];
    let snappedPrice = priceCandidates[0];
    let priceDiff = Math.abs(snappedPrice - rawPrice);
    for (const candidate of priceCandidates) {
      const diff = Math.abs(candidate - rawPrice);
      if (diff < priceDiff) {
        snappedPrice = candidate;
        priceDiff = diff;
      }
    }

    return makePoint(candle.time, snappedPrice);
  }

  function getPointFromEvent(event: ReactPointerEvent<HTMLDivElement>): DrawingPoint | null {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    return snapPoint(x, y, event.ctrlKey || event.metaKey);
  }

  function updateDraft(points: DrawingPoint[], kind: DrawingShapeKind) {
    setDraft({
      id: "draft",
      ...buildShape(kind, symbol, points),
    });
  }

  function finalizeDraft() {
    const current = interactionRef.current;
    if (!current) return;
    const points = current.points;
    if (current.kind === "brush") {
      if (points.length > 1) {
        addDrawing(buildShape(current.kind, symbol, points));
      }
    } else if (points.length >= 2) {
      const start = points[0];
      const end = points[points.length - 1];
      if (Math.abs(start.time - end.time) > 0 || Math.abs(start.price - end.price) > 0) {
        addDrawing(buildShape(current.kind, symbol, [start, end]));
      }
    }
    interactionRef.current = null;
    setDraft(null);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!isDrawingTool(tool)) return;
    const point = getPointFromEvent(event);
    if (!point) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    if (tool === "brush") {
      interactionRef.current = { kind: tool, pointerId: event.pointerId, points: [point] };
      updateDraft([point], tool);
      return;
    }

    const initialPoints = [point, point];
    interactionRef.current = { kind: tool, pointerId: event.pointerId, points: initialPoints };
    updateDraft(initialPoints, tool);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const current = interactionRef.current;
    if (!current || current.pointerId !== event.pointerId) return;

    const point = getPointFromEvent(event);
    if (!point) return;

    if (current.kind === "brush") {
      const last = current.points[current.points.length - 1];
      if (!last || distance(last, point) >= 0.5) {
        current.points.push(point);
        updateDraft([...current.points], current.kind);
      }
      return;
    }

    current.points[1] = point;
    updateDraft([...current.points], current.kind);
  }

  function handlePointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    const current = interactionRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    finalizeDraft();
  }

  function renderLine(shape: DrawingShape, preview = false) {
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    if (!chart || !series || shape.points.length < 2) return null;
    const ts = chart.timeScale();
    const a = shape.points[0];
    const b = shape.points[shape.points.length - 1];
    const aX = ts.timeToCoordinate(a.time as UTCTimestamp);
    const bX = ts.timeToCoordinate(b.time as UTCTimestamp);
    const aY = series.priceToCoordinate(a.price);
    const bY = series.priceToCoordinate(b.price);
    if (aX === null || bX === null || aY === null || bY === null) return null;

    return (
      <g key={shape.id}>
        <line
          x1={aX}
          y1={aY}
          x2={bX}
          y2={bY}
          stroke={shape.color}
          strokeWidth={shape.width ?? 2}
          strokeDasharray={preview ? "4,3" : undefined}
        />
        <circle cx={aX} cy={aY} r={3} fill={shape.color} opacity={0.9} />
        <circle cx={bX} cy={bY} r={3} fill={shape.color} opacity={0.9} />
      </g>
    );
  }

  function renderRectangle(shape: DrawingShape, preview = false, label?: string) {
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    if (!chart || !series || shape.points.length < 2) return null;
    const ts = chart.timeScale();
    const a = shape.points[0];
    const b = shape.points[shape.points.length - 1];
    const aX = ts.timeToCoordinate(a.time as UTCTimestamp);
    const bX = ts.timeToCoordinate(b.time as UTCTimestamp);
    const aY = series.priceToCoordinate(a.price);
    const bY = series.priceToCoordinate(b.price);
    if (aX === null || bX === null || aY === null || bY === null) return null;

    const left = Math.min(aX, bX);
    const right = Math.max(aX, bX);
    const top = Math.min(aY, bY);
    const bottom = Math.max(aY, bY);
    const width = Math.max(1, right - left);
    const height = Math.max(1, bottom - top);

    return (
      <g key={shape.id}>
        <rect
          x={left}
          y={top}
          width={width}
          height={height}
          fill={shape.fill}
          stroke={shape.color}
          strokeWidth={shape.width ?? 1.8}
          strokeDasharray={preview ? "4,3" : undefined}
        />
        <circle cx={aX} cy={aY} r={3} fill={shape.color} opacity={0.9} />
        <circle cx={bX} cy={bY} r={3} fill={shape.color} opacity={0.9} />
        {label && (
          <text x={left + 6} y={top + 14} fill={shape.color} fontSize={11} fontWeight={600}>
            {label}
          </text>
        )}
      </g>
    );
  }

  function renderBrush(shape: DrawingShape, preview = false) {
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    if (!chart || !series || shape.points.length < 2) return null;
    const ts = chart.timeScale();
    const path = shape.points
      .map((pt, idx) => {
        const x = ts.timeToCoordinate(pt.time as UTCTimestamp);
        const y = series.priceToCoordinate(pt.price);
        if (x === null || y === null) return null;
        return `${idx === 0 ? "M" : "L"} ${x} ${y}`;
      })
      .filter(Boolean)
      .join(" ");
    if (!path) return null;

    return (
      <path
        key={shape.id}
        d={path}
        fill="none"
        stroke={shape.color}
        strokeWidth={shape.width ?? 2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={preview ? "4,3" : undefined}
      />
    );
  }

  function renderFibonacci(shape: DrawingShape, preview = false) {
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    if (!chart || !series || shape.points.length < 2) return null;
    const ts = chart.timeScale();
    const a = shape.points[0];
    const b = shape.points[shape.points.length - 1];
    const aX = ts.timeToCoordinate(a.time as UTCTimestamp);
    const bX = ts.timeToCoordinate(b.time as UTCTimestamp);
    const aY = series.priceToCoordinate(a.price);
    const bY = series.priceToCoordinate(b.price);
    if (aX === null || bX === null || aY === null || bY === null) return null;

    const left = Math.min(aX, bX);
    const right = Math.max(aX, bX);
    const top = Math.min(aY, bY);
    const bottom = Math.max(aY, bY);
    const priceDelta = b.price - a.price;
    const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

    return (
      <g key={shape.id}>
        <rect
          x={left}
          y={top}
          width={Math.max(1, right - left)}
          height={Math.max(1, bottom - top)}
          fill={shape.fill}
          stroke={shape.color}
          strokeWidth={shape.width ?? 1.5}
          strokeDasharray={preview ? "4,3" : undefined}
        />
        {levels.map((ratio) => {
          const y = series.priceToCoordinate(a.price + priceDelta * ratio);
          if (y === null) return null;
          const label = `${(ratio * 100).toFixed(1)}%`;
          return (
            <g key={label}>
              <line
                x1={left}
                x2={right}
                y1={y}
                y2={y}
                stroke={shape.color}
                strokeWidth={1}
                strokeDasharray="3,4"
                opacity={0.9}
              />
              <text x={right + 6} y={y - 3} fill={shape.color} fontSize={10}>
                {label}
              </text>
            </g>
          );
        })}
        <circle cx={aX} cy={aY} r={3} fill={shape.color} opacity={0.9} />
        <circle cx={bX} cy={bY} r={3} fill={shape.color} opacity={0.9} />
      </g>
    );
  }

  function renderPosition(shape: DrawingShape, preview = false) {
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    if (!chart || !series || shape.points.length < 2) return null;
    const ts = chart.timeScale();
    const a = shape.points[0];
    const b = shape.points[shape.points.length - 1];
    const aX = ts.timeToCoordinate(a.time as UTCTimestamp);
    const bX = ts.timeToCoordinate(b.time as UTCTimestamp);
    const aY = series.priceToCoordinate(a.price);
    const bY = series.priceToCoordinate(b.price);
    if (aX === null || bX === null || aY === null || bY === null) return null;

    const left = Math.min(aX, bX);
    const right = Math.max(aX, bX);
    const top = Math.min(aY, bY);
    const bottom = Math.max(aY, bY);
    const width = Math.max(1, right - left);
    const height = Math.max(1, bottom - top);
    const isLong = shape.kind === "position-long";
    const label = isLong ? "Long" : "Short";

    return (
      <g key={shape.id}>
        <rect
          x={left}
          y={top}
          width={width}
          height={height}
          fill={shape.fill}
          stroke={shape.color}
          strokeWidth={shape.width ?? 1.8}
          strokeDasharray={preview ? "4,3" : undefined}
        />
        <line
          x1={left}
          x2={right}
          y1={isLong ? bottom : top}
          y2={isLong ? bottom : top}
          stroke={shape.color}
          strokeWidth={2}
        />
        <text x={left + 8} y={top + 16} fill={shape.color} fontSize={12} fontWeight={700}>
          {label}
        </text>
        <text x={left + 8} y={top + 30} fill={shape.color} fontSize={10}>
          {durationLabel(a.time, b.time)}
        </text>
      </g>
    );
  }

  function renderShape(shape: DrawingShape, preview = false) {
    switch (shape.kind) {
      case "trendline":
        return renderLine(shape, preview);
      case "brush":
        return renderBrush(shape, preview);
      case "fibonacci":
        return renderFibonacci(shape, preview);
      case "position-long":
      case "position-short":
        return renderPosition(shape, preview);
      case "rectangle":
        return renderRectangle(shape, preview);
      default:
        return null;
    }
  }

  const active = isDrawingTool(tool);
  const drawnShapes = symbolDrawings.map((shape) => renderShape(shape));
  const draftShape = draft ? renderShape(draft, true) : null;
  void renderTick;

  return (
    <div
      className={active ? "pointer-events-auto absolute inset-0 z-20" : "pointer-events-none absolute inset-0 z-20"}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onDoubleClick={() => {
        interactionRef.current = null;
        setDraft(null);
      }}
    >
      <svg className="h-full w-full" style={{ overflow: "visible" }}>
        {drawnShapes}
        {draftShape}
      </svg>
    </div>
  );
}
