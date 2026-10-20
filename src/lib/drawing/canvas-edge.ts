import type { RoutePoints } from "../diagram/routing.ts";
import type { DrawingContext } from "./context.ts";
import { smoothPath, arrowhead, circle } from "./canvas-primitives.ts";
import {
  CORNER_RADIUS,
  CROSSING_CIRCLE_RADIUS,
  CROSSING_CIRCLE_WIDTH,
  EDGE_STROKE_WIDTH,
} from "./styles.ts";

export function drawEdge(
  context: DrawingContext,
  options: { points: RoutePoints; color: string },
): void {
  const { points, color } = options;
  smoothPath(context, points, CORNER_RADIUS);
  context.strokeStyle = color;
  context.lineWidth = EDGE_STROKE_WIDTH;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.stroke();

  const tipX = points[points.length - 2];
  const tipY = points[points.length - 1];
  const angle = Math.atan2(
    tipY - points[points.length - 3],
    tipX - points[points.length - 4],
  );
  arrowhead(context, tipX, tipY, angle, 6);
  context.fillStyle = color;
  context.fill();
}

export function drawCrossingCircle(
  context: DrawingContext,
  options: { x: number; y: number },
): void {
  circle(context, options.x, options.y, CROSSING_CIRCLE_RADIUS);
  context.strokeStyle = "#ffffff";
  context.lineWidth = CROSSING_CIRCLE_WIDTH;
  context.stroke();
}
