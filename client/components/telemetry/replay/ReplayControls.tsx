"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link2, Pause, Play, Repeat, RotateCcw, Timer, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatLapTime } from "@/lib/format";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { CornerMark } from "@/lib/replay/corners";
import type { Loop, PlaybackApi, PlaybackSpeed } from "./useReplayPlayback";
import { SPEEDS } from "./useReplayPlayback";

const THUMB_SIZE = 18;
const DRAG_DEAD_ZONE = 6;

const CONTROL_BUTTON_CLASS =
  "flex size-11 items-center justify-center border border-surface-border bg-surface-card text-text-secondary transition-colors hover:bg-surface-card-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent-green disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer";

function formatTime(seconds: number): string {
  return formatLapTime(Number.isFinite(seconds) && seconds > 0 ? seconds : 0);
}

type Props = {
  playback: PlaybackApi;
  corners: CornerMark[] | null;
  onLoopPreview: (loop: Loop | null) => void;
  onCopyUrl: (t: number | null, loop: Loop | null) => Promise<string> | string;
};

export default function ReplayControls({
  playback,
  corners,
  onLoopPreview,
  onCopyUrl,
}: Props) {
  const sliderRef = useRef<HTMLInputElement | null>(null);
  const fillRef = useRef<HTMLDivElement | null>(null);
  const timeRef = useRef<HTMLSpanElement | null>(null);
  const seekingRef = useRef(false);

  const { duration, loop, loopA, loopB, setLoopRange, clearLoop } = playback;
  const applyTime = useCallback(
    (t: number) => {
      const fraction = duration ? Math.min(1, Math.max(0, t / duration)) : 0;
      if (timeRef.current) timeRef.current.textContent = formatTime(t);
      if (fillRef.current) {
        fillRef.current.style.width = `calc(${THUMB_SIZE / 2}px + ${fraction} * (100% - ${THUMB_SIZE}px))`;
      }
      const slider = sliderRef.current;
      if (slider) {
        slider.value = String(t);
        slider.setAttribute("aria-valuenow", t.toFixed(2));
        slider.setAttribute(
          "aria-valuetext",
          `${formatTime(t)} of ${formatTime(duration)}${
            loop
              ? `, looping ${formatTime(loop.a)} to ${formatTime(loop.b)}`
              : ""
          }`,
        );
      }
    },
    [duration, loop],
  );

  useEffect(() => {
    const unsub = playback.subscribe((t) => {
      if (seekingRef.current) return;
      applyTime(t);
    });
    return unsub;
  }, [playback, applyTime]);

  const fractionOf = (t: number) =>
    duration ? Math.min(1, Math.max(0, t / duration)) : 0;
  const inset = (f: number) =>
    `calc(${THUMB_SIZE / 2}px + ${f} * (100% - ${THUMB_SIZE}px))`;

  const stripRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ time: number; clientX: number } | null>(null);
  const [dragRange, setDragRange] = useState<{ a: number; b: number } | null>(
    null,
  );

  const snapPoints = useMemo(() => {
    const points = [{ time: 0, label: "the line" }];
    if (corners) {
      for (const c of corners) points.push({ time: c.time, label: c.label });
    }
    if (duration > 0) points.push({ time: duration, label: "the line" });
    return points;
  }, [corners, duration]);

  const snap = useCallback(
    (t: number) => {
      let best = snapPoints[0]!;
      let bestDelta = Infinity;
      for (const p of snapPoints) {
        const delta = Math.abs(p.time - t);
        if (delta < bestDelta) {
          bestDelta = delta;
          best = p;
        }
      }
      return best;
    },
    [snapPoints],
  );

  const labelFor = useCallback(
    (t: number) => {
      const p = snap(t);
      return Math.abs(p.time - t) < 0.05 ? p.label : formatTime(t);
    },
    [snap],
  );

  const timeAtClientX = useCallback(
    (clientX: number) => {
      const el = stripRef.current;
      if (!el || duration <= 0) return 0;
      const rect = el.getBoundingClientRect();
      const usable = rect.width - THUMB_SIZE;
      if (usable <= 0) return 0;
      const f = (clientX - rect.left - THUMB_SIZE / 2) / usable;
      return Math.min(1, Math.max(0, f)) * duration;
    },
    [duration],
  );

  const onStripDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (duration <= 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const time = timeAtClientX(e.clientX);
    dragRef.current = { time, clientX: e.clientX };
    setDragRange({ a: time, b: time });
  };

  const onStripMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const t = timeAtClientX(e.clientX);
    setDragRange({ a: Math.min(drag.time, t), b: Math.max(drag.time, t) });
  };

  const onStripUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDragRange(null);
    if (!drag) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (Math.abs(e.clientX - drag.clientX) < DRAG_DEAD_ZONE) return;
    const t = timeAtClientX(e.clientX);
    const a = snap(Math.min(drag.time, t));
    const b = snap(Math.max(drag.time, t));
    if (b.time - a.time < 0.25) return;
    setLoopRange(a.time, b.time);
    playback.seek(a.time);
  };

  const preview = dragRange
    ? { a: snap(dragRange.a), b: snap(dragRange.b) }
    : null;
  const band = preview ? { a: preview.a.time, b: preview.b.time } : loop;

  const previewA = preview?.a.time ?? null;
  const previewB = preview?.b.time ?? null;
  useEffect(() => {
    onLoopPreview(
      previewA !== null && previewB !== null && previewB - previewA >= 0.25
        ? { a: previewA, b: previewB }
        : null,
    );
  }, [previewA, previewB, onLoopPreview]);

  const loopMessage = loop
    ? `Looping ${labelFor(loop.a)} to ${labelFor(loop.b)}`
    : "No loop";

  const handleCopy = async (withTime: boolean) => {
    const t = withTime ? playback.getTime() : null;
    try {
      const url = await onCopyUrl(t, loop);
      await navigator.clipboard.writeText(url);
      const loopNote = loop
        ? ` · loops ${formatTime(loop.a)}–${formatTime(loop.b)}`
        : "";
      toast.success(t === null ? "Link copied" : "Moment copied", {
        description:
          (t === null
            ? "Opens this replay from the start"
            : `Paused at ${formatTime(t)}`) + loopNote,
      });
    } catch (err) {
      console.error(err);
      toast.error(
        t === null ? "Couldn't copy that link" : "Couldn't copy that moment",
      );
    }
  };

  const initial = playback.getTime();

  return (
    <div className="flex shrink-0 flex-col gap-1 border-t border-surface-border bg-surface-card px-3 pt-7 pb-3 sm:px-4">
      <div className="relative">
        <div
          ref={stripRef}
          aria-hidden="true"
          title="Drag to loop a section between corners"
          onPointerDown={onStripDown}
          onPointerMove={onStripMove}
          onPointerUp={onStripUp}
          onPointerCancel={onStripUp}
          className="absolute inset-x-0 -top-6 z-20 h-6 cursor-ew-resize touch-none"
        >
          {corners?.map((c) => {
            const inBand = !!band && c.time >= band.a && c.time <= band.b;
            return (
              <div
                key={c.id}
                className={cn(
                  "pointer-events-none absolute bottom-0 -translate-x-1/2 rounded-full",
                  inBand
                    ? "h-4 w-0.5 bg-accent-green"
                    : "h-2.5 w-px bg-surface-border",
                )}
                style={{ left: inset(fractionOf(c.time)) }}
              />
            );
          })}
        </div>
        <div
          className="pointer-events-none absolute inset-0 my-auto h-1 rounded-full bg-surface-border"
          aria-hidden="true"
        />
        {band && (
          <div
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-y-0 my-auto h-1 rounded-full",
              preview ? "bg-accent-green/60" : "bg-accent-green/30",
            )}
            style={{
              left: inset(fractionOf(band.a)),
              width: `calc(${fractionOf(band.b) - fractionOf(band.a)} * (100% - ${THUMB_SIZE}px))`,
            }}
          />
        )}
        <div
          ref={fillRef}
          className="pointer-events-none absolute inset-y-0 left-0 my-auto h-1 rounded-full bg-accent-green"
          style={{ width: `${THUMB_SIZE / 2}px` }}
          aria-hidden="true"
        />
        {(band ? [band.a, band.b] : [loopA, loopB]).map((t, i) =>
          t === null ? null : (
            <div
              key={i === 0 ? "loop-a" : "loop-b"}
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 z-10 my-auto h-4 w-0.5 -translate-x-1/2 rounded-full bg-text-primary"
              style={{ left: inset(fractionOf(t)) }}
            />
          ),
        )}
        <input
          ref={sliderRef}
          type="range"
          min={0}
          max={duration}
          step={duration > 0 ? duration / 1000 : 0.05}
          defaultValue={initial}
          aria-label="Replay position"
          aria-valuemin={0}
          aria-valuemax={playback.duration}
          aria-valuenow={initial}
          aria-valuetext={`${formatTime(initial)} of ${formatTime(playback.duration)}`}
          onPointerDown={() => {
            seekingRef.current = true;
            playback.pause();
          }}
          onPointerUp={() => {
            seekingRef.current = false;
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
              e.preventDefault();
              playback.pause();
              const step = e.shiftKey ? 5 : 1;
              playback.seekBy(e.key === "ArrowRight" ? step : -step);
              return;
            }
            if (
              e.key === "Home" ||
              e.key === "End" ||
              e.key === "PageUp" ||
              e.key === "PageDown"
            ) {
              seekingRef.current = true;
              playback.pause();
            }
          }}
          onKeyUp={() => {
            seekingRef.current = false;
          }}
          onChange={(e) => {
            const v = parseFloat(e.currentTarget.value);
            applyTime(v);
            playback.seek(v);
          }}
          className="replay-scrubber relative z-10 block h-11 w-full appearance-none bg-transparent focus-visible:outline-none"
        />
      </div>

      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {loopMessage}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label={playback.playing ? "Pause replay" : "Play replay"}
            aria-pressed={playback.playing}
            onClick={playback.toggle}
            className="group/play flex size-11 items-center justify-center border border-accent-green bg-accent-green/10 text-accent-green transition-all hover:bg-accent-green/20 focus-visible:outline-2 focus-visible:outline-accent-green cursor-pointer"
          >
            {playback.playing ? (
              <Pause className="size-4" aria-hidden="true" />
            ) : (
              <Play className="size-4 translate-x-[1px]" aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            aria-label={
              loop ? "Restart from loop start" : "Restart from beginning"
            }
            onClick={playback.restart}
            className="flex size-11 items-center justify-center border border-surface-border bg-surface-card text-text-secondary transition-colors hover:bg-surface-card-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent-green cursor-pointer"
          >
            <RotateCcw className="size-3.5" aria-hidden="true" />
          </button>
          <span
            className="ml-2 shrink-0 font-mono text-[14px] tabular-nums tracking-tight whitespace-nowrap"
            aria-hidden="true"
          >
            <span ref={timeRef} className="text-accent-green">
              {formatTime(initial)}
            </span>
            <span className="text-text-muted">
              {" / "}
              {formatTime(playback.duration)}
            </span>
          </span>
          {loop ? (
            <div className="ml-2 flex h-8 items-center gap-1.5 border border-accent-green bg-accent-green/10 pr-1 pl-2.5">
              <Repeat className="size-3 text-accent-green" aria-hidden="true" />
              <span className="font-mono text-[12px] tracking-widest whitespace-nowrap text-accent-green">
                {labelFor(loop.a)} → {labelFor(loop.b)}
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={clearLoop}
                    aria-label={`Clear loop from ${labelFor(loop.a)} to ${labelFor(loop.b)}`}
                    className="flex size-6 items-center justify-center text-accent-green transition-colors hover:bg-accent-green/20 focus-visible:outline-2 focus-visible:outline-accent-green cursor-pointer"
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  Clear loop · \
                </TooltipContent>
              </Tooltip>
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div
            role="radiogroup"
            aria-label="Playback speed"
            className="flex items-center gap-px border border-surface-border bg-surface-base p-0.5"
          >
            {SPEEDS.map((s: PlaybackSpeed) => {
              const active = playback.speed === s;
              return (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => playback.setSpeed(s)}
                  className={cn(
                    "min-h-9 min-w-11 px-2 font-mono text-[12px] tabular-nums tracking-widest transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-accent-green",
                    active
                      ? "bg-accent-green text-black"
                      : "text-text-muted hover:bg-surface-card-hover hover:text-text-primary",
                  )}
                >
                  {s}×
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => handleCopy(false)}
                  aria-label="Copy link to this replay"
                  className={CONTROL_BUTTON_CLASS}
                >
                  <Link2 className="size-3.5" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                Copy link to this replay
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => handleCopy(true)}
                  disabled={playback.playing}
                  aria-label="Copy link to this moment"
                  className={CONTROL_BUTTON_CLASS}
                >
                  <Timer className="size-3.5" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                {playback.playing
                  ? "Pause to copy a moment"
                  : "Copy link to this moment"}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  );
}
