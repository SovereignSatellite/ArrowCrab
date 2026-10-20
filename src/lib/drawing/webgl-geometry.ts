import type { RoutePoints } from "../diagram/routing.ts";
import type { Point } from "../diagram/point.ts";
import { EDGE_STROKE_WIDTH } from "./styles.ts";

export interface VertexBuffer {
  vertices: Float32Array;
  length: number;
}

export function createVertexBuffer(): VertexBuffer {
  return { vertices: new Float32Array(0), length: 0 };
}

export function clearVertexBuffer(buffer: VertexBuffer): void {
  buffer.length = 0;
}

export function getPackedVertexData(buffer: VertexBuffer): Float32Array {
  return buffer.vertices.subarray(0, buffer.length);
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

function appendVertex(
  buffer: VertexBuffer,
  x: number,
  y: number,
  color: readonly [number, number, number],
  alpha: number,
  toClipCoordinates: (x: number, y: number) => [number, number],
): void {
  const [clipX, clipY] = toClipCoordinates(x, y);
  if (buffer.length + 6 > buffer.vertices.length) {
    const vertices = new Float32Array(
      Math.max(buffer.length + 6, buffer.vertices.length * 2),
    );
    vertices.set(buffer.vertices.subarray(0, buffer.length));
    buffer.vertices = vertices;
  }
  buffer.vertices[buffer.length] = clipX;
  buffer.vertices[buffer.length + 1] = clipY;
  buffer.vertices[buffer.length + 2] = color[0];
  buffer.vertices[buffer.length + 3] = color[1];
  buffer.vertices[buffer.length + 4] = color[2];
  buffer.vertices[buffer.length + 5] = alpha;
  buffer.length += 6;
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
  firstX: number,
  firstY: number,
  secondX: number,
  secondY: number,
  color: readonly [number, number, number],
  alpha: number,
  toClipCoordinates: (x: number, y: number) => [number, number],
  lineWidth: number,
): void {
  const deltaX = secondX - firstX;
  const deltaY = secondY - firstY;
  const length = Math.hypot(deltaX, deltaY);
  if (length === 0) return;
  const halfWidth = lineWidth / 2;
  const offsetX = (-deltaY / length) * halfWidth;
  const offsetY = (deltaX / length) * halfWidth;
  const firstLeftX = firstX + offsetX;
  const firstLeftY = firstY + offsetY;
  const firstRightX = firstX - offsetX;
  const firstRightY = firstY - offsetY;
  const secondLeftX = secondX + offsetX;
  const secondLeftY = secondY + offsetY;
  const secondRightX = secondX - offsetX;
  const secondRightY = secondY - offsetY;
  appendVertex(buffer, firstLeftX, firstLeftY, color, alpha, toClipCoordinates);
  appendVertex(
    buffer,
    firstRightX,
    firstRightY,
    color,
    alpha,
    toClipCoordinates,
  );
  appendVertex(
    buffer,
    secondRightX,
    secondRightY,
    color,
    alpha,
    toClipCoordinates,
  );
  appendVertex(buffer, firstLeftX, firstLeftY, color, alpha, toClipCoordinates);
  appendVertex(
    buffer,
    secondRightX,
    secondRightY,
    color,
    alpha,
    toClipCoordinates,
  );
  appendVertex(
    buffer,
    secondLeftX,
    secondLeftY,
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
  const points: Point[] = [];
  const corners = [
    {
      x: x + radius,
      y: y + radius,
      start: Math.PI,
      end: Math.PI * 1.5,
    },
    {
      x: x + width - radius,
      y: y + radius,
      start: Math.PI * 1.5,
      end: Math.PI * 2,
    },
    {
      x: x + width - radius,
      y: y + height - radius,
      start: 0,
      end: Math.PI / 2,
    },
    {
      x: x + radius,
      y: y + height - radius,
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
        x: corner.x + Math.cos(angle) * radius,
        y: corner.y + Math.sin(angle) * radius,
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
  lineWidth: number,
): void {
  const points = roundedRectanglePoints(x, y, width, height, radius);
  for (let index = 0; index < points.length; index += 1) {
    appendThickLine(
      buffer,
      points[index].x,
      points[index].y,
      points[(index + 1) % points.length].x,
      points[(index + 1) % points.length].y,
      color,
      alpha,
      toClipCoordinates,
      lineWidth,
    );
  }
}

export function appendArrowhead(
  buffer: VertexBuffer,
  tipX: number,
  tipY: number,
  previousX: number,
  previousY: number,
  color: readonly [number, number, number],
  alpha: number,
  toClipCoordinates: (x: number, y: number) => [number, number],
): void {
  const angle = Math.atan2(tipY - previousY, tipX - previousX);
  const halfSpread = Math.PI / 6;
  appendVertex(buffer, tipX, tipY, color, alpha, toClipCoordinates);
  appendVertex(
    buffer,
    tipX - ARROW_SIZE * Math.cos(angle - halfSpread),
    tipY - ARROW_SIZE * Math.sin(angle - halfSpread),
    color,
    alpha,
    toClipCoordinates,
  );
  appendVertex(
    buffer,
    tipX - ARROW_SIZE * Math.cos(angle + halfSpread),
    tipY - ARROW_SIZE * Math.sin(angle + halfSpread),
    color,
    alpha,
    toClipCoordinates,
  );
}

export function appendSmoothPolyline(
  buffer: VertexBuffer,
  points: RoutePoints,
  color: readonly [number, number, number],
  alpha: number,
  toClipCoordinates: (x: number, y: number) => [number, number],
): void {
  let previousX = points[0];
  let previousY = points[1];
  const appendPoint = (x: number, y: number): void => {
    appendThickLine(
      buffer,
      previousX,
      previousY,
      x,
      y,
      color,
      alpha,
      toClipCoordinates,
      EDGE_STROKE_WIDTH,
    );
    previousX = x;
    previousY = y;
  };
  for (let offset = 2; offset < points.length - 2; offset += 2) {
    const currentX = points[offset];
    const currentY = points[offset + 1];
    const previousDistance = Math.hypot(
      currentX - points[offset - 2],
      currentY - points[offset - 1],
    );
    const nextDistance = Math.hypot(
      points[offset + 2] - currentX,
      points[offset + 3] - currentY,
    );
    const radius = Math.min(
      CORNER_RADIUS,
      previousDistance / 2,
      nextDistance / 2,
    );
    const enterX =
      currentX - (radius * (currentX - points[offset - 2])) / previousDistance;
    const enterY =
      currentY - (radius * (currentY - points[offset - 1])) / previousDistance;
    const leaveX =
      currentX + (radius * (points[offset + 2] - currentX)) / nextDistance;
    const leaveY =
      currentY + (radius * (points[offset + 3] - currentY)) / nextDistance;
    appendPoint(enterX, enterY);
    for (let sample = 1; sample <= CURVE_SAMPLE_COUNT; sample += 1) {
      const curveParameter = sample / CURVE_SAMPLE_COUNT;
      const inverse = 1 - curveParameter;
      appendPoint(
        inverse * inverse * enterX +
          2 * inverse * curveParameter * currentX +
          curveParameter * curveParameter * leaveX,
        inverse * inverse * enterY +
          2 * inverse * curveParameter * currentY +
          curveParameter * curveParameter * leaveY,
      );
    }
  }
  appendPoint(points[points.length - 2], points[points.length - 1]);
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
