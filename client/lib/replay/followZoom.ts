const STORAGE_KEY = "replay_follow_zoom";
const DEFAULT_FOLLOW_ZOOM = 3;

let cached: number | null = null;

export function readFollowZoom(): number {
  if (cached !== null) return cached;
  let next = DEFAULT_FOLLOW_ZOOM;
  try {
    const stored = Number(localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(stored) && stored > 0) next = stored;
  } catch {
    // Storage unavailable; fall back to the default.
  }
  cached = next;
  return next;
}

export function writeFollowZoom(scale: number) {
  if (!Number.isFinite(scale) || scale <= 0 || cached === scale) return;
  cached = scale;
  try {
    localStorage.setItem(STORAGE_KEY, String(scale));
  } catch {
    // Storage unavailable; keep the in-memory value and continue.
  }
}
