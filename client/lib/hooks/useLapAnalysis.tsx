import { useMemo } from "react";
import { DriverLaps, Team } from "../types";
import { useQueryState } from "nuqs";
import { DEFAULT_NUQS_OPTIONS } from "../constants";
import { flattenDriverLaps } from "../utils";
import { lapTimeToMs } from "../format";
import { parseSelectedLaps } from "../selectedLaps";

export function useLapAnalysis(driverLaps: DriverLaps[], teams: Team[], selectedDrivers: string[]) {
    const [laps] = useQueryState('laps', DEFAULT_NUQS_OPTIONS);

    const selectedLaps = useMemo(() => parseSelectedLaps(laps), [laps]);

  const visibleLaps = useMemo(
    () => driverLaps.filter((d) => selectedDrivers.includes(d.abbreviation)),
    [driverLaps, selectedDrivers],
  );

  const driverMap = useMemo(
    () =>
      new Map(teams.flatMap((t) => t.drivers).map((d) => [d.abbreviation, d])),
    [teams],
  );

  const flatDriverLaps = useMemo(
    () => flattenDriverLaps(visibleLaps),
    [visibleLaps],
  );

const { overallFastest, driverFastest } = useMemo(() => {
  const driverMap = new Map<string, number>();
  let overall: number | null = null;
  for (const d of visibleLaps) {
    for (const s of d.segments) {
      for (const l of s.laps) {
        const ms = lapTimeToMs(l.lap_time);
        if (ms === null) continue;
        if (overall === null || ms < overall) overall = ms;
        const prev = driverMap.get(d.abbreviation);
        if (prev === undefined || ms < prev) driverMap.set(d.abbreviation, ms);
      }
    }
  }
  return { overallFastest: overall, driverFastest: driverMap };
}, [visibleLaps]);

  return {
    selectedDrivers,
    visibleLaps,
    driverMap,
    flatDriverLaps,
    overallFastest,
    driverFastest,
    selectedLaps,
  };
}
