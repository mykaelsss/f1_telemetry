"use client";

import { getInstanceByDom, type EChartsOption, type LineSeriesOption } from "echarts";
import type { TopLevelFormatterParams } from "echarts/types/dist/shared";
import type { ChartSettings } from "@/lib/types";
import { ZoomOut } from "lucide-react";
import { useState, useEffect, useCallback } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import ChartSettingsPanel from "./ChartSettingsPanel";
import { useChartSettings } from "@/lib/hooks/useChartSettings";
import { useEcharts } from "@/lib/hooks/useEcharts";
import { useToggleSeries } from "@/lib/hooks/useToggleSeries";

type LegendItem = {
  key: string;
  label?: string;
};

interface ChartProps<T extends LegendItem> {
  series: LineSeriesOption[];
  storageKey?: string;
  title?: string;
  emptyHint?: string;
  tooltipFormatter?: (params: TopLevelFormatterParams) => string;
  yAxisFormatter?: (val: number) => string;
  legendItems?: T[];
  renderLegendItem: (item: T, state: { hidden: boolean }) => React.ReactNode;
  isLoading?: boolean;
  onSeriesClick?: (params: { seriesName: string; value: [number, number] }) => void;
}

export default function Chart<T extends LegendItem>({
  series,
  storageKey = "lap_chart_settings",
  title,
  emptyHint,
  tooltipFormatter,
  yAxisFormatter,
  legendItems,
  renderLegendItem,
  isLoading = false,
  onSeriesClick,
}: ChartProps<T>) {
  const chartRef = useEcharts();

  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());
  const [isZoomed, setIsZoomed] = useState(false);
  const {settings, setSettings} = useChartSettings(storageKey);

  const updateSettings = useCallback(
    (next: ChartSettings | ((prev: ChartSettings) => ChartSettings)) => {
      const value = typeof next === "function" ? next(settings) : next;
      setSettings(value);
    },
    [settings, setSettings],
  );

  useEffect(() => {
    if (!chartRef.current) return;
    const chart = getInstanceByDom(chartRef.current);
    if (!chart) return;

    const seriesDefaults = {
      type: "line" as const,
      symbol: settings.symbol,
      showSymbol: settings.showSymbol,
      smooth: settings.smooth,
      symbolSize: settings.symbolSize,
      itemStyle: {
        borderColor: "oklch(74.90% 0.000 0)",
        borderWidth: 1,
      },
      emphasis: {
        scale: 1.5,
        itemStyle: { color: "inherit" },
        areaStyle: { color: "inherit" },
      },
    };

    const toolTipDefaults = {
      trigger: "axis" as const,
      backgroundColor: "oklch(17.76% 0.000 0)",
      borderColor: "oklch(28.50% 0.000 0)",
      enterable: true,
      confine: true,
      axisPointer: {
        type: "line" as const,
        z: 0,
        lineStyle: { color: "#555", opacity: 0.8 },
      },
    };

    chart.setOption<EChartsOption>(
      {
        grid: {
          backgroundColor: "oklch(14.48% 0.000 0)",
          borderColor: "oklch(28.50% 0.000 0)",
          borderWidth: 2,
          top: 2,
          right: 2,
          left: 2,
          bottom: 2,
          show: true,
          outerBounds: {
            right: 15,
            left: 15,
            bottom: 15,
          },
        },
        xAxis: {
          type: "value",
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: {
            show: true,
            lineStyle: { color: "#333", type: "dashed" },
            showMinLine: false,
            showMaxLine: false,
          },
          axisLabel: {
            alignMinLabel: "left",
            alignMaxLabel: "right",
          },
          minInterval: 1,
          min: (value: { min: number; max: number }) => Math.floor(value.min),
          max: (value: { min: number; max: number }) => Math.ceil(value.max),
        },
        yAxis: {
          type: "value",
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: {
            show: true,
            lineStyle: { color: "#333", type: "dashed" },
            showMinLine: false,
            showMaxLine: false,
          },
          axisLabel: {
            margin: 20,
            verticalAlignMinLabel: "bottom",
            verticalAlignMaxLabel: "top",
            formatter: yAxisFormatter,
          },
          min: (value: { min: number; max: number }) => Math.floor(value.min ?? 0),
          max: (value: { min: number; max: number }) => Math.ceil(value.max),
        },
        tooltip: {
          formatter: tooltipFormatter,
          ...toolTipDefaults,
        },
        dataZoom: {
          type: "inside",
          minValueSpan: 5,
        },
        legend: { show: false },
        series: series.map((s) => ({
          ...seriesDefaults,
          ...s,
        })),
      },
      { replaceMerge: ["series"] },
    );
  }, [
    series,
    tooltipFormatter,
    yAxisFormatter,
    settings.smooth,
    settings.showSymbol,
    settings.symbol,
    settings.symbolSize,
    settings.lineWidth,
    settings.firstDriverLineStyle,
    settings.secondDriverLineStyle,
    chartRef
  ]);

  useEffect(() => {
    if (!chartRef.current || !onSeriesClick) return;
    const chart = getInstanceByDom(chartRef.current);
    if (!chart) return;
    chart.on("click", (params) => {
      if (params.componentType === "series") {
        onSeriesClick({ seriesName: params.seriesName ?? "", value: params.value as [number, number] });
      }
    });
    return () => { chart.off("click"); };
  }, [onSeriesClick, chartRef]);

  useEffect(() => {
    if (!chartRef.current) return;
    const chart = getInstanceByDom(chartRef.current);
    if (!chart) return;
    chart.on("datazoom", () => {
      const option = chart.getOption() as {
        dataZoom?: { start?: number; end?: number }[];
      };
      const zoom = option.dataZoom?.[0];
      setIsZoomed(zoom?.start !== 0 || zoom?.end !== 100);
    });
    return () => {
      chart.off("datazoom");
    };
  }, [chartRef]);

  const resetZoom = () => {
    const chart = getInstanceByDom(chartRef.current!);
    if (!chart) return;
    chart.dispatchAction({ type: "dataZoom", start: 0, end: 100 });
    setIsZoomed(false);
  };

  const toggleSeries = useToggleSeries(hiddenSeries, setHiddenSeries, chartRef)

  return (
    <div className="w-full flex flex-col border border-surface-border bg-surface-card">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5 border-b border-surface-border">
        <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.2em] uppercase text-text-muted">
          <span
            className={
              series.length > 0
                ? "size-1.5 rounded-full bg-accent-green animate-pulse shrink-0"
                : "size-1.5 rounded-full bg-surface-border shrink-0"
            }
          />
          {title ?? "Chart"}
        </div>
        <div className="flex items-center gap-4">
          <div className="flex flex-wrap gap-x-4 gap-y-2 justify-end">
            {legendItems?.map((item) => {
              const hidden = hiddenSeries.has(item.key);
              return (
                <button
                  type="button"
                  key={item.key}
                  onClick={() => toggleSeries(item.key)}
                  className="flex items-center gap-2 cursor-pointer"
                  style={{ opacity: hidden ? 0.3 : 1 }}
                >
                  {renderLegendItem(item, { hidden })}
                </button>
              );
            })}
          </div>
          <ChartSettingsPanel settings={settings} setSettings={updateSettings} />
        </div>
      </div>
      <div className="relative w-full h-96 p-3">
        <div ref={chartRef} className="w-full h-full" />
        {isLoading && series.length === 0 && (
          <Skeleton className="absolute inset-3 rounded-none bg-surface-base" />
        )}
        {!isLoading && series.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-4 pointer-events-none">
            <span className="font-mono text-[10px] tracking-[0.25em] uppercase text-text-secondary">
              No data plotted
            </span>
            {emptyHint && (
              <p className="text-sm text-text-secondary max-w-xs">{emptyHint}</p>
            )}
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
            <ZoomOut className="size-3!" /> Reset Zoom
          </Button>
        ) : (
          <span className="font-mono text-[9px] tracking-[0.2em] uppercase text-text-muted">
            <span className="pointer-coarse:hidden">
              {onSeriesClick
                ? "Scroll to zoom · Click a point to add its lap"
                : "Scroll to zoom"}
            </span>
            <span className="hidden pointer-coarse:inline">
              {onSeriesClick
                ? "Pinch to zoom · Tap a point to add its lap"
                : "Pinch to zoom"}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
