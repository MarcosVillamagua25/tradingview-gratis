"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  useChartStore,
  DEFAULT_CONFIG,
  type IndicatorKey,
  type IndicatorStyle,
  type MAConfig,
} from "@/lib/store/chart-store";

const TITLES: Record<IndicatorKey, string> = {
  ema20: "EMA — Slot 1",
  ema50: "EMA — Slot 2",
  ema200: "EMA — Slot 3",
  emaSet: "EMA/MA Set",
  bollinger: "Bandas de Bollinger",
  rsi: "RSI",
  macd: "MACD",
  adx: "ADX",
  squeeze: "Squeeze Momentum",
  volume: "Volumen",
};

export function IndicatorSettingsDialog() {
  const target = useChartStore((s) => s.settingsTarget);
  const setTarget = useChartStore((s) => s.setSettingsTarget);
  const config = useChartStore((s) => s.config);
  const setConfig = useChartStore((s) => s.setConfig);
  const indicatorStyles = useChartStore((s) => s.indicatorStyles);
  const setIndicatorStyle = useChartStore((s) => s.setIndicatorStyle);

  const open = target !== null;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setTarget(null);
      }}
    >
      <DialogContent className="max-w-sm bg-tv-panel">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">
            {target ? TITLES[target] : ""} — Configuración
          </DialogTitle>
        </DialogHeader>
        {target && (
          <SettingsForm
            key={target}
            target={target}
            config={config}
            style={indicatorStyles[target]}
            onSave={(patch, stylePatch) => {
              setConfig(patch);
              if (stylePatch) setIndicatorStyle(target, stylePatch);
              setTarget(null);
            }}
            onReset={() => {
              setConfig(DEFAULT_CONFIG);
              setTarget(null);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

interface FormProps {
  target: IndicatorKey;
  config: typeof DEFAULT_CONFIG;
  style?: IndicatorStyle;
  onSave: (patch: Partial<typeof DEFAULT_CONFIG>, stylePatch?: IndicatorStyle) => void;
  onReset: () => void;
}

function SettingsForm({ target, config, style, onSave, onReset }: FormProps) {
  // Local draft state to avoid recalculating chart on every keystroke
  const [draft, setDraft] = useState({
    ema20: config.ema20,
    ema50: config.ema50,
    ema200: config.ema200,
    rsi: config.rsi,
    macdFast: config.macdFast,
    macdSlow: config.macdSlow,
    macdSignal: config.macdSignal,
    maSet: (config.maSet ?? DEFAULT_CONFIG.maSet ?? []).map((slot) => ({ ...slot })),
    adxPeriod: config.adxPeriod ?? 14,
    squeezeBBLength: config.squeezeBBLength ?? 20,
    squeezeKeltnerLength: config.squeezeKeltnerLength ?? 20,
    styleColor: style?.color ?? "#64b5f6",
    styleWidth: style?.lineWidth ?? 1,
  });

  function save() {
    const stylePatch: IndicatorStyle = {
      color: draft.styleColor,
      lineWidth: clamp(draft.styleWidth, 1, 4),
    };
    if (target === "ema20") onSave({ ema20: clamp(draft.ema20, 2, 500) }, stylePatch);
    else if (target === "ema50") onSave({ ema50: clamp(draft.ema50, 2, 500) }, stylePatch);
    else if (target === "ema200") onSave({ ema200: clamp(draft.ema200, 2, 500) }, stylePatch);
    else if (target === "bollinger") onSave({}, stylePatch);
    else if (target === "rsi") onSave({ rsi: clamp(draft.rsi, 2, 100) }, stylePatch);
    else if (target === "macd")
      onSave({
        macdFast: clamp(draft.macdFast, 2, 100),
        macdSlow: clamp(draft.macdSlow, 2, 200),
        macdSignal: clamp(draft.macdSignal, 2, 100),
      }, stylePatch);
    else if (target === "emaSet") {
      const sanitized = draft.maSet.slice(0, 7).map((slot, idx) => ({
        enabled: !!slot.enabled,
        period: clamp(slot.period, 2, 500),
        color: slot.color || (DEFAULT_CONFIG.maSet?.[idx]?.color ?? "#f59e0b"),
      }));
      onSave({ maSet: sanitized }, stylePatch);
    } else if (target === "adx") {
      onSave({ adxPeriod: clamp(draft.adxPeriod, 2, 200) }, stylePatch);
    } else if (target === "squeeze") {
      onSave({ squeezeBBLength: clamp(draft.squeezeBBLength, 2, 200), squeezeKeltnerLength: clamp(draft.squeezeKeltnerLength, 2, 200) }, stylePatch);
    } else if (target === "volume") onSave({}, stylePatch);
  }

  return (
    <div className="flex flex-col gap-3">
      {(target === "ema20" || target === "ema50" || target === "ema200") && (
        <Field
          label="Período"
          value={draft[target]}
          onChange={(n) => setDraft((d) => ({ ...d, [target]: n }))}
        />
      )}
      {target === "bollinger" && (
        <p className="text-xs text-tv-text-muted">
          Configuración fija: período 20 y desviación estándar 2.
        </p>
      )}
      {target === "rsi" && (
        <Field
          label="Período"
          value={draft.rsi}
          onChange={(n) => setDraft((d) => ({ ...d, rsi: n }))}
        />
      )}
      {target === "macd" && (
        <div className="grid grid-cols-3 gap-2">
          <Field
            label="Rápida"
            value={draft.macdFast}
            onChange={(n) => setDraft((d) => ({ ...d, macdFast: n }))}
          />
          <Field
            label="Lenta"
            value={draft.macdSlow}
            onChange={(n) => setDraft((d) => ({ ...d, macdSlow: n }))}
          />
          <Field
            label="Señal"
            value={draft.macdSignal}
            onChange={(n) => setDraft((d) => ({ ...d, macdSignal: n }))}
          />
        </div>
      )}
      {target === "volume" && (
        <p className="text-xs text-tv-text-muted">
          El indicador de volumen no tiene parámetros configurables en esta
          versión.
        </p>
      )}
      {(target === "emaSet" || target === "adx" || target === "squeeze") && (
        <>
          {target === "emaSet" && (
            <div className="flex flex-col gap-2">
              {draft.maSet.slice(0, 7).map((slot, idx) => (
                <MaRow
                  key={idx}
                  index={idx}
                  slot={slot}
                  onChange={(next) =>
                    setDraft((d) => ({
                      ...d,
                      maSet: d.maSet.map((item, i) => (i === idx ? next : item)),
                    }))
                  }
                />
              ))}
            </div>
          )}
          {target === "adx" && (
            <Field
              label="Período ADX"
              value={draft.adxPeriod}
              onChange={(n) => setDraft((d) => ({ ...d, adxPeriod: n }))}
            />
          )}
          {target === "squeeze" && (
            <div className="grid grid-cols-2 gap-2">
              <Field
                label="BB Length"
                value={draft.squeezeBBLength}
                onChange={(n) => setDraft((d) => ({ ...d, squeezeBBLength: n }))}
              />
              <Field
                label="Keltner Length"
                value={draft.squeezeKeltnerLength}
                onChange={(n) => setDraft((d) => ({ ...d, squeezeKeltnerLength: n }))}
              />
            </div>
          )}
        </>
      )}

      {target !== "emaSet" && (
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-tv-text-muted">
            Color
          </span>
          <Input
            type="color"
            value={draft.styleColor}
            onChange={(e) => setDraft((d) => ({ ...d, styleColor: e.target.value }))}
            className="h-9 bg-tv-bg p-1"
          />
        </label>
        <Field
          label="Grosor"
          value={draft.styleWidth}
          onChange={(n) => setDraft((d) => ({ ...d, styleWidth: n }))}
        />
      </div>
      )}

      <div className="mt-2 flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={onReset}
          className="text-tv-text-muted hover:text-tv-text"
        >
          Reset defaults
        </Button>
        <Button size="sm" onClick={save} className="bg-tv-blue hover:bg-tv-blue/90">
          Aplicar
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-tv-text-muted">
        {label}
      </span>
      <Input
        type="number"
        min={2}
        max={500}
        value={value}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (!isNaN(n)) onChange(n);
        }}
        className="bg-tv-bg tabular-nums"
      />
    </label>
  );
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function MaRow({
  index,
  slot,
  onChange,
}: {
  index: number;
  slot: MAConfig;
  onChange: (next: MAConfig) => void;
}) {
  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
      <label className="flex items-center gap-1 text-xs text-tv-text">
        <input
          type="checkbox"
          checked={slot.enabled}
          onChange={(e) => onChange({ ...slot, enabled: e.target.checked })}
        />
        MA {index + 1}
      </label>
      <Input
        type="number"
        min={2}
        max={500}
        value={slot.period}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (!isNaN(n)) onChange({ ...slot, period: n });
        }}
        className="h-8 bg-tv-bg"
      />
      <Input
        type="color"
        value={slot.color}
        onChange={(e) => onChange({ ...slot, color: e.target.value })}
        className="h-8 w-12 bg-tv-bg p-1"
      />
    </div>
  );
}
