import type { Point } from "../geometry/types";
import { parseCssColor } from "./colors";
import { EDGE_STROKE_WIDTH, FRAME_STROKE_WIDTH } from "./constants";

export interface VertexBuffer {
  vertices: number[];
  packedVertices: Float32Array;
}

export function createVertexBuffer(): VertexBuffer {
  return { vertices: [], packedVertices: new Float32Array(0) };
}

export function clearVertexBuffer(buffer: VertexBuffer): void {
  buffer.vertices.length = 0;
}

export function getPackedVertexData(buffer: VertexBuffer): Float32Array {
  if (buffer.packedVertices.length < buffer.vertices.length) {
    const nextCapacity = Math.max(
      buffer.vertices.length,
      Math.max(1, buffer.packedVertices.length * 2),
    );
    buffer.packedVertices = new Float32Array(nextCapacity);
  }
  buffer.packedVertices.set(buffer.vertices);
  return buffer.packedVertices.subarray(0, buffer.vertices.length);
}

export const BACKGROUND = [20 / 255, 20 / 255, 20 / 255];
export const DIM_ALPHA = 0.15;
const CROSSING_SEGMENT_COUNT = 16;
const CROSSING_RADIUS = 3;
const ARROW_SIZE = 6;
export const NODE_CORNER_RADIUS = 3;
export const FRAME_CORNER_RADIUS = 2;
const CORNER_RADIUS = 4;
const CURVE_SAMPLE_COUNT = 8;
export const LOD_FULL = 40;
export const LOD_SIMPLIFIED = 8;
export const LOD_DOT = 2;

