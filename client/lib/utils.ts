import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { ChartSettings, DriverLaps, TelemetryChannelSettings, TelemetrySettings } from "./types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function flattenDriverLaps(driverLaps: DriverLaps[]) {
  return driverLaps.map((d) => ({
    abbreviation: d.abbreviation,
    laps: d.segments.flatMap((s) => s.laps),
  }));
}

export const defaultTelemetryChannelSettings: TelemetryChannelSettings = {
  smooth: true,
  showSymbol: false,
  symbol: "circle",
  symbolSize: 4,
  lineWidth: 1,
};

export const defaultTelemetrySettings: TelemetrySettings = {
  useGlobalSettings: true,
  global: defaultTelemetryChannelSettings,
  channels: {},
};

export const defaultChartSettings: ChartSettings = {
  outlierThreshold: 7,
  smooth: true,
  showSymbol: true,
  symbol: "circle",
  symbolSize: 6,
  lineWidth: 2,
  firstDriverLineStyle: "solid",
  secondDriverLineStyle: "dashed",
  zoomMode: "scroll",
  showPitLaps: false,
  showSafetyCar: false,
};
