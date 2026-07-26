import { useQueries, UseQueryResult } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { fetchSessionLaps } from "../api";
import { lapTimeToMs } from "../format";
import { DriverLaps } from "../types";
import type { ReplayLap } from "../replay/prepare";
import { useSessionLapsStaleTime } from "./useEventSchedule";

export type SectorRank = "best" | "personal" | "normal";

export type SectorBests = {
  rankFor: (lap: ReplayLap, sector: number, value: number) => SectorRank | null;
  segmentFor: (lap: ReplayLap) => string | null;
};

const poolKey = (l: { year: string; event: string; session: string }) =>
  `${l.year}|${l.event}|${l.session}`;

const ANY_SEGMENT = "*";

const MATCH_TOLERANCE_MS = 0.5;

function matches(ms: number, best: number | undefined) {
  return (
    best !== undefined &&
    Number.isFinite(best) &&
    ms <= best + MATCH_TOLERANCE_MS
  );
}

function lowest(
  map: Map<string, number[]>,
  key: string,
  sector: number,
  ms: number,
) {
  let entry = map.get(key);
  if (!entry) {
    entry = [Infinity, Infinity, Infinity];
    map.set(key, entry);
  }
  if (ms < entry[sector]!) entry[sector] = ms;
}

export function useSectorBests(laps: ReplayLap[]): SectorBests {
  const sources = useMemo(() => {
    const seen = new Map<
      string,
      { year: string; event: string; session: string; driver: string }
    >();
    for (const l of laps) {
      const id = `${poolKey(l)}|${l.driver}`;
      if (!seen.has(id)) {
        seen.set(id, {
          year: l.year,
          event: l.event,
          session: l.session,
          driver: l.driver,
        });
      }
    }
    return [...seen.values()];
  }, [laps]);

  const first = sources[0];
  const staleTime = useSessionLapsStaleTime(
    first?.year ?? "",
    first?.event ?? "",
    first?.session ?? "",
  );

  const combine = useCallback(
    (results: UseQueryResult<DriverLaps[], Error>[]) => {
      const overall = new Map<string, number[]>();
      const personal = new Map<string, number[]>();
      const segmentOf = new Map<string, string>();

      results.forEach((r, i) => {
        const src = sources[i];
        if (!src || !r.data) return;
        const pool = poolKey(src);
        for (const d of r.data) {
          for (const segment of d.segments) {
            for (const lap of segment.laps) {
              if (lap.lap_number !== null) {
                segmentOf.set(
                  `${pool}|${d.abbreviation}|${lap.lap_number}`,
                  segment.name,
                );
              }
              const raw = [lap.sector1, lap.sector2, lap.sector3];
              for (let s = 0; s < 3; s++) {
                const parsed = lapTimeToMs(raw[s] ?? null);
                if (parsed === null) continue;
                for (const scope of [segment.name, ANY_SEGMENT]) {
                  lowest(overall, `${pool}|${scope}`, s, parsed);
                  lowest(
                    personal,
                    `${pool}|${scope}|${d.abbreviation}`,
                    s,
                    parsed,
                  );
                }
              }
            }
          }
        }
      });

      const segmentFor = (lap: ReplayLap) =>
        segmentOf.get(`${poolKey(lap)}|${lap.driver}|${lap.lap}`) ?? null;

      const rankFor = (lap: ReplayLap, sector: number, value: number) => {
        const pool = poolKey(lap);
        const scope = segmentFor(lap) ?? ANY_SEGMENT;
        const pooled = overall.get(`${pool}|${scope}`);
        if (!pooled) return null;
        const ms = value * 1000;
        if (matches(ms, pooled[sector])) return "best" as const;
        const own = personal.get(`${pool}|${scope}|${lap.driver}`);
        if (own && matches(ms, own[sector])) return "personal" as const;
        return "normal" as const;
      };

      return { rankFor, segmentFor };
    },
    [sources],
  );

  return useQueries({
    queries: sources.map((s) => ({
      queryKey: ["sessionLaps", s.year, s.event, s.session, s.driver],
      queryFn: () => fetchSessionLaps(s.year, s.event, s.session, s.driver),
      staleTime,
    })),
    combine,
  });
}
