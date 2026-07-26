import type { CircuitInfo } from "../types";
import type { ReplayLap } from "./prepare";

export type CornerMark = {
  id: string;
  label: string;
  x: number;
  y: number;
  angle: number;
  time: number;
};

export function cornerMarks(
  lap: ReplayLap | null | undefined,
  circuit: CircuitInfo | null | undefined,
): CornerMark[] | null {
  if (!lap || !circuit || circuit.corners.length === 0) return null;
  const { x: lapX, y: lapY, posTime } = lap;
  if (lapX.length === 0) return null;

  return circuit.corners.map((c, i) => {
    let nearest = 0;
    let best = Infinity;
    for (let j = 0; j < lapX.length; j++) {
      const dx = lapX[j]! - c.x;
      const dy = lapY[j]! - c.y;
      const d = dx * dx + dy * dy;
      if (d < best) {
        best = d;
        nearest = j;
      }
    }
    const letter = c.letter ?? "";
    return {
      id: `${c.number}${letter}-${i}`,
      label: `T${c.number}${letter.toLowerCase()}`,
      x: c.x,
      y: c.y,
      angle: c.angle,
      time: Math.max(0, posTime[nearest]!),
    };
  });
}
