"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Loader2, Maximize2, Minimize2, X } from "lucide-react";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import type { LapTelemetryWithSession, CircuitInfo } from "@/lib/types";
import { prepareReplay, type ReplayLap } from "@/lib/replay/prepare";
import { cornerMarks } from "@/lib/replay/corners";
import { lapColor } from "@/lib/colors";
import { useSectorBests } from "@/lib/hooks/useSectorBests";
import ReplayTrack from "./ReplayTrack";
import ReplayControls from "./ReplayControls";
import ReplayStatCards from "./ReplayStatCards";
import { useReplayPlayback, type Loop } from "./useReplayPlayback";

const NO_LAPS: ReplayLap[] = [];

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  telemetryData: LapTelemetryWithSession[];
  circuit: CircuitInfo | null | undefined;
  isPending: boolean;
  colorSlots: Record<string, number>;
  customColors: Record<string, string>;
  initialTime: number;
  initialLoop: Loop | null;
  buildShareUrl: (t: number | null, loop: Loop | null) => string;
};

export default function ReplayModal({
  open,
  onOpenChange,
  telemetryData,
  circuit,
  isPending,
  colorSlots,
  customColors,
  initialTime,
  initialLoop,
  buildShareUrl,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);
  const [orderKeys, setOrderKeys] = useState<string[] | null>(null);
  const [loopPreview, setLoopPreview] = useState<Loop | null>(null);
  const [trackAspect, setTrackAspect] = useState<number | null>(null);
  const roomForSidePanel = useMediaQuery("(min-width: 768px)");
  const roomForSidePanelCollapsed = useMediaQuery("(min-width: 1024px)");
  const sideLayout = roomForSidePanelCollapsed || (expanded && roomForSidePanel);

  const replay = useMemo(
    () => (open ? prepareReplay(telemetryData) : null),
    [open, telemetryData],
  );

  const corners = useMemo(() => {
    if (!replay) return null;
    return cornerMarks(
      replay.laps.find((l) => l.key === replay.referenceKey),
      circuit,
    );
  }, [replay, circuit]);

  const snapTimes = useMemo(() => {
    const total = replay?.totalDuration ?? 0;
    const times = [0];
    if (corners) for (const c of corners) times.push(c.time);
    if (total > 0) times.push(total);
    return times;
  }, [corners, replay]);

  const orderedLaps = useMemo(() => {
    if (!replay) return [];
    if (!orderKeys) return replay.laps;
    const byKey = new Map(replay.laps.map((l) => [l.key, l]));
    const ordered: ReplayLap[] = [];
    const placed = new Set<string>();
    for (const key of orderKeys) {
      const lap = byKey.get(key);
      if (lap) {
        ordered.push(lap);
        placed.add(key);
      }
    }
    for (const lap of replay.laps) {
      if (!placed.has(lap.key)) ordered.push(lap);
    }
    return ordered;
  }, [replay, orderKeys]);

  const handleReorder = useCallback((next: ReplayLap[]) => {
    setOrderKeys(next.map((l) => l.key));
  }, []);

  const colorFor = useCallback(
    (key: string) => customColors[key] ?? lapColor(colorSlots[key] ?? 0),
    [customColors, colorSlots],
  );

  const sectorBests = useSectorBests(replay?.laps ?? NO_LAPS);

  const playback = useReplayPlayback({
    duration: replay?.totalDuration ?? 0,
    initialTime,
    initialLoop,
    snapTimes,
    keyboardEnabled: open,
  });

  const { pause } = playback;
  useEffect(() => {
    if (!open) pause();
  }, [open, pause]);

  const ariaSummary = useMemo(() => {
    if (!replay) return "Replay loading";
    const names = replay.laps.map((l) => `${l.driver} lap ${l.lap}`).join(", ");
    return `Lap replay comparing ${names}. Press space to play or pause.`;
  }, [replay]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            "fixed z-50 flex flex-col border border-surface-border bg-surface-base text-text-primary shadow-2xl outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            expanded
              ? "inset-0 sm:inset-4"
              : "top-1/2 left-1/2 h-[min(920px,94dvh)] w-[min(1000px,95vw)] -translate-x-1/2 -translate-y-1/2",
          )}
        >
          <ReplayHeader
            replay={replay}
            expanded={expanded}
            onExpandToggle={() => setExpanded((v) => !v)}
            onClose={() => onOpenChange(false)}
          />
          <div
            className={cn(
              "flex min-h-0 flex-1",
              sideLayout ? "flex-row" : "flex-col",
            )}
          >
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
              {!replay ? (
                <ReplaySkeleton isPending={isPending} />
              ) : (
                <>
                  <div
                    className={cn(
                      "min-h-[180px] py-2 sm:py-4",
                      sideLayout || trackAspect === null
                        ? "flex-1"
                        : "max-h-full shrink",
                    )}
                    style={
                      sideLayout || trackAspect === null
                        ? undefined
                        : { aspectRatio: trackAspect }
                    }
                  >
                    <ReplayTrack
                      replay={replay}
                      circuit={circuit}
                      corners={corners}
                      loopPreview={loopPreview}
                      colorFor={colorFor}
                      playback={playback}
                      hoveredKey={hoveredKey}
                      onHoverKey={setHoveredKey}
                      pinnedKey={pinnedKey}
                      ariaSummary={ariaSummary}
                      onAspect={setTrackAspect}
                    />
                  </div>
                  {!sideLayout && (
                    <ReplayStatCards
                      laps={orderedLaps}
                      onReorder={handleReorder}
                      referenceKey={replay.referenceKey}
                      colorFor={colorFor}
                      hoveredKey={hoveredKey}
                      onHoverKey={setHoveredKey}
                      pinnedKey={pinnedKey}
                      onPinKey={setPinnedKey}
                      playback={playback}
                      sectorBests={sectorBests}
                      layout="bottom"
                    />
                  )}
                  <ReplayControls
                    playback={playback}
                    corners={corners}
                    onLoopPreview={setLoopPreview}
                    onCopyUrl={buildShareUrl}
                  />
                </>
              )}
            </div>
            {sideLayout && replay && (
              <ReplayStatCards
                laps={orderedLaps}
                onReorder={handleReorder}
                referenceKey={replay.referenceKey}
                colorFor={colorFor}
                hoveredKey={hoveredKey}
                onHoverKey={setHoveredKey}
                pinnedKey={pinnedKey}
                onPinKey={setPinnedKey}
                playback={playback}
                sectorBests={sectorBests}
                layout="side"
              />
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function ReplayHeader({
  replay,
  expanded,
  onExpandToggle,
  onClose,
}: {
  replay: ReturnType<typeof prepareReplay>;
  expanded: boolean;
  onExpandToggle: () => void;
  onClose: () => void;
}) {
  const count = replay?.laps.length ?? 0;
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-surface-border bg-surface-card px-3 py-2 sm:px-4 sm:py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 rounded-full bg-accent-green animate-pulse"
        />
        <DialogPrimitive.Title asChild>
          <h2 className="truncate font-mono text-[13px] tracking-[0.25em] uppercase text-text-primary">
            Lap Replay
          </h2>
        </DialogPrimitive.Title>
        {count > 0 && (
          <span className="hidden truncate font-mono text-[12px] tracking-[0.15em] uppercase text-text-muted sm:inline">
            · {count} lap{count === 1 ? "" : "s"}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onExpandToggle}
          aria-label={
            expanded ? "Collapse replay" : "Expand replay to fill screen"
          }
          aria-pressed={expanded}
          className="flex size-9 items-center justify-center pointer-coarse:size-11 text-text-secondary transition-colors hover:bg-surface-card-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent-green cursor-pointer"
        >
          {expanded ? (
            <Minimize2 className="size-3.5" aria-hidden="true" />
          ) : (
            <Maximize2 className="size-3.5" aria-hidden="true" />
          )}
        </button>
        <DialogPrimitive.Close asChild>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close replay"
            className="flex size-9 items-center justify-center pointer-coarse:size-11 text-text-secondary transition-colors hover:bg-surface-card-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent-green cursor-pointer"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </DialogPrimitive.Close>
      </div>
    </div>
  );
}

function ReplaySkeleton({ isPending }: { isPending: boolean }) {
  return (
    <output
      aria-live="polite"
      className="flex flex-1 flex-col items-center justify-center gap-3 bg-surface-base p-6 text-center"
    >
      {isPending ? (
        <>
          <Loader2
            className="size-6 animate-spin text-accent-green"
            aria-hidden="true"
          />
          <span className="font-mono text-[12px] tracking-[0.25em] uppercase text-text-muted">
            Loading telemetry
          </span>
          <p className="max-w-sm text-sm text-text-secondary">
            Preparing lap traces for replay.
          </p>
        </>
      ) : (
        <>
          <span className="font-mono text-[12px] tracking-[0.25em] uppercase text-text-muted">
            No laps
          </span>
          <p className="max-w-sm text-sm text-text-secondary">
            Select at least one lap from the session, then reopen replay.
          </p>
        </>
      )}
    </output>
  );
}
