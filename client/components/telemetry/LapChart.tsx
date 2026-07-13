"use client";

import { format, type LineSeriesOption } from "echarts";
import type { TopLevelFormatterParams } from "echarts/types/dist/shared";
import type { Compound, QualiSession, Team } from "@/lib/types";
import { useCallback, useMemo } from "react";
import Chart from "../chart/Chart";
import { useChartSettings } from "@/lib/hooks/useChartSettings";
import {
  CHART_STORAGE_KEYS,
  DEFAULT_NUQS_OPTIONS,
  parseAsQualiSession,
} from "@/lib/constants";
import { toggleLap } from "@/lib/selectedLaps";
import { useSessionLaps } from "@/lib/hooks/useSessionLaps";
import { useEventSchedule } from "@/lib/hooks/useEventSchedule";
import { useQueryClient } from "@tanstack/react-query";
import TyreBadge from "./TyreBadge";
import { renderToStaticMarkup } from "react-dom/server";
import { CompoundColor } from "@/lib/compounds";
import { parseAsArrayOf, useQueryState } from "nuqs";
import { useLapAnalysis } from "@/lib/hooks/useLapAnalysis";

interface LapChartProps {
  teams: Team[];
}

function lapTimeToSeconds(lapTime: string | null): number | null {
  if (!lapTime) return null;
  const [min, sec] = lapTime.split(":");
  if (!min || !sec) return null;
  return parseInt(min) * 60 + parseFloat(sec);
}

function secondsToLapTime(seconds: number, precision = 2): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  const ms = Math.round((seconds % 1) * Math.pow(10, precision))
    .toString()
    .padStart(precision, "0");
  return precision > 0 ? `${m}:${s}.${ms}` : `${m}:${s}`;
}

