"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import { Locate, LocateFixed } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CircuitInfo } from "@/lib/types";
import type { ReplayData, ReplayLap } from "@/lib/replay/prepare";
import { buildTransform, outlinePath } from "@/lib/replay/transform";
import type { CornerMark } from "@/lib/replay/corners";
import { sampleLapAt, sampleTrailPositions } from "@/lib/replay/sample";
import { readFollowZoom, writeFollowZoom } from "@/lib/replay/followZoom";
import type { Loop, PlaybackApi } from "./useReplayPlayback";

const TRIANGLE_POINTS = "0,-11 9,7 0,3 -9,7";
const TRAIL_SECONDS = 1.0;
const TRAIL_POINTS = 24;
const MIN_SCALE = 1;
const MAX_SCALE = 6;
const MIN_FOLLOW_SCALE = 1.5;
const FOLLOW_TAU_MS = 140;
const FOLLOW_JUMP = 6;
const CORNER_LABEL_OFFSET = 24;
const HINT_RESERVE = 56;
const TIGHT_HEIGHT = 180;
const ROOMY_HEIGHT = 320;
const MIN_PADDING = 8;
const MAX_PADDING = 28;
const DENSITY_REFERENCE = 420;
const MIN_DENSITY = 0.72;
const SECTOR_LABEL_OFFSET = 22;
const LABEL_CHAR_RATIO = 0.62;
const LABEL_LINE_RATIO = 1.15;
const LABEL_PAD = 2;
const DELTA_GUTTER = 20;
const FINISH_CELL = 5;
const FINISH_DEPTH = 2.5;
const FINISH_ROWS = 2;
const FINISH_COLS = 4;

type Rect = [number, number, number, number];

function labelRect(
  x: number,
  y: number,
  nx: number,
  font: number,
  chars: number,
): Rect {
  const w = chars * font * LABEL_CHAR_RATIO;
  const h = font * LABEL_LINE_RATIO;
  const x0 = nx > 0.5 ? x : nx < -0.5 ? x - w : x - w / 2;
  return [
    x0 - LABEL_PAD,
    y - h / 2 - LABEL_PAD,
    x0 + w + LABEL_PAD,
    y + h / 2 + LABEL_PAD,
  ];
}

function rectsOverlap(a: Rect, b: Rect) {
  return !(a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]);
}

type Props = {
  replay: ReplayData;
  circuit: CircuitInfo | null | undefined;
  corners: CornerMark[] | null;
  loopPreview: Loop | null;
  colorFor: (key: string) => string;
  playback: PlaybackApi;
  hoveredKey: string | null;
  onHoverKey: (key: string | null) => void;
  pinnedKey: string | null;
  ariaSummary: string;
  onAspect?: (aspect: number) => void;
};

type ViewTransform = { tx: number; ty: number; scale: number };

