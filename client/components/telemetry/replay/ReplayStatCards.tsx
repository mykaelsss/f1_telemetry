"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MotionConfig, motion } from "motion/react";
import { GripVertical, Info, Pin } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Compound } from "@/lib/types";
import type { ReplayLap } from "@/lib/replay/prepare";
import TyreBadge from "../TyreBadge";
import { deltaToReference, sampleLapAt } from "@/lib/replay/sample";
import type { SectorBests, SectorRank } from "@/lib/hooks/useSectorBests";
import type { PlaybackApi } from "./useReplayPlayback";

const SWAP_ANIM_S = 0.18;
const SWAP_COOLDOWN_MS = 200;
const EDGE_SCROLL_ZONE = 48;
const EDGE_SCROLL_SPEED = 10;

type DragOrigin = {
  key: string;
  pointerX: number;
  pointerY: number;
  centerX: number;
  centerY: number;
  scrollTop: number;
};

const RANK_FILL: Record<SectorRank, string> = {
  best: "var(--data-violet)",
  personal: "var(--accent-green)",
  normal: "var(--data-yellow)",
};

const RANK_TAG: Record<SectorRank, string> = {
  best: "SB",
  personal: "PB",
  normal: "",
};

const RANK_SPEECH: Record<SectorRank, string> = {
  best: "session best",
  personal: "personal best",
  normal: "",
};

type SectorCell = {
  at: number | null;
  text: string;
  color: string | null;
  absText: string;
  absColor: string | null;
  fill: string | null;
  tag: string;
  rank: SectorRank | null;
  delta: number | null;
};

function buildSectorCells(
  lap: ReplayLap,
  referenceLap: ReplayLap | null,
  rankFor: SectorBests["rankFor"],
): SectorCell[] {
  const isReference = referenceLap !== null && lap.key === referenceLap.key;
  let elapsed = 0;
  let contiguous = true;
  return [0, 1, 2].map((i) => {
    const blank: SectorCell = {
      at: null,
      text: "—",
      color: null,
      absText: "—",
      absColor: null,
      fill: null,
      tag: "",
      rank: null,
      delta: null,
    };
    const sector = lap.sectors[i] ?? null;
    if (sector === null) {
      contiguous = false;
      return blank;
    }
    elapsed += sector;
    const at = contiguous ? elapsed : lap.finishTime;
    const rank = rankFor(lap, i, sector);
    const fill = rank ? RANK_FILL[rank] : null;
    const tag = rank ? RANK_TAG[rank] : "";
    const absText = sector.toFixed(3);
    const absColor = fill ? "var(--surface-base)" : "var(--text-secondary)";
    if (isReference) {
      return {
        at,
        text: absText,
        color: absColor,
        absText,
        absColor,
        fill,
        tag,
        rank,
        delta: null,
      };
    }
    const reference = referenceLap?.sectors[i] ?? null;
    if (reference === null) return blank;
    const delta = sector - reference;
    return {
      at,
      text: `${delta >= 0 ? "+" : "−"}${Math.abs(delta).toFixed(3)}`,
      color: fill
        ? "var(--surface-base)"
        : delta >= 0
          ? "var(--accent-red-hover)"
          : "var(--accent-green)",
      absText,
      absColor,
      fill,
      tag,
      rank,
      delta,
    };
  });
}

function segmentLabel(
  lap: ReplayLap,
  segmentFor: SectorBests["segmentFor"],
): string | null {
  const name = segmentFor(lap);
  if (!name) return null;
  return name.toUpperCase() === lap.session.toUpperCase() ? null : name;
}

const SCOPE_NOTE =
  "Sector colors are ranked against the selected drivers only — not the full grid. In qualifying, Q1, Q2 and Q3 are ranked separately.";

