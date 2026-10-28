/** Pure stroke model + rendering for the drawing pad (coordinates are CSS pixels). */

export interface StrokePoint {
  x: number;
  y: number;
  /** Line width at this point, already modulated by speed / pressure. */
  w: number;
}

export interface Stroke {
  color: string;
  points: StrokePoint[];
}

const mid = (a: StrokePoint, b: StrokePoint) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * Width for a new sample: pen pressure when the device reports it, otherwise pointer speed
 * (fast = thinner, slow = thicker), smoothed against the previous width.
 */
export function nextWidth(
  base: number,
  prev: StrokePoint | null,
  x: number,
  y: number,
  dt: number,
  pressure: number,
  isPen: boolean,
): number {
  let factor = 1;
  if (isPen && pressure > 0) {
    factor = 0.35 + 1.3 * pressure;
  } else if (prev && dt > 0) {
    const speed = Math.hypot(x - prev.x, y - prev.y) / dt; // px per ms
    factor = Math.min(1.25, Math.max(0.45, 1.3 - speed * 0.55));
  }
  const target = base * factor;
  return prev ? prev.w * 0.6 + target * 0.4 : target;
}

function drawDot(ctx: CanvasRenderingContext2D, p: StrokePoint, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.w / 2, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Draws the curve piece that becomes final once sample `index` exists: a quadratic curve
 * between the midpoints of consecutive samples, using the middle sample as control point.
 */
export function drawStrokeSegment(ctx: CanvasRenderingContext2D, stroke: Stroke, index: number) {
  const pts = stroke.points;
  if (index < 0 || index >= pts.length) return;
  ctx.strokeStyle = stroke.color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (pts.length === 1) {
    drawDot(ctx, pts[0], stroke.color);
    return;
  }
  if (index === 0) return;
  const prev = pts[index - 1];
  const cur = pts[index];
  const start = index === 1 ? prev : mid(pts[index - 2], prev);
  const end = mid(prev, cur);
  ctx.lineWidth = prev.w;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.quadraticCurveTo(prev.x, prev.y, end.x, end.y);
  ctx.stroke();
}

/** Closes a stroke: the last half-segment from the final midpoint to the last sample. */
export function drawStrokeTail(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  const pts = stroke.points;
  if (pts.length < 2) return;
  const last = pts[pts.length - 1];
  const start = mid(pts[pts.length - 2], last);
  ctx.strokeStyle = stroke.color;
  ctx.lineCap = "round";
  ctx.lineWidth = last.w;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

export function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  for (let i = 0; i < stroke.points.length; i++) drawStrokeSegment(ctx, stroke, i);
  drawStrokeTail(ctx, stroke);
}

export function drawAllStrokes(ctx: CanvasRenderingContext2D, strokes: readonly Stroke[]) {
  for (const stroke of strokes) drawStroke(ctx, stroke);
}
