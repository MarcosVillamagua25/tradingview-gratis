"use client";

import {
  ArrowDownRight,
  ArrowUpRight,
  Brush,
  CandlestickChart,
  ChartLine,
  Lock,
  Minus,
  MousePointer2,
  Ruler,
  Square,
  Trash2,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useChartStore, type DrawingTool } from "@/lib/store/chart-store";
import { cn } from "@/lib/utils";

interface ToolDef {
  key: DrawingTool;
  icon: typeof MousePointer2;
  label: string;
  hint?: string;
}

const TOOLS: ToolDef[] = [
  { key: "cursor", icon: MousePointer2, label: "Cursor", hint: "Modo navegación" },
  {
    key: "hline",
    icon: Minus,
    label: "Línea horizontal",
    hint: "Click en el chart para marcar un precio",
  },
  {
    key: "measure",
    icon: Ruler,
    label: "Regla / Medir",
    hint: "Click en dos puntos para medir Δ precio, %, barras y volumen",
  },
  {
    key: "trendline",
    icon: ChartLine,
    label: "Línea de tendencia",
    hint: "Arrastra para crear una línea entre dos puntos",
  },
  {
    key: "fibonacci",
    icon: CandlestickChart,
    label: "Retroceso Fibonacci",
    hint: "Arrastra para medir niveles de retroceso",
  },
  {
    key: "brush",
    icon: Brush,
    label: "Pincel",
    hint: "Dibujo libre con el mouse",
  },
  {
    key: "position-long",
    icon: ArrowUpRight,
    label: "Posición larga",
    hint: "Arrastra para marcar una posición long",
  },
  {
    key: "position-short",
    icon: ArrowDownRight,
    label: "Posición corta",
    hint: "Arrastra para marcar una posición short",
  },
  {
    key: "rectangle",
    icon: Square,
    label: "Rectángulo",
    hint: "Arrastra para delimitar un rango",
  },
];

export function LeftSidebar() {
  const tool = useChartStore((s) => s.tool);
  const setTool = useChartStore((s) => s.setTool);
  const clearPriceLines = useChartStore((s) => s.clearPriceLines);
  const clearDrawings = useChartStore((s) => s.clearDrawings);
  const symbol = useChartStore((s) => s.symbol);

  return (
    <aside className="flex w-11 flex-col items-center gap-0.5 overflow-y-auto border-r border-tv-border bg-tv-panel py-1.5">
      {TOOLS.map((t) => {
        const Icon = t.icon;
        const active = tool === t.key;
        return (
          <Tooltip key={t.key}>
            <TooltipTrigger
              onClick={() => setTool(t.key)}
              aria-label={t.label}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded transition-colors hover:bg-tv-panel-hover",
                active
                  ? "bg-tv-blue/15 text-tv-blue"
                  : "text-tv-text-muted hover:text-tv-text",
              )}
            >
              <Icon className="h-4 w-4" />
            </TooltipTrigger>
            <TooltipContent side="right" className="text-xs">
              <div className="font-medium">{t.label}</div>
              {t.hint && (
                <div className="mt-0.5 text-[10px] text-tv-text-muted">{t.hint}</div>
              )}
            </TooltipContent>
          </Tooltip>
        );
      })}

      <Tooltip>
        <TooltipTrigger
          onClick={() => {
            clearPriceLines(symbol);
            clearDrawings(symbol);
          }}
          aria-label="Borrar dibujos"
          className="flex h-8 w-8 items-center justify-center rounded text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-red"
        >
          <Trash2 className="h-4 w-4" />
        </TooltipTrigger>
        <TooltipContent side="right" className="text-xs">
          <div className="font-medium">Borrar dibujos</div>
          <div className="mt-0.5 text-[10px] text-tv-text-muted">
            Limpia las líneas y figuras de este símbolo
          </div>
        </TooltipContent>
      </Tooltip>

      <div className="my-1 h-px w-6 bg-tv-border" />

      <Tooltip>
        <TooltipTrigger
          disabled
          aria-label="Bloqueado"
          className="flex h-8 w-8 cursor-not-allowed items-center justify-center rounded text-tv-text-dim opacity-40"
        >
          <Lock className="h-3.5 w-3.5" />
        </TooltipTrigger>
        <TooltipContent side="right" className="text-xs">
          <div className="font-medium">Más herramientas</div>
          <div className="mt-0.5 text-[10px] text-tv-yellow">
            Próximamente · edición avanzada
          </div>
        </TooltipContent>
      </Tooltip>
    </aside>
  );
}
