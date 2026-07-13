"use client";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { useCallback, useMemo } from "react";
import { Driver, QualiSession, SelectedLap, Team } from "@/lib/types";
import { Skeleton } from "../ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { cn, flattenDriverLaps } from "@/lib/utils";
import { useSchedule } from "@/lib/hooks/useSchedule";
import { useEventSchedule } from "@/lib/hooks/useEventSchedule";
import { useSessionLaps } from "@/lib/hooks/useSessionLaps";
import { lapTimeToMs } from "@/lib/format";
import {
  ensureSameCircuit,
  isLapSelected,
  parseSelectedLaps,
  serializeSelectedLaps,
} from "@/lib/selectedLaps";
import { useQueryClient } from "@tanstack/react-query";
import { useQueryState, parseAsArrayOf} from "nuqs";
import { DEFAULT_NUQS_OPTIONS, parseAsQualiSession } from "@/lib/constants";

const YEARS = Array.from({ length: new Date().getFullYear() - 2017 }, (_, i) =>
  String(new Date().getFullYear() - i),
);

interface SessionSidebarProps {
  loadingSession: boolean;
  teams: Team[];
}

export default function SessionSidebar({
  loadingSession,
  teams,
}: SessionSidebarProps) {
  const queryClient = useQueryClient();
  const [year, setYear] = useQueryState("year", DEFAULT_NUQS_OPTIONS);
  const [event, setEvent] = useQueryState("event", DEFAULT_NUQS_OPTIONS);
  const [session, setSession] = useQueryState("session", DEFAULT_NUQS_OPTIONS);
  const [drivers, setDrivers] = useQueryState("drivers", DEFAULT_NUQS_OPTIONS);
  const [laps, setLaps] = useQueryState("laps", DEFAULT_NUQS_OPTIONS);
  const [, setTab] = useQueryState("tab", DEFAULT_NUQS_OPTIONS);
  const defaultQualiSessions: QualiSession[] = ["Q", "SQ"].includes(session.toUpperCase()) 
    ? ["Q1", "Q2", "Q3"] 
    : []
  const [selectedQualiSessions, setSelectedQualiSessions] = useQueryState("qualiSessions", parseAsArrayOf(parseAsQualiSession).withDefault(defaultQualiSessions).withOptions(DEFAULT_NUQS_OPTIONS))

  const selectedDrivers = useMemo(
    () => (drivers ? drivers.split(",") : []),
    [drivers],
  );

  const { data: schedule, isLoading: isLoadingSchedule } = useSchedule(year);
  const { data: eventSchedule, isLoading: isLoadingRound } = useEventSchedule(
    year,
    event,
  );
  const sessionStatus = eventSchedule?.sessions.find(
    (s) => s.identifier === session,
  )?.status;
  const staleTime = sessionStatus === "completed" ? Infinity : 60_000;

  const toggleDriver = useCallback(
    (code: string) => {
      const next = new Set(selectedDrivers);
      if (next.has(code)) {
        next.delete(code);
      } else {
        next.add(code);
      }
      setDrivers(Array.from(next).join(","));
    },
    [selectedDrivers, setDrivers],
  );

  const {
    driverLaps,
    isLoading: isLoadingLaps,
    fetchingDrivers,
  } = useSessionLaps(year, event, session, selectedDrivers, staleTime);

  const flatDriverLaps = useMemo(() => flattenDriverLaps(driverLaps), [driverLaps])

  const compareFastestLaps = async () => {
    const byCode = new Map(flatDriverLaps.map((dl) => [dl.abbreviation, dl.laps]));
    const existing = parseSelectedLaps(laps);

    const proceed = (base: SelectedLap[]) => {
      const merged = [...base];
      for (const code of selectedDrivers) {
        const laps = byCode.get(code);
        if (!laps) continue;
        let bestNum: number | null = null;
        let bestMs = Infinity;
        for (const lap of laps) {
          const ms = lapTimeToMs(lap.lap_time);
          if (ms !== null && lap.lap_number !== null && ms < bestMs) {
            bestMs = ms;
            bestNum = lap.lap_number;
          }
        }
        if (bestNum === null) continue;
        const entry = { year, event, session, driver: code, lap: bestNum };
        if (!isLapSelected(merged, entry)) merged.push(entry);
      }
      if (!merged.length) return;
      setLaps(serializeSelectedLaps(merged));
      setTab("telemetry");
    };

    if (
      await ensureSameCircuit(
        queryClient,
        existing,
        { year, event, session },
        proceed,
      )
    ) {
      proceed(existing);
    }
  };

  const eventNameCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (!schedule?.events) return counts;
    for (const e of schedule.events) {
      counts.set(e.event_name, (counts.get(e.event_name) ?? 0) + 1);
    }
    return counts;
  }, [schedule]);

  const toggleQualiSession = (s: QualiSession) => {
    setSelectedQualiSessions(prev => {
      const res = prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]
      if (!res.length) {
        return prev;
      }
      return res;
    })
  }

  return (
    <div className="shrink-0 flex flex-col">
      <div className="py-1 flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-[9px] font-semibold tracking-[0.25em] uppercase text-data-blue">
            01 · Year
          </span>
          <Select value={year} onValueChange={(val) => setYear(val)}>
            <SelectTrigger className="w-full rounded-none font-mono text-xs text-text-primary border-surface-border bg-surface-card">
              <SelectValue placeholder="Select year" />
            </SelectTrigger>
            <SelectContent
              side="bottom"
              position="popper"
              className="bg-surface-card max-h-60"
            >
              <SelectGroup>
                <SelectLabel>Year</SelectLabel>
                {YEARS.map((y) => {
                  return (
                    <SelectItem key={y} className="text-text-primary" value={y}>
                      {y}
                    </SelectItem>
                  );
                })}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-[9px] font-semibold tracking-[0.25em] uppercase text-data-violet">
            02 · Event
          </span>
          <Select
            value={event}
            disabled={isLoadingSchedule}
            onValueChange={(val) => setEvent(val)}
          >
            <SelectTrigger className="w-full rounded-none font-mono text-xs text-text-primary border-surface-border bg-surface-card">
              <SelectValue placeholder="Select event" />
            </SelectTrigger>
            <SelectContent
              side="bottom"
              position="popper"
              className="bg-surface-card max-h-60"
            >
              <SelectGroup>
                <SelectLabel>Schedule</SelectLabel>
                {schedule?.events?.map((e) => {
                  const isDup = (eventNameCounts.get(e.event_name) ?? 0) > 1;
                  const suffix =
                    isDup && e.event_format === "testing"
                      ? ` ${e.identifier.slice(1)}`
                      : "";
                  const isDisabled = e.status === "upcoming";
                  const item = (
                    <SelectItem
                      key={e.identifier}
                      className="text-text-primary"
                      value={e.identifier}
                      disabled={isDisabled}
                    >
                      {e.event_name}
                      {suffix}
                    </SelectItem>
                  );
                  if (!isDisabled) return item;
                  return (
                    <Tooltip key={e.identifier}>
                      <TooltipTrigger asChild>
                        <div>{item}</div>
                      </TooltipTrigger>
                      <TooltipContent side="right">Upcoming</TooltipContent>
                    </Tooltip>
                  );
                })}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-[9px] font-semibold tracking-[0.25em] uppercase text-data-amber">
            03 · Session
          </span>
          <Select
            value={session}
            disabled={isLoadingRound}
            onValueChange={(val) => {
              setSession(val)
              if (!selectedQualiSessions.length && ['Q', 'SQ'].includes(val)) {
                setSelectedQualiSessions(['Q1', 'Q2', 'Q3'])
              } else if (!['Q', 'SQ'].includes(val)) {
                setSelectedQualiSessions([])
              }
            }}
          >
            <SelectTrigger className="w-full rounded-none font-mono text-xs text-text-primary border-surface-border bg-surface-card">
              <SelectValue placeholder="Select session" />
            </SelectTrigger>
            <SelectContent
              side="bottom"
              position="popper"
              className="bg-surface-card max-h-60"
            >
              <SelectGroup>
                <SelectLabel>Session</SelectLabel>
                {eventSchedule?.sessions.map((s) => {
                  const isDisabled = s.status !== "completed";
                  const item = (
                    <SelectItem
                      key={s.identifier}
                      className="text-text-primary"
                      value={s.identifier}
                      disabled={isDisabled}
                    >
                      {s.name}
                    </SelectItem>
                  );
                  if (!isDisabled) return item;
                  return (
                    <Tooltip key={s.identifier}>
                      <TooltipTrigger asChild>
                        <div>{item}</div>
                      </TooltipTrigger>
                      <TooltipContent side="right">
                        {s.status === "in_progress"
                          ? "In progress"
                          : "Upcoming"}
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        {(["Q", "SQ"].includes(session.toUpperCase()) ) && (
          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-[9px] font-semibold tracking-[0.25em] uppercase text-text-secondary">
              QUALIFYING SESSIONS
            </span>
            <div className="flex gap-1">
              {['Q1','Q2', 'Q3'].map((s) => {
                const isSelected = selectedQualiSessions.includes(s as QualiSession)
                const isLastSelected = isSelected && selectedQualiSessions.length === 1
                const button = (
                  <button
                    className={cn(
                      "border border-accent-green py-1 px-4 text-accent-green font-mono text-xs",
                      isSelected && "bg-accent-green text-black",
                      isLastSelected ? "cursor-not-allowed opacity-60" : "cursor-pointer",
                    )}
                    onClick={() => !isLastSelected && toggleQualiSession(s as QualiSession)}
                  >{s}</button>
                )
                if (!isLastSelected) return <div key={s}>{button}</div>
                return (
                  <Tooltip key={s}>
                    <TooltipTrigger asChild>
                      {button}
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      At least one session must be selected
                    </TooltipContent>
                  </Tooltip>
                )
              })}
            </div>
          </div>
        )}
      </div>
      {(loadingSession || teams.length > 0) && (
        <span className="font-mono text-[9px] font-semibold tracking-[0.25em] uppercase text-data-cyan pt-4 pb-1">
          04 · Drivers
        </span>
      )}
      <div className="flex-1 overflow-y-auto py-2 grid gap-x-2 gap-y-2.5 content-start">
        {loadingSession
          ? Array.from({ length: 10 }).map((_, idx) => (
              <div key={idx}>
                <Skeleton className="h-2 w-12 mb-1 rounded-none bg-text-disabled" />
                <div className="flex gap-1">
                  <Skeleton className="h-6 w-10 rounded-none flex-1 bg-text-disabled" />
                  <Skeleton className="h-6 w-10 rounded-none flex-1 bg-text-disabled" />
                </div>
              </div>
            ))
          : teams.map((team) => {
              return (
                <div
                  key={team.name}
                  className="animate-in fade-in-5 duration-1000"
                >
                  <span className="font-mono text-[9px] text-text-muted uppercase tracking-[0.18em] mb-1 block truncate">
                    {team.name}
                  </span>
                  <div className="flex gap-1">
                    {team?.drivers.map((d: Driver) => {
                      if (!d) return;
                      const active = selectedDrivers.includes(d.abbreviation);
                      const loading = fetchingDrivers.has(d.abbreviation);
                      return (
                        <button
                          type="button"
                          key={d.abbreviation}
                          onClick={() => toggleDriver(d.abbreviation)}
                          disabled={!d.participated}
                          aria-pressed={active}
                          aria-busy={loading}
                          className={cn(
                            "flex-1 py-1.5 font-mono text-xs font-bold text-center relative overflow-hidden transition-colors border border-surface-border",
                            d.participated
                              ? "cursor-pointer hover:border-text-disabled"
                              : "cursor-not-allowed opacity-60 line-through",
                            active
                              ? "text-black border-transparent"
                              : "text-text-muted",
                          )}
                        >
                          <span
                            className={cn(
                              "absolute left-0 top-0 bottom-0 transition-[width] duration-300 ease-in-out",
                              loading && "driver-fill-pulse",
                            )}
                            style={{
                              width: active ? "100%" : "3px",
                              background: `#${team.color}`,
                            }}
                          />
                          <span className="relative z-10">
                            {d.abbreviation}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
      </div>
      <div className="flex flex-col gap-2 pt-4">
        <button
          type="button"
          onClick={compareFastestLaps}
          disabled={selectedDrivers.length === 0 || isLoadingLaps}
          className="cursor-pointer w-full py-2.5 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] bg-accent-green hover:bg-accent-green-hover text-black transition-colors [clip-path:polygon(0_0,100%_0,100%_calc(100%-10px),calc(100%-10px)_100%,0_100%)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-accent-green"
        >
          {isLoadingLaps ? "Loading laps…" : "Compare fastest laps →"}
        </button>
        <button
          type="button"
          className="cursor-pointer w-full py-2.5 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] border border-surface-border bg-surface-card hover:bg-surface-card-hover text-text-secondary hover:text-text-primary transition-colors"
          onClick={() => setDrivers(null)}
        >
          Clear drivers
        </button>
      </div>
    </div>
  );
}
