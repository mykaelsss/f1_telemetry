export type Transform = {
  toScreen: (x: number, y: number) => [number, number];
  rotate: (heading: number) => number;
  scale: number;
  extent: { width: number; height: number };
};

export function buildTransform(
  points: { x: Float64Array; y: Float64Array },
  rotationDeg: number,
  viewport: { width: number; height: number; padding: number },
): Transform {
  const theta = (-rotationDeg * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < points.x.length; i++) {
    const xi = points.x[i]!;
    const yi = points.y[i]!;
    if (xi < minX) minX = xi;
    if (xi > maxX) maxX = xi;
    if (yi < minY) minY = yi;
    if (yi > maxY) maxY = yi;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  let rMinX = Infinity;
  let rMaxX = -Infinity;
  let rMinY = Infinity;
  let rMaxY = -Infinity;
  for (let i = 0; i < points.x.length; i++) {
    const dx = points.x[i]! - cx;
    const dy = points.y[i]! - cy;
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;
    if (rx < rMinX) rMinX = rx;
    if (rx > rMaxX) rMaxX = rx;
    if (ry < rMinY) rMinY = ry;
    if (ry > rMaxY) rMaxY = ry;
  }

  const usableW = Math.max(1, viewport.width - viewport.padding * 2);
  const usableH = Math.max(1, viewport.height - viewport.padding * 2);
  const spanX = Math.max(1e-6, rMaxX - rMinX);
  const spanY = Math.max(1e-6, rMaxY - rMinY);
  const scale = Math.min(usableW / spanX, usableH / spanY);

  const offsetX = viewport.width / 2 - ((rMinX + rMaxX) / 2) * scale;
  const offsetY = viewport.height / 2 + ((rMinY + rMaxY) / 2) * scale;

  const toScreen = (x: number, y: number): [number, number] => {
    const dx = x - cx;
    const dy = y - cy;
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;
    return [rx * scale + offsetX, -ry * scale + offsetY];
  };

  const rotate = (heading: number) => -(heading + theta) * (180 / Math.PI) + 90;

  return {
    toScreen,
    rotate,
    scale,
    extent: { width: spanX * scale, height: spanY * scale },
  };
}

export function outlinePath(
  lap: { x: Float64Array; y: Float64Array },
  toScreen: (x: number, y: number) => [number, number],
): string {
  if (lap.x.length === 0) return "";
  const [sx, sy] = toScreen(lap.x[0]!, lap.y[0]!);
  let d = `M ${sx.toFixed(2)} ${sy.toFixed(2)}`;
  for (let i = 1; i < lap.x.length; i++) {
    const [px, py] = toScreen(lap.x[i]!, lap.y[i]!);
    d += ` L ${px.toFixed(2)} ${py.toFixed(2)}`;
  }
  return `${d} Z`;
}