export default function ReplayTrack({
  replay,
  circuit,
  corners,
  loopPreview,
  colorFor,
  playback,
  hoveredKey,
  onHoverKey,
  pinnedKey,
  ariaSummary,
  onAspect,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<ViewTransform>({
    tx: 0,
    ty: 0,
    scale: 1,
  });
  const [follow, setFollow] = useState(false);
  const [hoveredCorner, setHoveredCorner] = useState<string | null>(null);

  const sizeRef = useRef({ width: 0, height: 0 });
  const zoomGroupRef = useRef<SVGGElement | null>(null);
  const viewRef = useRef(view);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry?.contentRect;
      if (!r) return;
      sizeRef.current = { width: r.width, height: r.height };
      setSize({ width: r.width, height: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const clampView = useCallback(
    (v: ViewTransform, following = false): ViewTransform => {
      const { width, height } = sizeRef.current;
      const scale = Math.max(
        following ? MIN_FOLLOW_SCALE : MIN_SCALE,
        Math.min(MAX_SCALE, v.scale),
      );
      if (following) {
        return {
          scale,
          tx: Math.min(width / 2, Math.max(width / 2 - width * scale, v.tx)),
          ty: Math.min(height / 2, Math.max(height / 2 - height * scale, v.ty)),
        };
      }
      const maxTx = width * (scale - 1);
      const maxTy = height * (scale - 1);
      return {
        scale,
        tx: Math.min(0, Math.max(-maxTx, v.tx)),
        ty: Math.min(0, Math.max(-maxTy, v.ty)),
      };
    },
    [],
  );

  const referenceLap = useMemo(
    () => replay.laps.find((l) => l.key === replay.referenceKey) ?? null,
    [replay],
  );

  const roominess = Math.max(
    0,
    Math.min(1, (size.height - TIGHT_HEIGHT) / (ROOMY_HEIGHT - TIGHT_HEIGHT)),
  );

  const transform = useMemo(() => {
    if (size.width === 0 || size.height === 0 || !referenceLap) return null;
    return buildTransform(
      { x: referenceLap.x, y: referenceLap.y },
      circuit?.rotation ?? 0,
      {
        width: size.width,
        height: Math.max(1, size.height - HINT_RESERVE * roominess),
        padding: MIN_PADDING + (MAX_PADDING - MIN_PADDING) * roominess,
      },
    );
  }, [referenceLap, circuit, size, roominess]);

  const drawnAspect = transform
    ? Math.round((transform.extent.width / transform.extent.height) * 1000) /
      1000
    : null;

  useEffect(() => {
    if (drawnAspect !== null && Number.isFinite(drawnAspect) && drawnAspect > 0)
      onAspect?.(drawnAspect);
  }, [drawnAspect, onAspect]);

  const density = useMemo(() => {
    if (!transform) return 1;
    const { width, height } = transform.extent;
    const drawn = Math.max(width, height);
    if (drawn === 0) return 1;
    return Math.max(MIN_DENSITY, Math.min(1, drawn / DENSITY_REFERENCE));
  }, [transform]);

  const outlineD = useMemo(() => {
    if (!transform || !referenceLap) return "";
    return outlinePath(referenceLap, transform.toScreen);
  }, [transform, referenceLap]);

  const cornerNodes = useMemo(() => {
    if (!transform || !corners) return null;
    return corners.map((c) => {
      const [sx, sy] = transform.toScreen(c.x, c.y);
      const a = (c.angle * Math.PI) / 180;
      const [ax, ay] = transform.toScreen(c.x + Math.cos(a), c.y + Math.sin(a));
      const len = Math.hypot(ax - sx, ay - sy) || 1;
      return {
        id: c.id,
        x: sx,
        y: sy,
        nx: (ax - sx) / len,
        ny: (ay - sy) / len,
        label: c.label,
        time: c.time,
      };
    });
  }, [transform, corners]);

  const sectorLines = useMemo(() => {
    if (!transform || !referenceLap) return null;
    const [s1, s2] = referenceLap.sectors;
    if (s1 === null || s2 === null) return null;
    return [s1, s1 + s2].map((t, i) => {
      const s = sampleLapAt(referenceLap, t);
      const [sx, sy] = transform.toScreen(s.x, s.y);
      const rad = (transform.rotate(s.heading) * Math.PI) / 180;
      return {
        id: `sector-${i}`,
        label: `S${i + 2}`,
        x: sx,
        y: sy,
        dx: Math.cos(rad),
        dy: Math.sin(rad),
        time: t,
      };
    });
  }, [transform, referenceLap]);

  const visibleCornerIds = useMemo(() => {
    if (!cornerNodes) return null;
    const unit = 1 / view.scale;
    const font = 12 * density * unit;
    const offset = CORNER_LABEL_OFFSET * density * unit;
    const sectorOffset = SECTOR_LABEL_OFFSET * density * unit;
    const placed: Rect[] = sectorLines
      ? sectorLines.map((s) =>
          labelRect(
            s.x + s.dx * sectorOffset,
            s.y + s.dy * sectorOffset,
            0,
            font,
            s.label.length,
          ),
        )
      : [];
    const visible = new Set<string>();
    for (const c of cornerNodes) {
      const rect = labelRect(
        c.x + c.nx * offset,
        c.y + c.ny * offset,
        c.nx,
        font,
        c.label.length,
      );
      if (placed.some((p) => rectsOverlap(rect, p))) continue;
      placed.push(rect);
      visible.add(c.id);
    }
    return visible;
  }, [cornerNodes, sectorLines, view.scale, density]);

  const markedLoop = loopPreview ?? playback.loop;

  const lapRefs = useRef<
    Map<
      string,
      {
        triangle: SVGGElement | null;
        trail: SVGPolylineElement | null;
        delta: SVGTextElement | null;
      }
    >
  >(new Map());

  const registerLap = useCallback(
    (
      key: string,
      slot: "triangle" | "trail" | "delta",
      node: SVGGElement | SVGPolylineElement | SVGTextElement | null,
    ) => {
      let entry = lapRefs.current.get(key);
      if (!entry) {
        entry = { triangle: null, trail: null, delta: null };
        lapRefs.current.set(key, entry);
      }
      // deliberate cast: each slot only receives its own node type
      (entry as unknown as Record<string, unknown>)[slot] = node;
    },
    [],
  );

  const trianglePositionsRef = useRef<
    Map<string, { x: number; y: number; heading: number }>
  >(new Map());

  const referenceLapRef = useRef(referenceLap);
  useEffect(() => {
    referenceLapRef.current = referenceLap;
  }, [referenceLap]);

  const finishRank = useMemo(() => {
    const ordered = [...replay.laps].sort(
      (a, b) => a.finishTime - b.finishTime,
    );
    return new Map(ordered.map((l, i) => [l.key, i]));
  }, [replay]);

  const followTargetRef = useRef<{ x: number; y: number } | null>(null);
  const followOffsetRef = useRef({ x: 0, y: 0 });
  const followStampRef = useRef(0);
  const easeRafRef = useRef<number | null>(null);

  const resetFollowEasing = useCallback(() => {
    if (easeRafRef.current !== null) cancelAnimationFrame(easeRafRef.current);
    easeRafRef.current = null;
    followTargetRef.current = null;
    followOffsetRef.current = { x: 0, y: 0 };
    followStampRef.current = 0;
  }, []);

  const followTransform = useCallback(
    (scale: number): ViewTransform | null => {
      let sumX = 0;
      let sumY = 0;
      let n = 0;
      let pinned: { x: number; y: number } | null = null;
      for (const lap of replay.laps) {
        const p = trianglePositionsRef.current.get(lap.key);
        if (!p) continue;
        sumX += p.x;
        sumY += p.y;
        n++;
        if (lap.key === pinnedKey) pinned = p;
      }
      if (n === 0) return null;
      const cx = pinned ? pinned.x : sumX / n;
      const cy = pinned ? pinned.y : sumY / n;

      const offset = followOffsetRef.current;
      const now = performance.now();
      const elapsed = followStampRef.current
        ? Math.min(100, now - followStampRef.current)
        : 0;
      followStampRef.current = now;
      const decay = Math.exp(-elapsed / FOLLOW_TAU_MS);
      offset.x *= decay;
      offset.y *= decay;

      const previous = followTargetRef.current;
      if (
        previous &&
        Math.hypot(cx - previous.x, cy - previous.y) > FOLLOW_JUMP
      ) {
        offset.x += previous.x - cx;
        offset.y += previous.y - cy;
      }
      followTargetRef.current = { x: cx, y: cy };

      return clampView(
        {
          scale,
          tx: sizeRef.current.width / 2 - (cx + offset.x) * scale,
          ty: sizeRef.current.height / 2 - (cy + offset.y) * scale,
        },
        true,
      );
    },
    [replay.laps, pinnedKey, clampView],
  );

  const applyView = useCallback((v: ViewTransform) => {
    viewRef.current = v;
    zoomGroupRef.current?.setAttribute(
      "transform",
      `translate(${v.tx.toFixed(2)} ${v.ty.toFixed(2)}) scale(${v.scale})`,
    );
  }, []);

  const pumpFollow = useCallback(() => {
    if (easeRafRef.current !== null) return;
    const step = () => {
      easeRafRef.current = null;
      const next = followTransform(viewRef.current.scale);
      if (next) applyView(next);
      const { x, y } = followOffsetRef.current;
      if (Math.hypot(x, y) > 0.05) {
        easeRafRef.current = requestAnimationFrame(step);
      }
    };
    easeRafRef.current = requestAnimationFrame(step);
  }, [followTransform, applyView]);

  const renderFrame = useCallback(
    (t: number, wrapped?: boolean) => {
      if (!transform) return;
      if (wrapped) resetFollowEasing();
      const scale = view.scale;
      const count = replay.laps.length;
      for (const lap of replay.laps) {
        const s = sampleLapAt(lap, t);
        const [sx, sy] = transform.toScreen(s.x, s.y);
        const angle = transform.rotate(s.heading);
        trianglePositionsRef.current.set(lap.key, {
          x: sx,
          y: sy,
          heading: angle,
        });
        const nodes = lapRefs.current.get(lap.key);
        if (nodes?.triangle) {
          nodes.triangle.setAttribute(
            "transform",
            `translate(${sx.toFixed(2)} ${sy.toFixed(2)}) rotate(${angle.toFixed(1)})`,
          );
        }
        if (nodes?.trail) {
          const trailPts = sampleTrailPositions(
            lap,
            Math.min(t, lap.finishTime),
            TRAIL_SECONDS,
            TRAIL_POINTS,
          );
          const points = trailPts
            .map((p) => {
              const [tx, ty] = transform.toScreen(p.x, p.y);
              return `${tx.toFixed(1)},${ty.toFixed(1)}`;
            })
            .join(" ");
          nodes.trail.setAttribute("points", points);
        }
        if (nodes?.delta) {
          const ref = referenceLapRef.current;
          if (s.finished && ref) {
            const deltaMs = (lap.finishTime - ref.finishTime) * 1000;
            const label =
              lap.key === ref.key
                ? "LEADER"
                : `+${(deltaMs / 1000).toFixed(3)}s`;
            const rank = finishRank.get(lap.key) ?? 0;
            const row = (rank - (count - 1) / 2) * ((16 * density) / scale);
            const gutter = (DELTA_GUTTER * density) / scale;
            const textWidth =
              label.length * density * (13 * LABEL_CHAR_RATIO + 1);
            const screenX = sx * scale + viewRef.current.tx;
            const flip =
              screenX + gutter * scale + textWidth > sizeRef.current.width;
            nodes.delta.textContent = label;
            nodes.delta.setAttribute("text-anchor", flip ? "end" : "start");
            nodes.delta.setAttribute(
              "x",
              (flip ? sx - gutter : sx + gutter).toFixed(1),
            );
            nodes.delta.setAttribute("y", (sy + row).toFixed(1));
            nodes.delta.setAttribute("opacity", "1");
          } else {
            nodes.delta.setAttribute("opacity", "0");
          }
        }
      }

      if (follow) {
        const next = followTransform(scale);
        if (next) applyView(next);
        const { x, y } = followOffsetRef.current;
        if (Math.hypot(x, y) > 0.05) pumpFollow();
      }
    },
    [
      replay,
      transform,
      finishRank,
      view.scale,
      density,
      follow,
      followTransform,
      applyView,
      pumpFollow,
      resetFollowEasing,
    ],
  );

  useEffect(() => {
    if (!transform) return;
    renderFrame(playback.getTime());
    return playback.subscribe(renderFrame);
  }, [playback, transform, renderFrame]);

  useLayoutEffect(() => {
    if (!follow) {
      applyView(view);
      return;
    }
    applyView(
      followTransform(view.scale) ?? {
        ...viewRef.current,
        scale: view.scale,
      },
    );
    const { x, y } = followOffsetRef.current;
    if (Math.hypot(x, y) > 0.05) pumpFollow();
  }, [follow, view, applyView, followTransform, pumpFollow]);

  const draggingRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startTx: number;
    startTy: number;
  } | null>(null);
  const pinchRef = useRef<{
    ids: [number, number];
    startDist: number;
    startScale: number;
    startMid: { x: number; y: number };
    startView: ViewTransform;
  } | null>(null);
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(
    new Map(),
  );

  const zoomBy = useCallback(
    (factor: number, focalX: number, focalY: number) => {
      setView((prev) => {
        const scale = Math.max(
          follow ? MIN_FOLLOW_SCALE : MIN_SCALE,
          Math.min(MAX_SCALE, prev.scale * factor),
        );
        const ratio = scale / prev.scale;
        return clampView(
          {
            scale,
            tx: focalX - (focalX - prev.tx) * ratio,
            ty: focalY - (focalY - prev.ty) * ratio,
          },
          follow,
        );
      });
    },
    [clampView, follow],
  );

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      zoomBy(
        Math.exp(-e.deltaY * 0.0015),
        e.clientX - rect.left,
        e.clientY - rect.top,
      );
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [zoomBy, size.width]);

  const findTriangleUnderPointer = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current;
      if (!svg) return null;
      const rect = svg.getBoundingClientRect();
      const v = viewRef.current;
      const px = (clientX - rect.left - v.tx) / v.scale;
      const py = (clientY - rect.top - v.ty) / v.scale;
      const HIT_RADIUS = 22 / v.scale;
      let closest: { key: string; dist: number } | null = null;
      for (const [key, pos] of trianglePositionsRef.current) {
        const dx = pos.x - px;
        const dy = pos.y - py;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < HIT_RADIUS && (!closest || dist < closest.dist)) {
          closest = { key, dist };
        }
      }
      return closest?.key ?? null;
    },
    [],
  );

  const findCornerUnderPointer = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current;
      if (!svg || !cornerNodes) return null;
      const rect = svg.getBoundingClientRect();
      const v = viewRef.current;
      const px = (clientX - rect.left - v.tx) / v.scale;
      const py = (clientY - rect.top - v.ty) / v.scale;
      const hitRadius = 13 / v.scale;
      const offset = (CORNER_LABEL_OFFSET * density) / v.scale;
      let closest: {
        corner: (typeof cornerNodes)[number];
        dist: number;
      } | null = null;
      for (const corner of cornerNodes) {
        const dist = Math.min(
          Math.hypot(corner.x - px, corner.y - py),
          Math.hypot(
            corner.x + corner.nx * offset - px,
            corner.y + corner.ny * offset - py,
          ),
        );
        if (dist < hitRadius && (!closest || dist < closest.dist)) {
          closest = { corner, dist };
        }
      }
      return closest?.corner ?? null;
    },
    [cornerNodes, density],
  );

  const tapRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    time: number;
  } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg) return;
      activePointersRef.current.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
      });
      if (activePointersRef.current.size === 2) {
        const ids = Array.from(activePointersRef.current.keys()) as [
          number,
          number,
        ];
        const p1 = activePointersRef.current.get(ids[0])!;
        const p2 = activePointersRef.current.get(ids[1])!;
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const rect = svg.getBoundingClientRect();
        pinchRef.current = {
          ids,
          startDist: Math.sqrt(dx * dx + dy * dy),
          startScale: viewRef.current.scale,
          startMid: {
            x: (p1.x + p2.x) / 2 - rect.left,
            y: (p1.y + p2.y) / 2 - rect.top,
          },
          startView: viewRef.current,
        };
        draggingRef.current = null;
        tapRef.current = null;
        return;
      }
      const corner = findCornerUnderPointer(e.clientX, e.clientY);
      tapRef.current = corner
        ? {
            pointerId: e.pointerId,
            x: e.clientX,
            y: e.clientY,
            time: corner.time,
          }
        : null;
      svg.setPointerCapture(e.pointerId);
      draggingRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startTx: viewRef.current.tx,
        startTy: viewRef.current.ty,
      };
    },
    [findCornerUnderPointer],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const existing = activePointersRef.current.get(e.pointerId);
      if (existing) {
        existing.x = e.clientX;
        existing.y = e.clientY;
      }
      if (pinchRef.current) {
        const svg = svgRef.current;
        if (!svg) return;
        const p1 = activePointersRef.current.get(pinchRef.current.ids[0]);
        const p2 = activePointersRef.current.get(pinchRef.current.ids[1]);
        if (!p1 || !p2) return;
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const rect = svg.getBoundingClientRect();
        const midX = (p1.x + p2.x) / 2 - rect.left;
        const midY = (p1.y + p2.y) / 2 - rect.top;
        const nextScale =
          pinchRef.current.startScale *
          (dist / Math.max(1, pinchRef.current.startDist));
        setView((prev) => {
          const clampedScale = Math.max(
            follow ? MIN_FOLLOW_SCALE : MIN_SCALE,
            Math.min(MAX_SCALE, nextScale),
          );
          const ratio = clampedScale / prev.scale;
          return clampView(
            {
              scale: clampedScale,
              tx: midX - (midX - prev.tx) * ratio,
              ty: midY - (midY - prev.ty) * ratio,
            },
            follow,
          );
        });
        return;
      }
      const drag = draggingRef.current;
      if (drag && drag.pointerId === e.pointerId) {
        const nextTx = drag.startTx + (e.clientX - drag.startX);
        const nextTy = drag.startTy + (e.clientY - drag.startY);
        if (follow) setFollow(false);
        setView((prev) =>
          clampView({ tx: nextTx, ty: nextTy, scale: prev.scale }),
        );
        return;
      }
      const hit = findTriangleUnderPointer(e.clientX, e.clientY);
      if (hit !== hoveredKey) onHoverKey(hit);
      const corner = findCornerUnderPointer(e.clientX, e.clientY);
      setHoveredCorner(corner?.id ?? null);
    },
    [
      clampView,
      findCornerUnderPointer,
      findTriangleUnderPointer,
      follow,
      hoveredKey,
      onHoverKey,
    ],
  );

  const releasePointer = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    activePointersRef.current.delete(e.pointerId);
    const svg = svgRef.current;
    if (svg?.hasPointerCapture(e.pointerId)) {
      svg.releasePointerCapture(e.pointerId);
    }
    if (draggingRef.current && draggingRef.current.pointerId === e.pointerId) {
      draggingRef.current = null;
    }
    if (
      pinchRef.current &&
      (pinchRef.current.ids[0] === e.pointerId ||
        pinchRef.current.ids[1] === e.pointerId)
    ) {
      pinchRef.current = null;
    }
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const tap = tapRef.current;
      tapRef.current = null;
      if (tap && tap.pointerId === e.pointerId) {
        const moved = Math.hypot(e.clientX - tap.x, e.clientY - tap.y);
        if (moved < 6) playback.seek(tap.time);
      }
      releasePointer(e);
    },
    [playback, releasePointer],
  );

  const resetView = useCallback(() => {
    setFollow(false);
    setView({ tx: 0, ty: 0, scale: 1 });
  }, []);

  const toggleFollow = useCallback(() => {
    if (follow) {
      setView(clampView(viewRef.current));
      setFollow(false);
      return;
    }
    setView((v) =>
      clampView({ ...v, scale: Math.max(v.scale, readFollowZoom()) }, true),
    );
    setFollow(true);
  }, [clampView, follow]);

  useEffect(() => {
    if (!follow) return;
    return () => {
      writeFollowZoom(viewRef.current.scale);
      resetFollowEasing();
    };
  }, [follow, resetFollowEasing]);
  const zoomed =
    Math.abs(view.scale - 1) > 0.01 ||
    Math.abs(view.tx) > 0.5 ||
    Math.abs(view.ty) > 0.5;

  return (
    <div
      ref={containerRef}
      className="relative isolate size-full overflow-hidden"
    >
      {size.width > 0 && (
        <svg
          ref={svgRef}
          role="img"
          aria-label={ariaSummary}
          width={size.width}
          height={size.height}
          viewBox={`0 0 ${size.width} ${size.height}`}
          className="block size-full touch-none [contain:strict]"
          style={{ cursor: hoveredCorner ? "pointer" : undefined }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={releasePointer}
          onPointerLeave={(e) => {
            releasePointer(e);
            onHoverKey(null);
            setHoveredCorner(null);
          }}
        >
          <defs>
            <radialGradient id="track-vignette" cx="50%" cy="50%" r="65%">
              <stop
                offset="60%"
                stopColor="oklch(14.48% 0 0)"
                stopOpacity="0"
              />
              <stop
                offset="100%"
                stopColor="oklch(14.48% 0 0)"
                stopOpacity="0.65"
              />
            </radialGradient>
            <pattern
              id="grid"
              x="0"
              y="0"
              width="48"
              height="48"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 48 0 L 0 0 0 48"
                fill="none"
                stroke="oklch(28.5% 0 0)"
                strokeWidth="0.5"
                opacity="0.35"
              />
            </pattern>
          </defs>

          <rect width={size.width} height={size.height} fill="url(#grid)" />
          <rect
            width={size.width}
            height={size.height}
            fill="url(#track-vignette)"
          />

          <g
            ref={zoomGroupRef}
            transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}
          >
            {outlineD && (
              <>
                <path
                  d={outlineD}
                  fill="none"
                  stroke="oklch(28.5% 0 0)"
                  strokeWidth={(23 * density) / view.scale}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                <path
                  d={outlineD}
                  fill="none"
                  stroke="oklch(38% 0 0)"
                  strokeWidth={(16 * density) / view.scale}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                <path
                  d={outlineD}
                  fill="none"
                  stroke="oklch(74.9% 0 0)"
                  strokeWidth={1 / view.scale}
                  strokeDasharray={`${(4 * density) / view.scale} ${(6 * density) / view.scale}`}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  opacity="0.35"
                />
              </>
            )}

            {referenceLap &&
              transform &&
              (() => {
                const [fx, fy] = transform.toScreen(
                  referenceLap.lineX,
                  referenceLap.lineY,
                );
                const last = referenceLap.x.length - 1;
                const [bx, by] = transform.toScreen(
                  referenceLap.x[last]!,
                  referenceLap.y[last]!,
                );
                const [ax, ay] = transform.toScreen(
                  referenceLap.x[0]!,
                  referenceLap.y[0]!,
                );
                const heading = (Math.atan2(ay - by, ax - bx) * 180) / Math.PI;
                const cells = [];
                for (let row = 0; row < FINISH_ROWS; row++) {
                  for (let col = 0; col < FINISH_COLS; col++) {
                    cells.push(
                      <rect
                        key={`${row}-${col}`}
                        x={(row - FINISH_ROWS / 2) * FINISH_DEPTH}
                        y={(col - FINISH_COLS / 2) * FINISH_CELL}
                        width={FINISH_DEPTH}
                        height={FINISH_CELL}
                        fill={
                          (row + col) % 2 === 0
                            ? "oklch(97% 0 0)"
                            : "oklch(18% 0 0)"
                        }
                      />,
                    );
                  }
                }
                return (
                  <g
                    transform={`translate(${fx} ${fy}) rotate(${heading.toFixed(1)}) scale(${density / view.scale})`}
                  >
                    {cells}
                  </g>
                );
              })()}

            {sectorLines && (
              <g className="pointer-events-none">
                {sectorLines.map((s) => {
                  const unit = 1 / view.scale;
                  return (
                    <g key={s.id}>
                      <line
                        x1={s.x - s.dx * 12 * density * unit}
                        y1={s.y - s.dy * 12 * density * unit}
                        x2={s.x + s.dx * 12 * density * unit}
                        y2={s.y + s.dy * 12 * density * unit}
                        stroke="oklch(85% 0 0)"
                        strokeWidth={2 * unit}
                        strokeDasharray={`${3 * unit} ${2.5 * unit}`}
                        opacity="0.75"
                      />
                      <text
                        x={s.x + s.dx * SECTOR_LABEL_OFFSET * density * unit}
                        y={s.y + s.dy * SECTOR_LABEL_OFFSET * density * unit}
                        fontSize={12 * density * unit}
                        fontFamily="var(--font-mono)"
                        fontWeight={600}
                        fill="oklch(85% 0 0)"
                        stroke="oklch(14.48% 0 0)"
                        strokeWidth={2.5 * density * unit}
                        paintOrder="stroke"
                        textAnchor="middle"
                        dominantBaseline="central"
                      >
                        {s.label}
                      </text>
                    </g>
                  );
                })}
              </g>
            )}

            {cornerNodes && (
              <g className="pointer-events-none">
                {cornerNodes.map((c) => {
                  const inLoop =
                    !!markedLoop &&
                    c.time >= markedLoop.a &&
                    c.time <= markedLoop.b;
                  const active = hoveredCorner === c.id || inLoop;
                  const color = active
                    ? "oklch(78.66% 0.175 157.91)"
                    : "oklch(62% 0 0)";
                  const unit = 1 / view.scale;
                  const showLabel =
                    !visibleCornerIds ||
                    visibleCornerIds.has(c.id) ||
                    hoveredCorner === c.id;
                  return (
                    <g key={c.id}>
                      <line
                        x1={c.x + c.nx * 9 * density * unit}
                        y1={c.y + c.ny * 9 * density * unit}
                        x2={c.x + c.nx * 16 * density * unit}
                        y2={c.y + c.ny * 16 * density * unit}
                        stroke={color}
                        strokeWidth={unit}
                        opacity={active ? 1 : 0.7}
                      />
                      {showLabel && (
                        <text
                          x={c.x + c.nx * CORNER_LABEL_OFFSET * density * unit}
                          y={c.y + c.ny * CORNER_LABEL_OFFSET * density * unit}
                          fontSize={12 * density * unit}
                          fontFamily="var(--font-mono)"
                          fontWeight={600}
                          fill={color}
                          stroke="oklch(14.48% 0 0)"
                          strokeWidth={2.5 * density * unit}
                          paintOrder="stroke"
                          textAnchor={
                            c.nx > 0.5
                              ? "start"
                              : c.nx < -0.5
                                ? "end"
                                : "middle"
                          }
                          dominantBaseline="central"
                        >
                          {c.label}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            )}

            {replay.laps.map((lap) => (
              <LapDot
                key={lap.key}
                lap={lap}
                color={colorFor(lap.key)}
                hovered={(hoveredKey ?? pinnedKey) === lap.key}
                registerLap={registerLap}
                scale={view.scale}
                density={density}
              />
            ))}
          </g>
        </svg>
      )}

      <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
        <button
          type="button"
          onClick={toggleFollow}
          aria-pressed={follow}
          aria-label={
            follow ? "Unlock view from drivers" : "Lock view to drivers"
          }
          className={cn(
            "flex items-center gap-1.5 border px-2.5 py-1.5 font-mono text-[12px] tracking-[0.15em] uppercase transition-colors focus-visible:outline-2 focus-visible:outline-accent-green",
            follow
              ? "border-accent-green bg-surface-card-hover text-accent-green"
              : "border-surface-border bg-surface-card text-text-secondary hover:bg-surface-card-hover hover:text-text-primary",
          )}
        >
          {follow ? (
            <LocateFixed className="size-3" aria-hidden="true" />
          ) : (
            <Locate className="size-3" aria-hidden="true" />
          )}
          {follow ? `Locked ${view.scale.toFixed(1)}×` : "Lock"}
        </button>
        {zoomed && (
          <button
            type="button"
            onClick={resetView}
            className="flex items-center gap-1.5 border border-surface-border bg-surface-card px-2.5 py-1.5 font-mono text-[12px] tracking-[0.15em] uppercase text-accent-green transition-colors hover:bg-surface-card-hover focus-visible:outline-2 focus-visible:outline-accent-green"
          >
            Reset zoom
          </button>
        )}
      </div>

      <div
        aria-hidden="true"
        className={cn(
          "absolute bottom-3 left-3 z-10 transition-opacity duration-300",
          roominess > 0 && !playback.playing && (follow || !zoomed)
            ? "opacity-100"
            : "opacity-0",
        )}
      >
        <span className="inline-block border border-surface-border bg-surface-card px-2.5 py-1.5 font-mono text-[10px] tracking-[0.15em] uppercase text-text-secondary">
          <span className="pointer-coarse:hidden">
            {follow
              ? "Scroll to set follow zoom · Drag to unlock"
              : "Scroll to zoom · Drag to pan · Click a turn to jump"}
          </span>
          <span className="hidden pointer-coarse:inline">
            {follow
              ? "Pinch to set follow zoom · Drag to unlock"
              : "Pinch to zoom · Tap a turn to jump"}
          </span>
        </span>
      </div>
    </div>
  );
}

function LapDot({
  lap,
  color,
  hovered,
  registerLap,
  scale,
  density,
}: {
  lap: ReplayLap;
  color: string;
  hovered: boolean;
  registerLap: (
    key: string,
    slot: "triangle" | "trail" | "delta",
    node: SVGGElement | SVGPolylineElement | SVGTextElement | null,
  ) => void;
  scale: number;
  density: number;
}) {
  return (
    <g data-lap-key={lap.key}>
      <polyline
        ref={(el) => registerLap(lap.key, "trail", el)}
        fill="none"
        stroke={color}
        strokeWidth={(2.5 * density) / scale}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.55"
        points=""
      />
      <g ref={(el) => registerLap(lap.key, "triangle", el)}>
        <polygon
          points={TRIANGLE_POINTS}
          fill={color}
          stroke="oklch(14.48% 0 0)"
          strokeWidth={1.5}
          transform={`scale(${density / scale})`}
          style={{
            filter: hovered
              ? `drop-shadow(0 0 6px ${color})`
              : `drop-shadow(0 1px 2px oklch(0% 0 0 / 0.6))`,
          }}
        />
        <title>
          {lap.driver} · Lap {lap.lap}
        </title>
      </g>
      <text
        ref={(el) => registerLap(lap.key, "delta", el)}
        opacity="0"
        fontSize={(13 * density) / scale}
        fontFamily="var(--font-mono)"
        fontWeight={600}
        fill={color}
        stroke="oklch(14.48% 0 0)"
        strokeWidth={(3 * density) / scale}
        paintOrder="stroke"
        dominantBaseline="central"
        letterSpacing={(1 * density) / scale}
        style={{ transition: "opacity 200ms ease-out" }}
      />
    </g>
  );
}