export const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
in vec4 a_color;
out vec4 v_color;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_color = a_color;
}`;

export const FRAGMENT_SHADER = `#version 300 es
precision mediump float;
in vec4 v_color;
out vec4 out_color;
void main() {
  out_color = v_color;
}`;

export function cssColor(color: string): [number, number, number] {
  const parsed = parseCssColor(color);
  return [parsed.red / 255, parsed.green / 255, parsed.blue / 255];
}

function appendVertex(
  buffer: VertexBuffer,
  x: number,
  y: number,
  color: readonly [number, number, number],
  alpha: number,
  toClipCoordinates: (x: number, y: number) => [number, number],
): void {
  const [clipX, clipY] = toClipCoordinates(x, y);
  buffer.vertices.push(clipX, clipY, color[0], color[1], color[2], alpha);
}

function appendLine(
  buffer: VertexBuffer,
  first: Point,
  second: Point,
  color: readonly [number, number, number],
  alpha: number,
  toClipCoordinates: (x: number, y: number) => [number, number],
): void {
  appendVertex(buffer, first.x, first.y, color, alpha, toClipCoordinates);
  appendVertex(buffer, second.x, second.y, color, alpha, toClipCoordinates);
}

function appendThickLine(
  buffer: VertexBuffer,
  first: Point,
  second: Point,
  color: readonly [number, number, number],
  alpha: number,
  toClipCoordinates: (x: number, y: number) => [number, number],
  lineWidth: number,
): void {
  const deltaX = second.x - first.x;
  const deltaY = second.y - first.y;
  const length = Math.hypot(deltaX, deltaY);
  if (length === 0) return;

  const halfWidth = lineWidth / 2;
  const offsetX = (-deltaY / length) * halfWidth;
  const offsetY = (deltaX / length) * halfWidth;
  const firstLeft = { x: first.x + offsetX, y: first.y + offsetY };
  const firstRight = { x: first.x - offsetX, y: first.y - offsetY };
  const secondLeft = { x: second.x + offsetX, y: second.y + offsetY };
  const secondRight = { x: second.x - offsetX, y: second.y - offsetY };

  appendVertex(
    buffer,
    firstLeft.x,
    firstLeft.y,
    color,
    alpha,
    toClipCoordinates,
  );
  appendVertex(
    buffer,
    firstRight.x,
    firstRight.y,
    color,
    alpha,
    toClipCoordinates,
  );
  appendVertex(
    buffer,
    secondRight.x,
    secondRight.y,
    color,
    alpha,
    toClipCoordinates,
  );
  appendVertex(
    buffer,
    firstLeft.x,
    firstLeft.y,
    color,
    alpha,
    toClipCoordinates,
  );
  appendVertex(
    buffer,
    secondRight.x,
    secondRight.y,
    color,
    alpha,
    toClipCoordinates,
  );
  appendVertex(
    buffer,
    secondLeft.x,
    secondLeft.y,
    color,
    alpha,
    toClipCoordinates,
  );
}

function roundedRectanglePoints(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): Point[] {
  const clampedRadius = Math.min(radius, width / 2, height / 2);
  const points: Point[] = [];
  const corners = [
    {
      x: x + clampedRadius,
      y: y + clampedRadius,
      start: Math.PI,
      end: Math.PI * 1.5,
    },
    {
      x: x + width - clampedRadius,
      y: y + clampedRadius,
      start: Math.PI * 1.5,
      end: Math.PI * 2,
    },
    {
      x: x + width - clampedRadius,
      y: y + height - clampedRadius,
      start: 0,
      end: Math.PI / 2,
    },
    {
      x: x + clampedRadius,
      y: y + height - clampedRadius,
      start: Math.PI / 2,
      end: Math.PI,
    },
  ];
  const samplesPerCorner = 4;
  for (const corner of corners) {
    for (let sample = 0; sample < samplesPerCorner; sample += 1) {
      const angle =
        corner.start +
        ((corner.end - corner.start) * sample) / samplesPerCorner;
      points.push({
        x: corner.x + Math.cos(angle) * clampedRadius,
        y: corner.y + Math.sin(angle) * clampedRadius,
      });
    }
  }
  return points;
}

export function appendRoundedRectangle(
  buffer: VertexBuffer,
  x: number,
  y: number,
  width: number,
  height: number,
  color: readonly [number, number, number],
  alpha: number,
  toClipCoordinates: (x: number, y: number) => [number, number],
  radius: number,
): void {
  const points = roundedRectanglePoints(x, y, width, height, radius);
  const center = { x: x + width / 2, y: y + height / 2 };
  for (let index = 0; index < points.length; index += 1) {
    appendVertex(buffer, center.x, center.y, color, alpha, toClipCoordinates);
    appendVertex(
      buffer,
      points[index].x,
      points[index].y,
      color,
      alpha,
      toClipCoordinates,
    );
    appendVertex(
      buffer,
      points[(index + 1) % points.length].x,
      points[(index + 1) % points.length].y,
      color,
      alpha,
      toClipCoordinates,
    );
  }
}

export function appendRoundedRectangleOutline(
  buffer: VertexBuffer,
  x: number,
  y: number,
  width: number,
  height: number,
  color: readonly [number, number, number],
  alpha: number,
  toClipCoordinates: (x: number, y: number) => [number, number],
  radius: number,
  lineWidth: number = FRAME_STROKE_WIDTH,
): void {
  const points = roundedRectanglePoints(x, y, width, height, radius);
  for (let index = 0; index < points.length; index += 1) {
    appendThickLine(
      buffer,
      points[index],
      points[(index + 1) % points.length],
      color,
      alpha,
      toClipCoordinates,
      lineWidth,
    );
  }
}

export function appendArrowhead(
  buffer: VertexBuffer,
  tip: Point,
  previous: Point,
  color: readonly [number, number, number],
  alpha: number,
  toClipCoordinates: (x: number, y: number) => [number, number],
): void {
  const angle = Math.atan2(tip.y - previous.y, tip.x - previous.x);
  const halfSpread = Math.PI / 6;
  const left = {
    x: tip.x - ARROW_SIZE * Math.cos(angle - halfSpread),
    y: tip.y - ARROW_SIZE * Math.sin(angle - halfSpread),
  };
  const right = {
    x: tip.x - ARROW_SIZE * Math.cos(angle + halfSpread),
    y: tip.y - ARROW_SIZE * Math.sin(angle + halfSpread),
  };
  appendVertex(buffer, tip.x, tip.y, color, alpha, toClipCoordinates);
  appendVertex(buffer, left.x, left.y, color, alpha, toClipCoordinates);
  appendVertex(buffer, right.x, right.y, color, alpha, toClipCoordinates);
}

export function appendSmoothPolyline(
  buffer: VertexBuffer,
  points: readonly Point[],
  color: readonly [number, number, number],
  alpha: number,
  toClipCoordinates: (x: number, y: number) => [number, number],
): void {
  if (points.length < 2) return;
  const smoothed: Point[] = [points[0]];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const previousDistance = Math.hypot(
      current.x - previous.x,
      current.y - previous.y,
    );
    const nextDistance = Math.hypot(next.x - current.x, next.y - current.y);
    const radius = Math.min(
      CORNER_RADIUS,
      previousDistance / 2,
      nextDistance / 2,
    );
    const enter = {
      x: current.x - (radius * (current.x - previous.x)) / previousDistance,
      y: current.y - (radius * (current.y - previous.y)) / previousDistance,
    };
    const leave = {
      x: current.x + (radius * (next.x - current.x)) / nextDistance,
      y: current.y + (radius * (next.y - current.y)) / nextDistance,
    };
    smoothed.push(enter);
    for (let sample = 1; sample <= CURVE_SAMPLE_COUNT; sample += 1) {
      const curveParameter = sample / CURVE_SAMPLE_COUNT;
      const inverse = 1 - curveParameter;
      smoothed.push({
        x:
          inverse * inverse * enter.x +
          2 * inverse * curveParameter * current.x +
          curveParameter * curveParameter * leave.x,
        y:
          inverse * inverse * enter.y +
          2 * inverse * curveParameter * current.y +
          curveParameter * curveParameter * leave.y,
      });
    }
  }
  smoothed.push(points[points.length - 1]);
  for (let index = 0; index < smoothed.length - 1; index += 1) {
    appendThickLine(
      buffer,
      smoothed[index],
      smoothed[index + 1],
      color,
      alpha,
      toClipCoordinates,
      EDGE_STROKE_WIDTH,
    );
  }
}

export function appendCircleOutline(
  buffer: VertexBuffer,
  center: Point,
  color: readonly [number, number, number],
  alpha: number,
  toClipCoordinates: (x: number, y: number) => [number, number],
): void {
  for (let index = 0; index < CROSSING_SEGMENT_COUNT; index += 1) {
    const firstAngle = (index / CROSSING_SEGMENT_COUNT) * Math.PI * 2;
    const secondAngle = ((index + 1) / CROSSING_SEGMENT_COUNT) * Math.PI * 2;
    appendLine(
      buffer,
      {
        x: center.x + Math.cos(firstAngle) * CROSSING_RADIUS,
        y: center.y + Math.sin(firstAngle) * CROSSING_RADIUS,
      },
      {
        x: center.x + Math.cos(secondAngle) * CROSSING_RADIUS,
        y: center.y + Math.sin(secondAngle) * CROSSING_RADIUS,
      },
      color,
      alpha,
      toClipCoordinates,
    );
  }
}
