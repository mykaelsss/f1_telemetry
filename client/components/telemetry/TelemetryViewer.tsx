"use client";

import { useLapTelemetry } from "@/lib/hooks/useLapTelemetry";
import { useMemo, useEffect, useRef, useState, useCallback } from "react";
import { useTelemetrySettings } from "@/lib/hooks/useTelemetrySettings";
import { useCircuitInfo } from "@/lib/hooks/useCircuitInfo";
import { EChartsOption, getInstanceByDom } from "echarts";
import { useEcharts } from "@/lib/hooks/useEcharts";
import { defaultTelemetryChannelSettings } from "@/lib/utils";
import type { Compound, SelectedLap, TelemetrySettings } from "@/lib/types";
import { Eye, EyeOff, Loader2, Play, X, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import ReplayModal from "./replay/ReplayModal";
import { toast } from "sonner";
import {
  consumeLapAwaitingReview,
  lapAddedToast,
  lapReadyToast,
} from "@/lib/toasts";
import { parseSelectedLaps, toggleLap } from "@/lib/selectedLaps";
import { seriesKey } from "@/lib/seriesKey";
import { formatLapTime } from "@/lib/format";
import { fetchSession } from "@/lib/api";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import TyreBadge from "./TyreBadge";
import { allocateColorSlots, lapColor } from "@/lib/colors";
import { useTelemetrySeries } from "@/lib/hooks/useTelemetrySeries";
import TelemetrySettingsPanel from "./TelemetrySettingsPanel";
import ColorSwatch from "../ui/ColorSwatch";
import { CHANNELS, DEFAULT_NUQS_OPTIONS, GRID_GAP, GRID_HEIGHT } from "@/lib/constants";
import { CHART_STRUCTURE } from "@/lib/chartStructure";
import { buildTooltipFormatter } from "@/lib/buildTooltipFormatter";
import { useToggleSeries } from "@/lib/hooks/useToggleSeries";
import { useAsRef } from "@/hooks/use-as-ref";
import { useQueryState } from "nuqs";

function resolveChannelSettings(ts: TelemetrySettings, chIdx: number) {
  const channel = CHANNELS[chIdx];
  return ts.useGlobalSettings
    ? ts.global
    : (ts.channels[channel as string] ?? defaultTelemetryChannelSettings);
}

export default function TelemetryViewer() {
  const telemetrySettings = useTelemetrySettings();
  const queryClient = useQueryClient();
  const [year] = useQueryState('year', DEFAULT_NUQS_OPTIONS);
  const [event] = useQueryState('event', DEFAULT_NUQS_OPTIONS);
  const [laps, setLaps] = useQueryState('laps', DEFAULT_NUQS_OPTIONS);
  const [, setTab] = useQueryState('tab', DEFAULT_NUQS_OPTIONS)
  const [replayParam, setReplayParam] = useQueryState('replay', DEFAULT_NUQS_OPTIONS);
  const [replayTimeParam, setReplayTimeParam] = useQueryState('rt', DEFAULT_NUQS_OPTIONS);
  const [replayLoopParam, setReplayLoopParam] = useQueryState('rl', DEFAULT_NUQS_OPTIONS);

  const chartRef = useEcharts();
  const hoveredSeriesRef = useRef<string | null>(null);
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());
  const [isZoomed, setIsZoomed] = useState(false);
  const [customColors, setCustomColors] = useState<Record<string, string>>({});
  const customColorsRef = useAsRef(customColors);
  const [colorSlots, setColorSlots] = useState<Record<string, number>>(() =>
    allocateColorSlots({}, parseSelectedLaps(laps).map(seriesKey)),
  );

  const toggleSeries = useToggleSeries(hiddenSeries, setHiddenSeries, chartRef);

  const selectedLaps = useMemo(() => parseSelectedLaps(laps), [laps]);

  const removeLap = useCallback(
    (lap: SelectedLap) => {
      toggleLap(selectedLaps, lap, {
        queryClient,
        setLaps,
        setTab
      });
    },
    [selectedLaps, setTab, setLaps, queryClient],
  );

  const [prevLaps, setPrevLaps] = useState(laps);
  if (laps !== prevLaps) {
    setPrevLaps(laps);
    const orderedKeys = selectedLaps.map(seriesKey);
    const validKeys = new Set(orderedKeys);
    setColorSlots((prev) => allocateColorSlots(prev, orderedKeys));
    setCustomColors((prev) => {
      const next = Object.fromEntries(
        Object.entries(prev).filter(([k]) => validKeys.has(k)),
      );
      return Object.keys(next).length === Object.keys(prev).length
        ? prev
        : next;
    });
    setHiddenSeries((prev) => {
      const next = new Set<string>();
      for (const k of prev) if (validKeys.has(k)) next.add(k);
      return next.size === prev.size ? prev : next;
    });
  }

  const { data: circuitData } = useCircuitInfo(year, event);
  const {
    data: telemetryData,
    isPending,
    failed,
    pending,
  } = useLapTelemetry(selectedLaps);

  const shownToastsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (shownToastsRef.current === null) return;
    const current = new Set(failed.map((f) => seriesKey(f)));
    for (const key of shownToastsRef.current) {
      if (!current.has(key)) {
        toast.dismiss(`lap-fail-${key}`);
        shownToastsRef.current.delete(key);
      }
    }
    for (const f of failed) {
      const key = seriesKey(f);
      if (shownToastsRef.current.has(key)) continue;
      toast.error(`${f.driver} Lap ${f.lap} failed to load`, {
        id: `lap-fail-${key}`,
        action: {
          label: "Retry",
          onClick: () =>
            f.refetch().then((res) => {
              if (res.status === "success") lapAddedToast(f.driver, f.lap);
            }),
        },
        duration: Infinity,
        closeButton: true,
        className: "border-accent-red!",
      });
      shownToastsRef.current.add(key);
    }
  }, [failed]);

  const {
    series,
    markLineSeries,
    legendItems,
    labelBySeries,
    deltaBySeries,
    commonStart,
    commonEnd,
    refLapName,
    refTimes,
    excluded,
    error,
  } = useTelemetrySeries(telemetryData, circuitData, hiddenSeries, colorSlots);

  const seriesRef = useAsRef(series);

  // Laps that loaded but don't share a distance range with the others are
  // dropped from the chart rather than failing it — surface each one so the
  // user knows why it isn't plotted.
  const excludedToastsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const current = new Set(excluded.map((e) => seriesKey(e)));
    for (const key of excludedToastsRef.current) {
      if (!current.has(key)) {
        toast.dismiss(`lap-excluded-${key}`);
        excludedToastsRef.current.delete(key);
      }
    }
    for (const e of excluded) {
      const key = seriesKey(e);
      if (excludedToastsRef.current.has(key)) continue;
      consumeLapAwaitingReview(key);
      toast.warning(
        `${e.driver} Lap ${e.lap} doesn't overlap the other laps — excluded from comparison`,
        {
          id: `lap-excluded-${key}`,
          duration: Infinity,
          closeButton: true,
          className: "border-data-amber!",
        },
      );
      excludedToastsRef.current.add(key);
    }
  }, [excluded]);

  useEffect(() => {
    if (error) {
      toast.error(error, {
        id: "telemetry-range-error",
        className: "border-accent-red!",
      });
    } else {
      toast.dismiss("telemetry-range-error");
    }
  }, [error]);

  // Announce laps the user added once their telemetry has loaded and rendered.
  useEffect(() => {
    for (const item of legendItems) {
      if (consumeLapAwaitingReview(item.key)) {
        lapReadyToast(item.driver, item.lap, () => setTab("telemetry"));
      }
    }
  }, [legendItems, setTab]);

  useEffect(() => {
    if (!chartRef.current) return;
    const chart = getInstanceByDom(chartRef.current);
    if (!chart) return;
    chart.on("mouseover", (params) => {
      if (params.componentType === "series") {
        hoveredSeriesRef.current = params.seriesName ?? null;
      }
    });
    chart.on("mouseout", () => {
      hoveredSeriesRef.current = null;
    });
    chart.on("globalout", () => {
      hoveredSeriesRef.current = null;
    });
    return () => {
      chart.off("mouseover");
      chart.off("mouseout");
      chart.off("globalout");
    };
  }, [chartRef]);

  useEffect(() => {
    if (!chartRef.current) return;
    const chart = getInstanceByDom(chartRef.current);
    if (!chart) return;
    chart.on("datazoom", (params) => {
      const p = params as {
        batch?: { start?: number; end?: number }[];
        start?: number;
        end?: number;
      };

      let start: number | undefined;
      let end: number | undefined;
      if (p.batch?.[0]) {
        start = p.batch[0].start;
        end = p.batch[0].end;
      } else {
        start = p.start;
        end = p.end;
      }

      if (start == null || end == null) return;
      setIsZoomed(start !== 0 || end !== 100);
    });
    return () => {
      chart.off("datazoom");
    };
  }, [chartRef]);

  const resetZoom = () => {
    if (!chartRef.current) return;
    const chart = getInstanceByDom(chartRef.current);
    if (!chart) return;
    chart.dispatchAction({ type: "dataZoom", start: 0, end: 100 });
    setIsZoomed(false);
  };

  const telemetrySettingsRef = useAsRef(telemetrySettings);

  useEffect(() => {
    if (!chartRef.current) return;
    const chart = getInstanceByDom(chartRef.current);
    if (!chart) return;

    const axisFormatter = buildTooltipFormatter({
      corners: circuitData?.corners ?? [],
      telemetryData,
      commonStart,
      commonEnd,
      deltaBySeries,
      labelBySeries,
      refLapName,
      refTimes,
      hoveredSeriesRef,
    });

    chart.setOption<EChartsOption>(
      {
        ...CHART_STRUCTURE,

        tooltip: {
          trigger: "axis" as const,
          backgroundColor: "oklch(17.76% 0.000 0)",
          borderColor: "oklch(28.50% 0.000 0)",
          axisPointer: { type: "line" as const },
          formatter: axisFormatter,
        },

        series: [
          ...series.map((s) => {
            const ch = resolveChannelSettings(
              telemetrySettingsRef.current,
              s.channelIdx,
            );
            return {
              showSymbol: ch.showSymbol,
              symbol: ch.symbol,
              symbolSize: ch.symbolSize,
              smooth: ch.smooth,
              lineStyle: { width: ch.lineWidth },
              ...s,
              color: customColorsRef.current[s.name] ?? s.color,
            };
          }),
          ...markLineSeries,
        ],
        legend: {
          show: false,
          selected: Object.fromEntries(
            series.map((s) => [s.name, !hiddenSeries.has(s.name)]),
          ),
        },
      },
      { replaceMerge: ["series"] },
    );

  }, [
    series,
    chartRef,
    circuitData,
    telemetryData,
    commonStart,
    commonEnd,
    deltaBySeries,
    labelBySeries,
    refLapName,
    refTimes,
    telemetrySettingsRef,
    customColorsRef,
  ]);

  // Settings-only update — merge mode so zoom and chart structure are preserved
  useEffect(() => {
    if (!chartRef.current) return;
    const chart = getInstanceByDom(chartRef.current);
    if (!chart) return;
    const currentSeries = seriesRef.current;
    if (!currentSeries.length) return;
    chart.setOption({
      series: [
        ...currentSeries.map((s) => {
          const ch = resolveChannelSettings(telemetrySettings, s.channelIdx);
          return {
            id: s.id,
            smooth: ch.smooth,
            showSymbol: ch.showSymbol,
            symbol: ch.symbol,
            symbolSize: ch.symbolSize,
            lineStyle: { width: ch.lineWidth },
          };
        }),
        ...CHANNELS.map((_, i) => ({ id: `__markline_${i}` })),
      ],
    });
  }, [telemetrySettings, chartRef, seriesRef]);

  // Color-only update — merge mode so zoom and chart structure are preserved
  useEffect(() => {
    if (!chartRef.current) return;
    const chart = getInstanceByDom(chartRef.current);
    if (!chart) return;
    const current = seriesRef.current;
    if (!current.length) return;
    chart.setOption({
      series: [
        ...current.map((s) =>
          customColors[s.name]
            ? { id: s.id, color: customColors[s.name] }
            : { id: s.id },
        ),
        ...CHANNELS.map((_, i) => ({ id: `__markline_${i}` })),
      ],
    });
  }, [customColors, chartRef, seriesRef]);

  // Laps still fetching that aren't yet drawn — surfaced in the legend with a
  // spinner so the user sees a pending lap appear immediately on selection.
  const loadedKeys = useMemo(
    () => new Set(legendItems.map((i) => i.key)),
    [legendItems],
  );
  const pendingItems = useMemo(
    () =>
      pending
        .map((p) => ({ ...p, key: seriesKey(p) }))
        .filter((p) => !loadedKeys.has(p.key)),
    [pending, loadedKeys],
  );

  const sessionContexts = useMemo(() => {
    const seen = new Map<
      string,
      { year: string; event: string; session: string }
    >();
    for (const item of [...legendItems, ...pendingItems]) {
      const key = `${item.year}:${item.event}:${item.session}`;
      if (!seen.has(key))
        seen.set(key, {
          year: item.year,
          event: item.event,
          session: item.session,
        });
    }
    return Array.from(seen.values());
  }, [legendItems, pendingItems]);

  const sessionLabels = useQueries({
    queries: sessionContexts.map((c) => ({
      queryKey: ["session", c.year, c.event, c.session],
      queryFn: () => fetchSession(c.year, c.event, c.session),
    })),
    combine: (results) =>
      new Map(
        sessionContexts.map((c, i) => {
          const data = results[i]?.data;
          return [
            `${c.year}:${c.event}:${c.session}`,
            data
              ? `${c.year} · ${data.event_name} · ${data.name}`
              : `${c.year} · Event ${c.event} · ${c.session}`,
          ] as const;
        }),
      ),
  });

  const sessionLabelFor = (item: {
    year: string;
    event: string;
    session: string;
  }) =>
    sessionLabels.get(`${item.year}:${item.event}:${item.session}`) ??
    `${item.year} · Event ${item.event} · ${item.session}`;

  const fastestSelectedTime = useMemo(() => {
    const times = legendItems
      .map((i) => i.lapTime)
      .filter((t): t is number => t !== null);
    return times.length ? Math.min(...times) : null;
  }, [legendItems]);

  const totalHeight = CHANNELS.length * (GRID_HEIGHT + GRID_GAP) + GRID_GAP;

  const chartAriaLabel =
    legendItems.length === 0
      ? "Telemetry chart, no laps selected"
      : `Telemetry comparison chart for ${legendItems
          .map((i) => `${i.driver} lap ${i.lap}`)
          .join(", ")}. Channels ${CHANNELS.join(
          ", ",
        )} plotted against lap distance.`;

  const replayOpen = replayParam === '1' && selectedLaps.length > 0;
  const replayInitialLoop = useMemo(() => {
    if (!replayLoopParam) return null;
    const parts = replayLoopParam.split(',');
    const rawA = Number(parts[0]);
    const rawB = Number(parts[1]);
    if (!Number.isFinite(rawA) || !Number.isFinite(rawB)) return null;
    const a = Math.max(0, Math.min(rawA, rawB));
    const b = Math.max(rawA, rawB);
    return b - a >= 0.25 ? { a, b } : null;
  }, [replayLoopParam]);

  const replayInitialTime = replayTimeParam
    ? Math.max(0, parseFloat(replayTimeParam) || 0)
    : (replayInitialLoop?.a ?? 0);

  const handleReplayOpenChange = (next: boolean) => {
    if (next) {
      setReplayParam('1');
    } else {
      setReplayParam(null);
      setReplayTimeParam(null);
      setReplayLoopParam(null);
    }
  };

  const buildShareUrl = (
    t: number | null,
    loop: { a: number; b: number } | null,
  ) => {
    if (typeof window === 'undefined') return '';
    const url = new URL(window.location.href);
    url.searchParams.set('replay', '1');
    if (t === null) {
      url.searchParams.delete('rt');
    } else {
      url.searchParams.set('rt', t.toFixed(3));
    }
    if (loop === null) {
      url.searchParams.delete('rl');
    } else {
      url.searchParams.set('rl', `${loop.a.toFixed(3)},${loop.b.toFixed(3)}`);
    }
    return url.toString();
  };

  return (
    <div className="w-full flex flex-col border border-surface-border bg-surface-card">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 border-b border-surface-border">
        <div className="flex min-w-0 items-center gap-2 font-mono text-[10px] tracking-[0.2em] uppercase text-text-muted">
          <span
            className={
              legendItems.length > 0
                ? "size-1.5 rounded-full bg-accent-green animate-pulse shrink-0"
                : "size-1.5 rounded-full bg-surface-border shrink-0"
            }
          />
          Telemetry trace · Distance (m)
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={selectedLaps.length === 0}
                  aria-label="Show lap replay"
                  className="font-mono text-[10px] tracking-[0.15em] uppercase cursor-pointer text-accent-green rounded-none hover:bg-surface-card-hover hover:text-accent-green disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() => {
                    setTab('telemetry');
                    setReplayTimeParam(null);
                    setReplayParam('1');
                  }}
                >
                  <Play className="size-3.5 self-center" aria-hidden="true" />
                  <span className="h-3.5">Replay</span>
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {selectedLaps.length === 0
                ? "Select at least one lap to replay"
                : `Replay ${selectedLaps.length} lap${selectedLaps.length === 1 ? "" : "s"} on track`}
            </TooltipContent>
          </Tooltip>
          {laps && (
            <Button
              size="sm"
              variant="ghost"
              className="font-mono text-[10px] tracking-[0.15em] uppercase cursor-pointer text-accent-green rounded-none hover:bg-surface-card-hover hover:text-accent-green"
              onClick={() => setLaps(null)}
            >
              <X className="size-3.5 self-center" aria-hidden="true" />
              <span className="h-3.5">Clear Laps</span>
            </Button>
          )}
          <TelemetrySettingsPanel />
        </div>
      </div>
      {(legendItems.length > 0 || pendingItems.length > 0) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 px-4 py-3 border-b border-surface-border">
          {legendItems.map((item) => {
            const hidden = hiddenSeries.has(item.key);
            const effectiveColor = customColors[item.key] ?? item.color;
            const delta =
              item.lapTime !== null && fastestSelectedTime !== null
                ? item.lapTime - fastestSelectedTime
                : null;
            return (
              <div
                key={item.key}
                className="group flex w-full min-w-0 flex-col gap-1.5 border px-2.5 py-2 transition-opacity sm:w-auto sm:max-w-xs"
                style={{
                  opacity: hidden ? 0.4 : 1,
                  borderColor: effectiveColor,
                  background: `color-mix(in oklch, ${effectiveColor} 8%, transparent)`,
                }}
              >
                <div className="flex items-start justify-between gap-4">
                  <span className="min-w-0 font-mono text-[9px] leading-snug tracking-[0.15em] uppercase text-text-muted">
                    {sessionLabelFor(item)}
                  </span>
                  <span className="-mr-1 flex shrink-0 items-center gap-0.5 pointer-coarse:-my-2 pointer-coarse:-mr-2 pointer-coarse:gap-2">
                    <button
                      type="button"
                      aria-pressed={hidden}
                      aria-label={`Hide ${item.driver} Lap ${item.lap} in chart`}
                      title={hidden ? "Show in chart" : "Hide from chart"}
                      onClick={() => toggleSeries(item.key)}
                      className="flex size-5 items-center justify-center text-text-muted cursor-pointer outline-none transition-colors hover:bg-surface-card-hover hover:text-text-primary focus-visible:ring-2 focus-visible:ring-ring/50 pointer-coarse:size-11"
                    >
                      {hidden ? (
                        <EyeOff
                          className="size-3 pointer-coarse:size-4"
                          aria-hidden="true"
                        />
                      ) : (
                        <Eye
                          className="size-3 pointer-coarse:size-4"
                          aria-hidden="true"
                        />
                      )}
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${item.driver} Lap ${item.lap}`}
                      title={`Remove ${item.driver} Lap ${item.lap}`}
                      onClick={() => removeLap(item)}
                      className="flex size-5 items-center justify-center text-text-muted cursor-pointer outline-none transition-colors hover:bg-accent-red/15 hover:text-accent-red focus-visible:ring-2 focus-visible:ring-accent-red/50 pointer-coarse:size-11"
                    >
                      <X
                        className="size-3 pointer-coarse:size-4"
                        aria-hidden="true"
                      />
                    </button>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <ColorSwatch
                    color={effectiveColor}
                    label={`Change color for ${item.driver} Lap ${item.lap}`}
                    onCommit={(c) =>
                      setCustomColors((prev) => ({
                        ...prev,
                        [item.key]: c,
                      }))
                    }
                  />
                  <span
                    className={`font-mono text-[11px] font-semibold tracking-wider uppercase text-text-secondary ${
                      hidden ? "line-through" : ""
                    }`}
                  >
                    {item.driver} · LAP {item.lap}
                  </span>
                  {item.compound && (
                    <span className="ml-auto flex items-center gap-1.5 pl-3">
                      <TyreBadge
                        compound={item.compound.toUpperCase() as Compound}
                        size={20}
                        year={item.year}
                      />
                      {item.tyreLife !== null && (
                        <span className="font-mono text-[10px] tracking-widest uppercase text-text-muted whitespace-nowrap">
                          {item.tyreLife} lap{item.tyreLife === 1 ? "" : "s"}{" "}
                          old
                        </span>
                      )}
                    </span>
                  )}
                </div>
                <div className="flex items-baseline gap-2 font-mono tabular-nums">
                  <span className="text-sm font-bold text-text-primary">
                    {formatLapTime(item.lapTime)}
                  </span>
                  {delta !== null && delta > 0 && (
                    <span className="text-[10px] text-accent-red">
                      +{delta.toFixed(3)}s
                    </span>
                  )}
                  {delta === 0 && legendItems.length > 1 && (
                    <span className="text-[9px] tracking-[0.15em] uppercase text-accent-green">
                      Fastest
                    </span>
                  )}
                </div>
              </div>
            );
          })}
          {pendingItems.map((item) => {
            const color =
              customColors[item.key] ?? lapColor(colorSlots[item.key] ?? 0);
            return (
              <output
                key={item.key}
                aria-live="polite"
                className="flex w-full min-w-0 flex-col gap-1.5 border px-2.5 py-2 sm:w-auto sm:max-w-xs"
                style={{
                  opacity: 0.6,
                  borderColor: color,
                  background: `color-mix(in oklch, ${color} 8%, transparent)`,
                }}
              >
                <span className="min-w-0 font-mono text-[9px] leading-snug tracking-[0.15em] uppercase text-text-muted">
                  {sessionLabelFor(item)}
                </span>
                <span className="flex items-center gap-2">
                  <span
                    className="size-3 rounded-full"
                    style={{ backgroundColor: color }}
                    aria-hidden="true"
                  />
                  <span className="font-mono text-[11px] font-semibold tracking-wider uppercase text-text-muted">
                    {item.driver} · L{item.lap}
                  </span>
                  <Loader2
                    className="animate-spin text-text-muted"
                    size={12}
                    aria-label={`Loading ${item.driver} Lap ${item.lap}`}
                  />
                </span>
              </output>
            );
          })}
        </div>
      )}
      <div className="relative w-full" style={{ height: totalHeight }}>
        <div
          ref={chartRef}
          role="img"
          aria-label={chartAriaLabel}
          className="w-full h-full"
        />
        {isPending && telemetryData.length === 0 && (
          <output
            aria-live="polite"
            className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-text-muted"
          >
            <Loader2 className="animate-spin" size={16} aria-hidden="true" />
            Loading telemetry…
          </output>
        )}
        {!isPending &&
          telemetryData.length === 0 &&
          pendingItems.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-4 bg-surface-card">
              <span className="font-mono text-[10px] tracking-[0.25em] uppercase text-text-secondary">
                No laps selected
              </span>
              <p className="text-sm text-text-secondary max-w-xs">
                Pick laps from the timing sheet, or compare fastest laps from
                the session panel.
              </p>
              <button
                type="button"
                onClick={() => setTab('session')}
                className="mt-1 cursor-pointer font-mono text-[10px] font-semibold tracking-[0.2em] uppercase px-5 py-2.5 bg-accent-green text-black hover:bg-accent-green-hover transition-colors [clip-path:polygon(0_0,100%_0,100%_calc(100%-10px),calc(100%-10px)_100%,0_100%)]"
              >
                ← Pick laps in session
              </button>
            </div>
          )}
      </div>
      <div className="flex items-center justify-end px-4 min-h-10 border-t border-surface-border">
        {isZoomed ? (
          <Button
            size="sm"
            variant="ghost"
            className="font-mono text-[10px] tracking-[0.15em] uppercase cursor-pointer text-accent-green rounded-none hover:bg-surface-card-hover hover:text-accent-green"
            onClick={resetZoom}
          >
            <ZoomOut className="size-3!" aria-hidden="true" /> Reset Zoom
          </Button>
        ) : (
          <span className="font-mono text-[9px] tracking-[0.2em] uppercase text-text-muted">
            <span className="pointer-coarse:hidden">
            Scroll to zoom · Hover for sector + corner data
            </span>
            <span className="hidden pointer-coarse:inline">
              Pinch to zoom · Tap for sector + corner data
            </span>
          </span>
        )}
      </div>
      <ReplayModal
        open={replayOpen}
        onOpenChange={handleReplayOpenChange}
        telemetryData={telemetryData}
        circuit={circuitData}
        isPending={isPending}
        colorSlots={colorSlots}
        customColors={customColors}
        initialTime={replayInitialTime}
        initialLoop={replayInitialLoop}
        buildShareUrl={buildShareUrl}
      />
    </div>
  );
}