export default function LapChart({ teams }: LapChartProps) {
  const settings = useChartSettings(CHART_STORAGE_KEYS.lapChart).settings;
  const queryClient = useQueryClient();
  const [year] = useQueryState("year", DEFAULT_NUQS_OPTIONS);
  const [event] = useQueryState("event", DEFAULT_NUQS_OPTIONS);
  const [session] = useQueryState("session", DEFAULT_NUQS_OPTIONS);
  const [drivers] = useQueryState("drivers", DEFAULT_NUQS_OPTIONS);
  const [, setLaps] = useQueryState("laps", DEFAULT_NUQS_OPTIONS);
  const [, setTab] = useQueryState("tab", DEFAULT_NUQS_OPTIONS);
  const defaultQualiSessions: QualiSession[] = ["Q", "SQ"].includes(session.toUpperCase())
    ? ["Q1", "Q2", "Q3"]
    : [];
  const [selectedQualiSessions] = useQueryState(
    "qualiSessions",
    parseAsArrayOf(parseAsQualiSession)
      .withDefault(defaultQualiSessions)
      .withOptions(DEFAULT_NUQS_OPTIONS),
  );

  const selectedDrivers = useMemo(
    () => (drivers ? drivers.split(",") : []),
    [drivers],
  );

  const { data: eventSchedule } = useEventSchedule(year, event);
  const sessionStatus = eventSchedule?.sessions.find(
    (s) => s.identifier === session,
  )?.status;
  const staleTime = sessionStatus === "completed" ? Infinity : 60_000;

  const { driverLaps, isLoading: isLoadingLaps } = useSessionLaps(
    year,
    event,
    session,
    selectedDrivers,
    staleTime,
  );

  const { visibleLaps, driverMap, selectedLaps } =
    useLapAnalysis(driverLaps, teams, selectedDrivers);

  const secondDrivers = useMemo(() => {
    const seen = new Set<string>();
    const second = new Set<string>();
    for (const d of visibleLaps) {
      const driver = driverMap.get(d.abbreviation);
      if (!driver) continue;
      if (seen.has(driver.team_name)) {
        second.add(d.abbreviation);
      } else {
        seen.add(driver.team_name);
      }
    }
    return second;
  }, [visibleLaps, driverMap]);

  const chartData = useMemo(() => {
    if (visibleLaps.length === 0) return new Map<string, { value: [number, number]; tyre: string | null }[]>();

    const isQuali = ["Q", "SQ"].includes(session.toUpperCase());
    const filteredDriverLaps = visibleLaps.map((d) => {
      const segments = isQuali
        ? d.segments.filter((s) =>
            selectedQualiSessions.includes(s.name as QualiSession),
          )
        : d.segments;
      return { abbreviation: d.abbreviation, laps: segments.flatMap((s) => s.laps) };
    });

    const allTimes = filteredDriverLaps
      .flatMap((d) => d.laps)
      .map((l) => lapTimeToSeconds(l.lap_time))
      .filter((t): t is number => t !== null);

    const fastest = Math.min(...allTimes);
    const cutoff = fastest * (1 + settings.outlierThreshold / 100);

    const map = new Map<string, { value: [number, number]; tyre: string | null }[]>();
    for (const d of filteredDriverLaps) {
      const points: { value: [number, number]; tyre: string | null }[] = [];
      for (const lap of d.laps) {
        if (!lap.lap_number) continue;
        const secs = lapTimeToSeconds(lap.lap_time);
        if (secs !== null && secs <= cutoff) {
          points.push({
            value: [lap.lap_number, secs],
            tyre: lap.compound ?? null,
          });
        }
      }
      map.set(d.abbreviation, points);
    }
    return map;
  }, [
    visibleLaps,
    selectedQualiSessions,
    session,
    settings.outlierThreshold,
  ]);

  const tyreIconCache = useMemo(() => {
    return Object.fromEntries(
      (Object.keys(CompoundColor) as Compound[]).map((compound) => [
        compound,
        renderToStaticMarkup(
          <TyreBadge compound={compound} size={20} year={year} />,
        ),
      ]),
    ) as Record<Compound, string>;
  }, [year]);

  const tooltipFormatter = useCallback(
    (params: TopLevelFormatterParams) => {
      const items = Array.isArray(params) ? params : [params];
      const rows = items
        .filter((p) => p.value != null)
        .map((p) => {
          const data = p.data as {
            value: [number, number];
            tyre?: string | null;
          };
          const isSecond = secondDrivers.has(p.seriesName ?? "");
          const tyre = data.tyre ?? "";
          const icon = tyreIconCache[tyre as Compound] ?? "";
          const lineStyle = isSecond
            ? settings.secondDriverLineStyle
            : settings.firstDriverLineStyle;
          const marker = `
                    <span 
                    class="inline-block w-5 mr-2 border-t-2" 
                    style="border-color:${format.encodeHTML(p.color as string)};border-style:${format.encodeHTML(lineStyle)};">
                    </span>
                  `;
          return `
                <div class="flex justify-between gap-2">
                  <div class="flex items-center">
                    ${marker}
                    <span
                    class="leading-none">${format.encodeHTML(p.seriesName ?? "")}
                    </span>
                  </div>
                  <span class="font-mono flex gap-2">
                  ${format.encodeHTML(secondsToLapTime((p.value as [number, number])[1], 3))}
                  ${icon}
                  </span>
                </div>`;
        })
        .join("");

      const lap = (items[0]?.value as [number, number])?.[0];

      return `
              <div class="text-xs text-white">
                <span>Lap ${format.encodeHTML(String(lap))}</span>
                ${rows}
              </div>
            `;
    },
    [
      settings.secondDriverLineStyle,
      settings.firstDriverLineStyle,
      secondDrivers,
    ],
  );

  const legendItems = useMemo(
    () =>
      visibleLaps
        .filter((d) => driverMap.has(d.abbreviation))
        .map((d) => ({
          key: d.abbreviation,
          driver: driverMap.get(d.abbreviation)!,
          isSecond: secondDrivers.has(d.abbreviation),
        })),
    [driverMap, visibleLaps, secondDrivers],
  );

  const series = useMemo<LineSeriesOption[]>(() => {
    return visibleLaps.flatMap((d) => {
      const driver = driverMap.get(d.abbreviation);
      if (!driver) return [];
      const isSecondDriver = secondDrivers.has(d.abbreviation);
      return {
        id: d.abbreviation,
        name: d.abbreviation,
        color: `#${driver.team_color}`,
        lineStyle: isSecondDriver
          ? {
              type: settings.secondDriverLineStyle,
              dashOffset: 0,
              width: settings.lineWidth,
            }
          : {
              type: settings.firstDriverLineStyle,
              dashOffset: 0,
              width: settings.lineWidth,
            },
        data: chartData.get(d.abbreviation) ?? [],
      };
    });
  }, [
    chartData,
    visibleLaps,
    driverMap,
    secondDrivers,
    settings.secondDriverLineStyle,
    settings.firstDriverLineStyle,
    settings.lineWidth,
  ]);

  const handleSeriesClick = useCallback(
    ({
      seriesName,
      value,
    }: {
      seriesName: string;
      value: [number, number];
    }) => {
      toggleLap(
        selectedLaps,
        { year, event, session, driver: seriesName, lap: value[0] },
        { queryClient, setLaps, setTab },
      );
    },
    [selectedLaps, year, event, session, queryClient, setLaps, setTab],
  );

  return (
    <Chart
      title="Lap times · Time vs lap"
      emptyHint="Select drivers from the panel to plot their lap times."
      tooltipFormatter={tooltipFormatter}
      yAxisFormatter={(val: number) => secondsToLapTime(val, 0)}
      storageKey={CHART_STORAGE_KEYS.lapChart}
      series={series}
      legendItems={legendItems}
      onSeriesClick={handleSeriesClick}
      renderLegendItem={(item) => (
        <>
          <span
            className="w-6 border-t-2"
            style={{
              borderColor: `#${item.driver.team_color}`,
              borderStyle: item.isSecond
                ? settings.secondDriverLineStyle
                : settings.firstDriverLineStyle,
            }}
          />
          <span className="font-mono text-[10px] tracking-wider text-text-secondary">
            {item.driver.abbreviation}
          </span>
        </>
      )}
      isLoading={isLoadingLaps}
    />
  );
}
