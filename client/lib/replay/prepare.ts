import type { LapTelemetryWithSession } from "../types";
import { seriesKey } from "../seriesKey";

export type ReplayLap = {
  key: string;
  year: string;
  event: string;
  session: string;
  driver: string;
  lap: number;
  compound: string | null;
  tyreLife: number | null;
  sectors: [number | null, number | null, number | null];
  finishTime: number;
  duration: number;
  lineX: number;
  lineY: number;
  time: Float64Array;
  distance: Float64Array;
  tailRate: number;
  totalDistance: number;
  posTime: Float64Array;
  x: Float64Array;
  y: Float64Array;
  speed: Float64Array;
  throttle: Float64Array;
  brake: Uint8Array;
  gear: Int16Array;
  rpm: Float64Array;
};

export type ReplayData = {
  laps: ReplayLap[];
  referenceKey: string;
  totalDuration: number;
};

function toFloat64(arr: readonly number[]): Float64Array {
  const out = new Float64Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = arr[i]!;
  return out;
}

function toInt16(arr: readonly number[]): Int16Array {
  const out = new Int16Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = arr[i]!;
  return out;
}

function toUint8Bool(arr: readonly boolean[]): Uint8Array {
  const out = new Uint8Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = arr[i] ? 1 : 0;
  return out;
}

export function prepareReplay(
  telemetry: LapTelemetryWithSession[],
): ReplayData | null {
  if (telemetry.length === 0) return null;

  const laps: ReplayLap[] = [];

  for (const t of telemetry) {
    const rawTime = t.channels.time;
    const rawPosTime = t.channels.pos_time;
    if (rawTime.length < 2 || !rawPosTime || rawPosTime.length < 2) continue;
    const time = toFloat64(rawTime);
    const posTime = toFloat64(rawPosTime);

    const x = toFloat64(t.channels.x);
    const y = toFloat64(t.channels.y);

    const sampleFinish = Math.max(
      time[time.length - 1]!,
      posTime[posTime.length - 1]!,
    );
    const finishTime =
      typeof t.lap_time === "number" && Number.isFinite(t.lap_time)
        ? t.lap_time
        : sampleFinish;

    const distance = toFloat64(t.channels.distance);
    const lastDist = distance.length - 1;
    const rateSpan = lastDist > 0 ? time[lastDist]! - time[lastDist - 1]! : 0;
    const tailRate =
      rateSpan > 0
        ? (distance[lastDist]! - distance[lastDist - 1]!) / rateSpan
        : 0;
    const totalDistance =
      lastDist >= 0
        ? distance[lastDist]! +
          tailRate * Math.max(0, finishTime - time[lastDist]!)
        : 0;

    const lastPos = posTime.length - 1;
    const gapBefore = Math.max(0, posTime[0]!);
    const gapAfter = Math.max(0, finishTime - posTime[lastPos]!);
    const closure = gapBefore + gapAfter;
    const u = closure > 0 ? gapAfter / closure : 0;
    const lineX = x[lastPos]! + (x[0]! - x[lastPos]!) * u;
    const lineY = y[lastPos]! + (y[0]! - y[lastPos]!) * u;

    laps.push({
      key: seriesKey({
        year: t.year,
        event: t.event,
        session: t.session,
        driver: t.driver,
        lap: t.lap_number,
      }),
      year: t.year,
      event: t.event,
      session: t.session,
      driver: t.driver,
      lap: t.lap_number,
      compound: t.compound ?? null,
      tyreLife: t.tyre_life ?? null,
      sectors: [t.sector1 ?? null, t.sector2 ?? null, t.sector3 ?? null],
      finishTime,
      duration: sampleFinish,
      lineX,
      lineY,
      time,
      distance,
      tailRate,
      totalDistance,
      posTime,
      x,
      y,
      speed: toFloat64(t.channels.speed),
      throttle: toFloat64(t.channels.throttle),
      brake: toUint8Bool(t.channels.brake),
      gear: toInt16(t.channels.gear),
      rpm: toFloat64(t.channels.rpm),
    });
  }

  if (laps.length === 0) return null;

  const referenceLap = laps.reduce((best, l) =>
    l.finishTime < best.finishTime ? l : best,
  );

  for (const l of laps) {
    l.lineX = referenceLap.lineX;
    l.lineY = referenceLap.lineY;
  }

  const totalDuration = laps.reduce(
    (m, l) => Math.max(m, l.finishTime, l.duration),
    0,
  );

  return {
    laps,
    referenceKey: referenceLap.key,
    totalDuration,
  };
}
