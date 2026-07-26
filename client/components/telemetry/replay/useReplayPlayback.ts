"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type PlaybackSpeed = 0.5 | 1 | 2 | 4;

export type Loop = { a: number; b: number };

type Options = {
  duration: number;
  initialTime?: number;
  initialLoop?: Loop | null;
  snapTimes?: number[];
  keyboardEnabled: boolean;
};

export type PlaybackApi = {
  playing: boolean;
  speed: PlaybackSpeed;
  duration: number;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (t: number) => void;
  seekBy: (delta: number) => void;
  restart: () => void;
  setSpeed: (s: PlaybackSpeed) => void;
  getTime: () => number;
  subscribe: (cb: (t: number, wrapped?: boolean) => void) => () => void;
  displayTime: number;
  loop: Loop | null;
  loopA: number | null;
  loopB: number | null;
  setLoopPoint: (which: "a" | "b") => void;
  setLoopRange: (a: number, b: number) => void;
  clearLoop: () => void;
};

const SPEEDS: PlaybackSpeed[] = [0.5, 1, 2, 4];
const MIN_LOOP = 0.25;

export function useReplayPlayback({
  duration,
  initialTime = 0,
  initialLoop = null,
  snapTimes,
  keyboardEnabled,
}: Options): PlaybackApi {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState<PlaybackSpeed>(1);
  const [displayTime, setDisplayTime] = useState(
    Math.max(0, Math.min(initialTime, duration)),
  );

  const tRef = useRef(Math.max(0, Math.min(initialTime, duration)));
  const speedRef = useRef<PlaybackSpeed>(1);
  const playingRef = useRef(false);
  const durationRef = useRef(duration);
  const lastFrameRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastReactSyncRef = useRef(0);
  const subscribersRef = useRef<Set<(t: number, wrapped?: boolean) => void>>(
    new Set(),
  );

  const [loopA, setLoopA] = useState<number | null>(initialLoop?.a ?? null);
  const [loopB, setLoopB] = useState<number | null>(initialLoop?.b ?? null);

  const loop = useMemo<Loop | null>(() => {
    if (loopA === null || loopB === null || duration <= 0) return null;
    const a = Math.max(0, Math.min(Math.min(loopA, loopB), duration));
    const b = Math.max(0, Math.min(Math.max(loopA, loopB), duration));
    return b - a >= MIN_LOOP ? { a, b } : null;
  }, [loopA, loopB, duration]);

  const loopRef = useRef<Loop | null>(loop);
  useEffect(() => {
    loopRef.current = loop;
  }, [loop]);

  const snapTimesRef = useRef<number[]>(snapTimes ?? []);
  useEffect(() => {
    snapTimesRef.current = snapTimes ?? [];
  }, [snapTimes]);

  const emit = useCallback((t: number, force = false, wrapped = false) => {
    for (const cb of subscribersRef.current) cb(t, wrapped);
    const now = performance.now();
    if (force || now - lastReactSyncRef.current > 100) {
      lastReactSyncRef.current = now;
      setDisplayTime(t);
    }
  }, []);

  const initialApplied = useRef(false);
  useEffect(() => {
    durationRef.current = duration;
    if (duration <= 0) return;
    if (!initialApplied.current) {
      initialApplied.current = true;
      const start = Math.max(0, Math.min(initialTime, duration));
      tRef.current = start;
      emit(start, true);
      return;
    }
    if (tRef.current > duration) {
      tRef.current = duration;
      emit(duration, true);
    }
  }, [duration, initialTime, emit]);

  const stepRef = useRef<(now: number) => void>(() => {});
  useEffect(() => {
    stepRef.current = (now: number) => {
      const last = lastFrameRef.current ?? now;
      const dt = (now - last) / 1000;
      lastFrameRef.current = now;

      const next = tRef.current + dt * speedRef.current;
      const total = durationRef.current;
      const active = loopRef.current;
      if (active && next >= active.b) {
        const span = active.b - active.a;
        const wrapped = active.a + ((next - active.a) % span);
        tRef.current = wrapped;
        emit(wrapped, true, true);
        rafRef.current = requestAnimationFrame((n) => stepRef.current(n));
        return;
      }
      if (next >= total) {
        tRef.current = total;
        emit(total, true);
        playingRef.current = false;
        setPlaying(false);
        lastFrameRef.current = null;
        rafRef.current = null;
        return;
      }
      tRef.current = next;
      emit(next);
      rafRef.current = requestAnimationFrame((n) => stepRef.current(n));
    };
  }, [emit]);

  const play = useCallback(() => {
    if (playingRef.current) return;
    if (tRef.current >= durationRef.current) {
      tRef.current = 0;
      emit(0, true);
    }
    playingRef.current = true;
    setPlaying(true);
    lastFrameRef.current = null;
    rafRef.current = requestAnimationFrame((n) => stepRef.current(n));
  }, [emit]);

  const pause = useCallback(() => {
    if (!playingRef.current) return;
    playingRef.current = false;
    setPlaying(false);
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    lastFrameRef.current = null;
    emit(tRef.current, true);
  }, [emit]);

  const toggle = useCallback(() => {
    if (playingRef.current) pause();
    else play();
  }, [pause, play]);

  const seek = useCallback(
    (t: number) => {
      const clamped = Math.max(0, Math.min(t, durationRef.current));
      tRef.current = clamped;
      lastFrameRef.current = null;
      emit(clamped, true);
    },
    [emit],
  );

  const seekBy = useCallback(
    (delta: number) => {
      seek(tRef.current + delta);
    },
    [seek],
  );

  const restart = useCallback(() => {
    seek(loopRef.current?.a ?? 0);
  }, [seek]);

  const setLoopPoint = useCallback((which: "a" | "b") => {
    const t = tRef.current;
    let snapped = t;
    let bestDelta = Infinity;
    for (const s of snapTimesRef.current) {
      const delta = Math.abs(s - t);
      if (delta < bestDelta) {
        bestDelta = delta;
        snapped = s;
      }
    }
    if (which === "a") setLoopA(snapped);
    else setLoopB(snapped);
  }, []);

  const setLoopRange = useCallback((a: number, b: number) => {
    setLoopA(Math.min(a, b));
    setLoopB(Math.max(a, b));
  }, []);

  const clearLoop = useCallback(() => {
    setLoopA(null);
    setLoopB(null);
  }, []);

  const setSpeed = useCallback((s: PlaybackSpeed) => {
    speedRef.current = s;
    setSpeedState(s);
  }, []);

  const subscribe = useCallback((cb: (t: number) => void) => {
    subscribersRef.current.add(cb);
    cb(tRef.current);
    return () => {
      subscribersRef.current.delete(cb);
    };
  }, []);

  const getTime = useCallback(() => tRef.current, []);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  useEffect(() => {
    if (!keyboardEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      const isRange =
        tag === "INPUT" && (target as HTMLInputElement).type === "range";
      if (
        (tag === "INPUT" && !isRange) ||
        tag === "TEXTAREA" ||
        target?.isContentEditable
      )
        return;

      if (e.key === "[") {
        e.preventDefault();
        setLoopPoint("a");
        return;
      }
      if (e.key === "]") {
        e.preventDefault();
        setLoopPoint("b");
        return;
      }
      if (e.key === "\\") {
        e.preventDefault();
        clearLoop();
        return;
      }

      if (isRange || target?.getAttribute("role") === "slider") return;

      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        toggle();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        seekBy(e.shiftKey ? 5 : 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        seekBy(e.shiftKey ? -5 : -1);
      } else if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        restart();
      } else if (e.key >= "1" && e.key <= "4") {
        const idx = parseInt(e.key, 10) - 1;
        const next = SPEEDS[idx];
        if (next) setSpeed(next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    keyboardEnabled,
    toggle,
    seekBy,
    restart,
    setSpeed,
    setLoopPoint,
    clearLoop,
  ]);

  return {
    playing,
    speed,
    duration,
    play,
    pause,
    toggle,
    seek,
    seekBy,
    restart,
    setSpeed,
    getTime,
    subscribe,
    displayTime,
    loop,
    loopA,
    loopB,
    setLoopPoint,
    setLoopRange,
    clearLoop,
  };
}

export { SPEEDS };