type Props = {
  laps: ReplayLap[];
  onReorder: (laps: ReplayLap[]) => void;
  referenceKey: string;
  colorFor: (key: string) => string;
  hoveredKey: string | null;
  onHoverKey: (key: string | null) => void;
  pinnedKey: string | null;
  onPinKey: (key: string | null) => void;
  playback: PlaybackApi;
  sectorBests: SectorBests;
  layout: "bottom" | "side";
};

export default function ReplayStatCards({
  laps,
  onReorder,
  referenceKey,
  colorFor,
  hoveredKey,
  onHoverKey,
  pinnedKey,
  onPinKey,
  playback,
  sectorBests,
  layout,
}: Props) {
  const referenceLap =
    laps.find((l) => l.key === referenceKey) ?? laps[0] ?? null;
  const announcedLap =
    laps.find((l) => l.key === pinnedKey) ?? referenceLap ?? null;
  const togglePin = (key: string) => onPinKey(pinnedKey === key ? null : key);
  const [moveMessage, setMoveMessage] = useState("");
  const [hoveredSector, setHoveredSector] = useState<number | null>(null);
  const [showAbsolute, setShowAbsolute] = useState(false);

  const { segmentFor } = sectorBests;
  const segmented = useMemo(
    () => laps.some((l) => segmentLabel(l, segmentFor)),
    [laps, segmentFor],
  );

  const moveLap = useCallback(
    (key: string, delta: number) => {
      const from = laps.findIndex((l) => l.key === key);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= laps.length) return;
      const next = [...laps];
      const [moved] = next.splice(from, 1);
      if (!moved) return;
      next.splice(to, 0, moved);
      onReorder(next);
      setMoveMessage(
        `${moved.driver} lap ${moved.lap} moved to position ${to + 1} of ${next.length}`,
      );
    },
    [laps, onReorder],
  );

  const itemRefs = useRef(new Map<string, HTMLElement>());
  const scrollRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<DragOrigin | null>(null);
  const pointerRef = useRef({ x: 0, y: 0 });
  const appliedRef = useRef({ dx: 0, dy: 0 });
  const lastSwapRef = useRef(0);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);

  const registerItem = useCallback((key: string, el: HTMLElement | null) => {
    if (el) itemRefs.current.set(key, el);
    else itemRefs.current.delete(key);
  }, []);

  const dragStart = useCallback((key: string, x: number, y: number) => {
    const el = itemRefs.current.get(key);
    if (!el) return;
    const r = el.getBoundingClientRect();
    dragRef.current = {
      key,
      pointerX: x,
      pointerY: y,
      centerX: r.left + r.width / 2,
      centerY: r.top + r.height / 2,
      scrollTop: scrollRef.current?.scrollTop ?? 0,
    };
    pointerRef.current = { x, y };
    appliedRef.current = { dx: 0, dy: 0 };
    el.style.transform = "";
    lastSwapRef.current = 0;
    setDraggingKey(key);
  }, []);

  const dragOver = useCallback(
    (x: number, y: number) => {
      const d = dragRef.current;
      if (!d) return;
      pointerRef.current = { x, y };
      const drift = (scrollRef.current?.scrollTop ?? 0) - d.scrollTop;
      const projY = d.centerY + (y - d.pointerY) - drift;

      const dragged = itemRefs.current.get(d.key);
      if (!dragged) return;
      const applied = appliedRef.current;
      const draggedRect = dragged.getBoundingClientRect();
      const slotX = draggedRect.left + draggedRect.width / 2 - applied.dx;
      const slotY = draggedRect.top + draggedRect.height / 2 - applied.dy;

      const box = scrollRef.current?.getBoundingClientRect();
      const half = draggedRect.width / 2;
      const loose = d.centerX + (x - d.pointerX);
      const projX =
        box && box.width >= draggedRect.width
          ? Math.min(Math.max(loose, box.left + half), box.right - half)
          : slotX;

      const nextDx = projX - slotX;
      const nextDy = projY - slotY;
      appliedRef.current = { dx: nextDx, dy: nextDy };
      dragged.style.transform = `translate3d(${nextDx}px, ${nextDy}px, 0)`;

      if (Date.now() - lastSwapRef.current < SWAP_COOLDOWN_MS) return;
      let bestKey: string | null = null;
      let bestDist = nextDx * nextDx + nextDy * nextDy;
      for (const [key, el] of itemRefs.current) {
        if (key === d.key) continue;
        const r = el.getBoundingClientRect();
        const dx = r.left + r.width / 2 - projX;
        const dy = r.top + r.height / 2 - projY;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) {
          bestDist = dist;
          bestKey = key;
        }
      }
      if (bestKey === null) return;
      const from = laps.findIndex((l) => l.key === d.key);
      const to = laps.findIndex((l) => l.key === bestKey);
      if (from < 0 || to < 0) return;
      const next = [...laps];
      const [moved] = next.splice(from, 1);
      if (!moved) return;
      next.splice(to, 0, moved);
      lastSwapRef.current = Date.now();
      onReorder(next);
    },
    [laps, onReorder],
  );

  const dragEnd = useCallback(() => {
    const d = dragRef.current;
    dragRef.current = null;
    setDraggingKey(null);
    if (!d) return;
    const dragged = itemRefs.current.get(d.key);
    if (dragged) dragged.style.transform = "";
    appliedRef.current = { dx: 0, dy: 0 };
    const at = laps.findIndex((l) => l.key === d.key);
    const lap = laps[at];
    if (!lap) return;
    setMoveMessage(
      `${lap.driver} lap ${lap.lap} moved to position ${at + 1} of ${laps.length}`,
    );
  }, [laps]);

  useEffect(() => {
    if (!draggingKey) return;
    const move = (e: PointerEvent) => dragOver(e.clientX, e.clientY);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", dragEnd);
    window.addEventListener("pointercancel", dragEnd);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", dragEnd);
      window.removeEventListener("pointercancel", dragEnd);
    };
  }, [draggingKey, dragOver, dragEnd]);

  useEffect(() => {
    if (!draggingKey) return;
    let frame = 0;
    const step = () => {
      const box = scrollRef.current;
      if (box && box.scrollHeight > box.clientHeight) {
        const r = box.getBoundingClientRect();
        const { x, y } = pointerRef.current;
        const before = box.scrollTop;
        if (y < r.top + EDGE_SCROLL_ZONE) box.scrollTop -= EDGE_SCROLL_SPEED;
        else if (y > r.bottom - EDGE_SCROLL_ZONE)
          box.scrollTop += EDGE_SCROLL_SPEED;
        if (box.scrollTop !== before) dragOver(x, y);
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [draggingKey, dragOver]);

  const cards = (
    <MotionConfig reducedMotion="user">
      <ul
        aria-label="Live lap telemetry"
        className={cn(
          "flex list-none gap-2",
          layout === "side" ? "flex-col" : "flex-wrap",
        )}
      >
        {laps.map((lap) => (
          <SortableLapCard
            key={lap.key}
            lap={lap}
            layout={layout}
            registerItem={registerItem}
            dragging={draggingKey === lap.key}
            onDragStart={dragStart}
            referenceLap={referenceLap}
            color={colorFor(lap.key)}
            active={(hoveredKey ?? pinnedKey) === lap.key}
            pinned={pinnedKey === lap.key}
            onHover={onHoverKey}
            onToggle={togglePin}
            onMove={moveLap}
            playback={playback}
            sectorBests={sectorBests}
            hoveredSector={hoveredSector}
            onHoverSector={setHoveredSector}
            showAbsolute={showAbsolute}
          />
        ))}
      </ul>
    </MotionConfig>
  );

  const liveRegion = (
    <div aria-live="polite" aria-atomic="true" className="sr-only">
      {moveMessage}
    </div>
  );

  if (layout === "side") {
    return (
      <aside
        ref={scrollRef}
        aria-label="Live lap telemetry"
        className="flex w-72 shrink-0 flex-col gap-2 overflow-y-auto border-l border-surface-border bg-surface-card p-3"
      >
        <div className="font-mono text-[12px] tracking-[0.25em] uppercase text-text-muted">
          Live Data
        </div>
        <SectorLegend
          segmented={segmented}
          showAbsolute={showAbsolute}
          onShowAbsolute={setShowAbsolute}
        />
        {cards}
        {liveRegion}
        {announcedLap && referenceLap && (
          <Announcer
            lap={announcedLap}
            referenceLap={referenceLap}
            playback={playback}
            sectorBests={sectorBests}
          />
        )}
      </aside>
    );
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 border-b border-surface-border bg-surface-card p-2">
        <SectorLegend
          segmented={segmented}
          showAbsolute={showAbsolute}
          onShowAbsolute={setShowAbsolute}
        />
        <div
          ref={(el) => {
            scrollRef.current = el;
          }}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          {cards}
        </div>
      </div>
      {liveRegion}
      {announcedLap && referenceLap && (
        <Announcer
          lap={announcedLap}
          referenceLap={referenceLap}
          playback={playback}
          sectorBests={sectorBests}
        />
      )}
    </>
  );
}

function SectorLegend({
  segmented,
  showAbsolute,
  onShowAbsolute,
}: {
  segmented: boolean;
  showAbsolute: boolean;
  onShowAbsolute: (next: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 font-mono text-[12px] tracking-[0.1em] uppercase text-text-muted">
      {segmented && <span>Per qualifying session:</span>}
      {(
        [
          ["best", segmented ? "Best" : "Session best"],
          ["personal", "Personal best"],
          ["normal", "No improvement"],
        ] as const
      ).map(([rank, label]) => (
        <span key={rank} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block size-2 shrink-0 rounded-xs"
            style={{ backgroundColor: RANK_FILL[rank] }}
          />
          {RANK_TAG[rank] && (
            <span className="font-bold tracking-normal text-text-secondary">
              {RANK_TAG[rank]}
            </span>
          )}
          {label}
        </span>
      ))}
      <div
        role="radiogroup"
        aria-label="Sector time display"
        className="ml-auto flex shrink-0 items-center gap-px border border-surface-border bg-surface-base p-0.5"
      >
        {(
          [
            [
              false,
              "Δ",
              "Delta — show sector times relative to the reference lap",
            ],
            [true, "ABS", "ABS — show absolute sector times"],
          ] as const
        ).map(([value, label, description]) => {
          const active = showAbsolute === value;
          return (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={description}
              onClick={() => onShowAbsolute(value)}
              className={cn(
                "min-h-6 min-w-8 px-1.5 font-mono text-[12px] tracking-widest transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-accent-green",
                active
                  ? "bg-accent-green text-black"
                  : "text-text-muted hover:bg-surface-card-hover hover:text-text-primary",
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={SCOPE_NOTE}
            className="flex size-6 shrink-0 items-center justify-center text-text-muted transition-colors hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent-green cursor-help"
          >
            <Info className="size-4" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" align="end" className="max-w-sm text-sm">
          {SCOPE_NOTE}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

function SortableLapCard({
  lap,
  layout,
  registerItem,
  dragging,
  onDragStart,
  referenceLap,
  color,
  active,
  pinned,
  onHover,
  onToggle,
  onMove,
  playback,
  sectorBests,
  hoveredSector,
  onHoverSector,
  showAbsolute,
}: {
  lap: ReplayLap;
  layout: "bottom" | "side";
  registerItem: (key: string, el: HTMLElement | null) => void;
  dragging: boolean;
  onDragStart: (key: string, x: number, y: number) => void;
  referenceLap: ReplayLap | null;
  color: string;
  active: boolean;
  pinned: boolean;
  onHover: (key: string | null) => void;
  onToggle: (key: string) => void;
  onMove: (key: string, delta: number) => void;
  playback: PlaybackApi;
  sectorBests: SectorBests;
  hoveredSector: number | null;
  onHoverSector: (sector: number | null) => void;
  showAbsolute: boolean;
}) {
  const back = layout === "side" ? "ArrowUp" : "ArrowLeft";
  const forward = layout === "side" ? "ArrowDown" : "ArrowRight";

  return (
    <motion.li
      layout={!dragging}
      transition={{ duration: SWAP_ANIM_S, ease: "easeOut" }}
      ref={(el) => {
        registerItem(lap.key, el);
      }}
      className={cn(
        "relative",
        layout === "side" ? "" : "min-w-[220px] flex-1",
        dragging && "z-20 opacity-70",
      )}
    >
      <button
        type="button"
        onPointerDown={(e) => {
          e.preventDefault();
          onDragStart(lap.key, e.clientX, e.clientY);
        }}
        onKeyDown={(e) => {
          if (e.key !== back && e.key !== forward) return;
          e.preventDefault();
          onMove(lap.key, e.key === forward ? 1 : -1);
        }}
        aria-label={`Reorder ${lap.driver} lap ${lap.lap}. Use ${back === "ArrowUp" ? "up and down" : "left and right"} arrow keys to move it.`}
        className="absolute top-1 left-0.5 z-10 flex size-5 touch-none items-center justify-center text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent-green cursor-grab active:cursor-grabbing"
      >
        <GripVertical className="size-4" aria-hidden="true" />
      </button>
      <LapStatCard
        lap={lap}
        referenceLap={referenceLap}
        color={color}
        active={active}
        pinned={pinned}
        onHover={onHover}
        onToggle={onToggle}
        playback={playback}
        sectorBests={sectorBests}
        hoveredSector={hoveredSector}
        onHoverSector={onHoverSector}
        showAbsolute={showAbsolute}
      />
    </motion.li>
  );
}

function LapStatCard({
  lap,
  referenceLap,
  color,
  active,
  pinned,
  onHover,
  onToggle,
  playback,
  sectorBests,
  hoveredSector,
  onHoverSector,
  showAbsolute,
}: {
  lap: ReplayLap;
  referenceLap: ReplayLap | null;
  color: string;
  active: boolean;
  pinned: boolean;
  onHover: (key: string | null) => void;
  onToggle: (key: string) => void;
  playback: PlaybackApi;
  sectorBests: SectorBests;
  hoveredSector: number | null;
  onHoverSector: (sector: number | null) => void;
  showAbsolute: boolean;
}) {
  const isReference = referenceLap !== null && lap.key === referenceLap.key;
  const deltaRef = useRef<HTMLSpanElement | null>(null);
  const speedRef = useRef<HTMLSpanElement | null>(null);
  const gearRef = useRef<HTMLSpanElement | null>(null);
  const throttleRef = useRef<HTMLSpanElement | null>(null);
  const throttleTextRef = useRef<HTMLSpanElement | null>(null);
  const brakeRef = useRef<HTMLSpanElement | null>(null);
  const brakeTextRef = useRef<HTMLSpanElement | null>(null);
  const rpmRef = useRef<HTMLSpanElement | null>(null);
  const sectorRefs = useRef<(HTMLSpanElement | null)[]>([null, null, null]);
  const rankRefs = useRef<(HTMLSpanElement | null)[]>([null, null, null]);

  const { rankFor, segmentFor } = sectorBests;
  const { subscribe } = playback;
  const segment = segmentLabel(lap, segmentFor);

  const sectorCells = useMemo(
    () => buildSectorCells(lap, referenceLap, rankFor),
    [lap, referenceLap, rankFor],
  );

  useEffect(() => {
    let revealed = -1;
    const unsub = subscribe((t) => {
      const s = sampleLapAt(lap, t);
      if (speedRef.current) {
        speedRef.current.textContent = `${Math.round(s.speed)}`;
      }
      if (gearRef.current) {
        gearRef.current.textContent = `${s.gear}`;
      }
      if (throttleRef.current) {
        throttleRef.current.style.width = `${Math.max(0, Math.min(100, s.throttle))}%`;
      }
      if (throttleTextRef.current) {
        throttleTextRef.current.textContent = `${Math.round(s.throttle)}%`;
      }
      if (brakeRef.current) {
        brakeRef.current.style.width = s.brake ? "100%" : "0%";
      }
      if (brakeTextRef.current) {
        brakeTextRef.current.textContent = s.brake ? "ON" : "off";
      }
      if (rpmRef.current) {
        rpmRef.current.textContent = Math.round(s.rpm).toLocaleString();
      }
      if (deltaRef.current && referenceLap && !isReference) {
        const d = deltaToReference(lap, referenceLap, t);
        const behind = d >= 0;
        deltaRef.current.textContent = `${behind ? "+" : "−"}${Math.abs(d).toFixed(3)}s`;
        deltaRef.current.style.color = behind
          ? "var(--accent-red-hover)"
          : "var(--accent-green)";
      }
      let mask = 0;
      for (let i = 0; i < 3; i++) {
        const at = sectorCells[i]!.at;
        if (at !== null && t >= at) mask |= 1 << i;
      }
      if (mask !== revealed) {
        revealed = mask;
        for (let i = 0; i < 3; i++) {
          const cell = sectorCells[i]!;
          const shown = (mask & (1 << i)) !== 0;
          const tagEl = rankRefs.current[i];
          if (tagEl) tagEl.textContent = shown ? cell.tag : "";
          const el = sectorRefs.current[i];
          if (!el) continue;
          const absolute = showAbsolute || hoveredSector === i;
          const color = absolute ? cell.absColor : cell.color;
          el.textContent = shown ? (absolute ? cell.absText : cell.text) : "—";
          el.style.color = shown && color ? color : "";
          el.style.backgroundColor = shown && cell.fill ? cell.fill : "";
        }
      }
    });
    return unsub;
  }, [
    lap,
    referenceLap,
    isReference,
    subscribe,
    sectorCells,
    hoveredSector,
    showAbsolute,
  ]);

  const speedGear = (
    <span className="flex items-baseline justify-between gap-2 border-b border-surface-border pb-1.5">
      <span className="flex items-baseline gap-0.5 font-mono tabular-nums">
        <span ref={speedRef} className="text-lg font-bold text-text-primary">
          —
        </span>
        <span className="text-[12px] tracking-widest text-text-muted">km/h</span>
      </span>
      <span className="flex items-baseline gap-1 font-mono tabular-nums">
        <span className="text-[12px] tracking-[0.15em] uppercase text-text-muted">
          Gear
        </span>
        <span ref={gearRef} className="text-base font-bold text-text-primary">
          —
        </span>
      </span>
    </span>
  );

  const sectors = (
    <SectorRow
      refs={sectorRefs}
      rankRefs={rankRefs}
      hoveredSector={hoveredSector}
      onHoverSector={onHoverSector}
      showAbsolute={showAbsolute}
    />
  );

  const bars = (
    <>
      <BarRow
        label="Thr"
        barRef={throttleRef}
        textRef={throttleTextRef}
        barClass="bg-accent-green"
        initialText="0%"
      />
      <BarRow
        label="Brk"
        barRef={brakeRef}
        textRef={brakeTextRef}
        barClass="bg-accent-red"
        initialText="off"
        trailing={
          <span className="flex shrink-0 items-baseline gap-1 border-l border-surface-border pl-2">
            <span
              ref={rpmRef}
              className="text-[14px] font-semibold tabular-nums text-text-primary"
            >
              —
            </span>
            <span className="text-[12px] tracking-[0.15em] uppercase text-text-muted">
              Rpm
            </span>
          </span>
        }
      />
    </>
  );

  return (
    <button
      type="button"
      onMouseEnter={() => onHover(lap.key)}
      onFocus={() => onHover(lap.key)}
      onMouseLeave={() => onHover(null)}
      onBlur={() => onHover(null)}
      onClick={() => onToggle(lap.key)}
      aria-pressed={pinned}
      aria-label={`${pinned ? "Unpin" : "Pin"} ${lap.driver}, lap ${lap.lap}${
        segment ? `, ${segment}` : ""
      }`}
      className={cn(
        "flex flex-col gap-1.5 border px-2 py-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-accent-green cursor-pointer",
        "w-full",
        active
          ? "bg-surface-card-hover"
          : "bg-surface-card hover:bg-surface-card-hover",
      )}
      style={{
        borderColor: active
          ? color
          : `color-mix(in oklch, ${color} 40%, var(--surface-border))`,
      }}
    >
      <span className="flex items-center gap-1.5 pl-3.5">
        <span
          aria-hidden="true"
          className="inline-block size-2.5 shrink-0"
          style={{ backgroundColor: color }}
        />
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] font-semibold tracking-widest uppercase text-text-primary">
          {lap.driver}
          <span className="ml-1 text-text-muted">L{lap.lap}</span>
        </span>
        {segment && (
          <span
            aria-hidden="true"
            className="shrink-0 border border-surface-border px-1 py-px font-mono text-[10px] font-semibold tracking-[0.1em] text-text-secondary"
          >
            {segment}
          </span>
        )}
        {lap.compound && (
          <span
            role="img"
            aria-label={`${lap.compound.toLowerCase()} tyre`}
            className="flex shrink-0 items-center"
          >
            <TyreBadge
              compound={lap.compound.toUpperCase() as Compound}
              size={20}
              year={lap.year}
            />
          </span>
        )}
        {pinned && (
          <Pin
            aria-hidden="true"
            className="size-3 shrink-0 fill-current text-text-primary"
          />
        )}
      </span>

      {speedGear}
      <span className="flex items-center justify-between gap-2 font-mono text-[12px] tracking-[0.15em] uppercase">
        <span className="text-text-muted">
          {isReference ? "Reference" : "Delta"}
        </span>
        <span
          ref={isReference ? undefined : deltaRef}
          className="text-[14px] font-bold tabular-nums tracking-normal text-text-secondary"
        >
          {isReference ? "Fastest" : "—"}
        </span>
      </span>
      {sectors}
      {bars}
    </button>
  );
}

function SectorRow({
  refs,
  rankRefs,
  hoveredSector,
  onHoverSector,
  showAbsolute,
}: {
  refs: React.RefObject<(HTMLSpanElement | null)[]>;
  rankRefs: React.RefObject<(HTMLSpanElement | null)[]>;
  hoveredSector: number | null;
  onHoverSector: (sector: number | null) => void;
  showAbsolute: boolean;
}) {
  return (
    <span className="grid grid-cols-3 gap-1 border-b border-surface-border pb-1.5 font-mono">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          onMouseEnter={() => onHoverSector(i)}
          onMouseLeave={() => onHoverSector(null)}
          className="flex flex-col gap-0.5"
        >
          <span
            className={cn(
              "flex items-baseline justify-between gap-1 text-[12px] tracking-[0.15em] uppercase transition-colors",
              showAbsolute || hoveredSector === i
                ? "text-text-secondary"
                : "text-text-muted",
            )}
          >
            S{i + 1}
            <span
              ref={(el) => {
                rankRefs.current[i] = el;
              }}
              className="font-bold tracking-normal text-text-secondary"
            />
          </span>
          <span
            ref={(el) => {
              refs.current[i] = el;
            }}
            className="rounded-[2px] px-1 py-0.5 text-center text-[14px] font-bold tabular-nums text-text-muted transition-colors"
          >
            —
          </span>
        </span>
      ))}
    </span>
  );
}

function BarRow({
  label,
  barRef,
  textRef,
  barClass,
  initialText,
  trailing,
}: {
  label: string;
  barRef: React.RefObject<HTMLSpanElement | null>;
  textRef: React.RefObject<HTMLSpanElement | null>;
  barClass: string;
  initialText: string;
  trailing?: React.ReactNode;
}) {
  return (
    <span className="flex items-center gap-2 font-mono">
      <span className="w-9 shrink-0 text-[12px] tracking-[0.15em] uppercase text-text-muted">
        {label}
      </span>
      <span className="relative block h-1.5 min-w-0 flex-1 bg-surface-input">
        <span
          ref={barRef}
          className={cn(
            "absolute inset-y-0 left-0 transition-[width] duration-100",
            barClass,
          )}
          style={{ width: "0%" }}
        />
      </span>
      <span
        ref={textRef}
        className={cn(
          "shrink-0 text-right text-[14px] tabular-nums text-text-secondary",
          trailing ? "w-9" : "w-11",
        )}
      >
        {initialText}
      </span>
      {trailing}
    </span>
  );
}

function Announcer({
  lap,
  referenceLap,
  playback,
  sectorBests,
}: {
  lap: ReplayLap;
  referenceLap: ReplayLap;
  playback: PlaybackApi;
  sectorBests: SectorBests;
}) {
  const liveRef = useRef<HTMLDivElement | null>(null);
  const sectorRef = useRef<HTMLDivElement | null>(null);
  const revealedRef = useRef(-1);

  const { rankFor, segmentFor } = sectorBests;
  const { subscribe, playing } = playback;
  const segment = segmentLabel(lap, segmentFor);
  const sectorCells = useMemo(
    () => buildSectorCells(lap, referenceLap, rankFor),
    [lap, referenceLap, rankFor],
  );

  useEffect(() => {
    revealedRef.current = -1;
  }, [lap.key, sectorCells]);

  useEffect(() => {
    let lastGear = -1;
    const unsub = subscribe((t) => {
      let mask = 0;
      for (let i = 0; i < 3; i++) {
        const at = sectorCells[i]!.at;
        if (at !== null && t >= at) mask |= 1 << i;
      }
      if (mask !== revealedRef.current) {
        const known = revealedRef.current;
        revealedRef.current = mask;
        const added: number[] = [];
        for (let i = 0; i < 3; i++) {
          if ((mask & (1 << i)) !== 0 && (known & (1 << i)) === 0)
            added.push(i);
        }
        if (known >= 0 && added.length === 1 && sectorRef.current) {
          const i = added[0]!;
          const cell = sectorCells[i]!;
          const parts = [`Sector ${i + 1}`, cell.absText];
          if (cell.delta !== null) {
            parts.push(
              `${cell.delta >= 0 ? "plus" : "minus"} ${Math.abs(cell.delta).toFixed(3)} to reference`,
            );
          }
          if (cell.rank === "best") {
            parts.push(segment ? `${segment} best` : RANK_SPEECH.best);
          } else if (cell.rank === "personal") {
            parts.push(
              segment
                ? `${RANK_SPEECH.personal} in ${segment}`
                : RANK_SPEECH.personal,
            );
          }
          sectorRef.current.textContent = `${lap.driver}, ${parts.join(", ")}`;
        }
      }

      const s = sampleLapAt(lap, t);
      if (!liveRef.current || playing || s.gear === lastGear) return;
      lastGear = s.gear;
      const d = deltaToReference(lap, referenceLap, t);
      const gap =
        lap.key === referenceLap.key
          ? "reference lap"
          : `${Math.abs(d).toFixed(3)} seconds ${d >= 0 ? "behind" : "ahead of"} reference`;
      liveRef.current.textContent = `${lap.driver} lap ${lap.lap}, ${Math.round(s.speed)} kilometers per hour, gear ${s.gear}, throttle ${Math.round(s.throttle)} percent, brake ${s.brake ? "on" : "off"}, ${gap}`;
    });
    return unsub;
  }, [lap, referenceLap, subscribe, playing, sectorCells, segment]);

  return (
    <>
      <div
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        ref={liveRef}
      />
      <div
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        ref={sectorRef}
      />
    </>
  );
}
