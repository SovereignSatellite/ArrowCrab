import { smoothPath, arrowhead, hollowCircle } from "./canvas-primitives";
import type { Point } from "../geometry/types";
import {
  CORNER_RADIUS,
  CROSSING_CIRCLE_RADIUS,
  CROSSING_CIRCLE_WIDTH,
  EDGE_STROKE_WIDTH,
} from "./constants";

interface DrawEdgeOptions {
  points: readonly Point[];
  color?: string;
  lineWidth?: number;
  cornerRadius?: number;
  drawArrow?: boolean;
  arrowSize?: number;
}

export function drawEdge(
  context: CanvasRenderingContext2D,
  options: DrawEdgeOptions,
): void {
  const { points } = options;
  if (points.length < 2) {
    return;
  }

  const color = options.color ?? "#cccccc";
  const lineWidth = options.lineWidth ?? EDGE_STROKE_WIDTH;
  const cornerRadius = options.cornerRadius ?? CORNER_RADIUS;

  smoothPath(context, points, cornerRadius);
  context.strokeStyle = color;
  context.lineWidth = lineWidth;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.stroke();

  if (options.drawArrow !== false && points.length >= 2) {
    const tip = points[points.length - 1];
    const previous = points[points.length - 2];
    const angle = Math.atan2(tip.y - previous.y, tip.x - previous.x);
    const size = options.arrowSize ?? 6;

    arrowhead(context, tip.x, tip.y, angle, size);
    context.fillStyle = color;
    context.fill();
  }
}

interface DrawCrossingCircleOptions {
  x: number;
  y: number;
  color?: string;
  radius?: number;
  lineWidth?: number;
}

export function drawCrossingCircle(
  context: CanvasRenderingContext2D,
  options: DrawCrossingCircleOptions,
): void {
  const color = options.color ?? "#ffffff";
  const radius = options.radius ?? CROSSING_CIRCLE_RADIUS;
  const lineWidth = options.lineWidth ?? CROSSING_CIRCLE_WIDTH;

  hollowCircle(context, options.x, options.y, radius, color, lineWidth);
}
