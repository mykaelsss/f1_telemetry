import type { ReplayLap } from "./prepare";

export type LapSample = {
  x: number;
  y: number;
  heading: number;
  speed: number;
  throttle: number;
  brake: boolean;
  gear: number;
  rpm: number;
  finished: boolean;
};

function findSegment(time: Float64Array, t: number): [number, number, number] {
  const n = time.length;
  if (t <= time[0]!) return [0, 0, 0];
  if (t >= time[n - 1]!) return [n - 1, n - 1, 0];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (time[mid]! <= t) lo = mid;
    else hi = mid;
  }
  const span = time[hi]! - time[lo]!;
  const t01 = span > 0 ? (t - time[lo]!) / span : 0;
  return [lo, hi, t01];
}

export function sampleLapAt(lap: ReplayLap, t: number): LapSample {
  const finished = t >= lap.finishTime;
  const clamped = finished ? lap.finishTime : t;

  const last = lap.posTime.length - 1;
  const posStart = lap.posTime[0]!;
  const posEnd = lap.posTime[last]!;

  let x: number;
  let y: number;
  let heading: number;

  if (clamped < posStart) {
    const u = posStart > 0 ? clamped / posStart : 1;
    x = lap.lineX + (lap.x[0]! - lap.lineX) * u;
    y = lap.lineY + (lap.y[0]! - lap.lineY) * u;
    heading = Math.atan2(lap.y[1]! - lap.y[0]!, lap.x[1]! - lap.x[0]!);
  } else if (clamped > posEnd && lap.finishTime > posEnd) {
    const u = Math.min(1, (clamped - posEnd) / (lap.finishTime - posEnd));
    const xEnd = lap.x[last]!;
    const yEnd = lap.y[last]!;
    x = xEnd + (lap.lineX - xEnd) * u;
    y = yEnd + (lap.lineY - yEnd) * u;
    heading = Math.atan2(yEnd - lap.y[last - 1]!, xEnd - lap.x[last - 1]!);
  } else {
    const [pLo, pHi, pU] = findSegment(lap.posTime, clamped);
    const x0 = lap.x[pLo]!;
    const y0 = lap.y[pLo]!;
    const x1 = lap.x[pHi]!;
    const y1 = lap.y[pHi]!;
    x = x0 + (x1 - x0) * pU;
    y = y0 + (y1 - y0) * pU;

    let headingLo = Math.max(0, pLo - 1);
    let headingHi = Math.min(last, pHi + 1);
    let dx = lap.x[headingHi]! - lap.x[headingLo]!;
    let dy = lap.y[headingHi]! - lap.y[headingLo]!;
    while (dx === 0 && dy === 0 && (headingLo > 0 || headingHi < last)) {
      if (headingLo > 0) headingLo--;
      if (headingHi < last) headingHi++;
      dx = lap.x[headingHi]! - lap.x[headingLo]!;
      dy = lap.y[headingHi]! - lap.y[headingLo]!;
    }
    heading = Math.atan2(dy, dx);
  }

  const [cLo, cHi, cU] = findSegment(lap.time, clamped);
  const lerp = (a: number, b: number) => a + (b - a) * cU;

  return {
    x,
    y,
    heading,
    speed: lerp(lap.speed[cLo]!, lap.speed[cHi]!),
    throttle: lerp(lap.throttle[cLo]!, lap.throttle[cHi]!),
    brake: (cU < 0.5 ? lap.brake[cLo]! : lap.brake[cHi]!) === 1,
    gear: cU < 0.5 ? lap.gear[cLo]! : lap.gear[cHi]!,
    rpm: lerp(lap.rpm[cLo]!, lap.rpm[cHi]!),
    finished,
  };
}

function lapFractionAt(lap: ReplayLap, t: number): number {
  if (lap.totalDistance <= 0) return 0;
  const last = lap.time.length - 1;
  const t0 = lap.time[0]!;
  let d: number;
  if (t <= t0) {
    d = t0 > 0 ? (lap.distance[0]! * t) / t0 : lap.distance[0]!;
  } else if (t >= lap.time[last]!) {
    d = lap.distance[last]! + lap.tailRate * (t - lap.time[last]!);
  } else {
    const [lo, hi, u] = findSegment(lap.time, t);
    d = lap.distance[lo]! + (lap.distance[hi]! - lap.distance[lo]!) * u;
  }
  return d / lap.totalDistance;
}

function timeAtLapFraction(lap: ReplayLap, fraction: number): number {
  const d = fraction * lap.totalDistance;
  const d0 = lap.distance[0]!;
  if (d <= d0) return d0 > 0 ? (lap.time[0]! * d) / d0 : lap.time[0]!;
  const last = lap.distance.length - 1;
  if (d >= lap.distance[last]!) {
    return lap.tailRate > 0
      ? lap.time[last]! + (d - lap.distance[last]!) / lap.tailRate
      : lap.finishTime;
  }
  const [lo, hi, u] = findSegment(lap.distance, d);
  return lap.time[lo]! + (lap.time[hi]! - lap.time[lo]!) * u;
}

export function deltaToReference(
  lap: ReplayLap,
  reference: ReplayLap,
  t: number,
): number {
  if (lap.key === reference.key) return 0;
  if (lap.totalDistance <= 0 || reference.totalDistance <= 0) return 0;
  const clamped = Math.min(t, lap.finishTime);
  return clamped - timeAtLapFraction(reference, lapFractionAt(lap, clamped));
}

export function sampleTrailPositions(
  lap: ReplayLap,
  tEnd: number,
  trailSeconds: number,
  maxPoints: number,
): { x: number; y: number }[] {
  const tStart = Math.max(0, tEnd - trailSeconds);
  const points: { x: number; y: number }[] = [];
  const step = trailSeconds / maxPoints;
  for (let i = 0; i <= maxPoints; i++) {
    const t = Math.min(tEnd, tStart + step * i);
    const s = sampleLapAt(lap, t);
    points.push({ x: s.x, y: s.y });
    if (t >= tEnd) break;
  }
  return points;
}
