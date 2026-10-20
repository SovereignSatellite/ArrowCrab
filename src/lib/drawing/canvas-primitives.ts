import type { RoutePoints } from "../diagram/routing.ts";
import type { TextAlignment, TextBaseline, DrawingContext } from "./context.ts";

export function roundedRect(
  context: DrawingContext,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.arcTo(x + width, y, x + width, y + radius, radius);
  context.lineTo(x + width, y + height - radius);
  context.arcTo(x + width, y + height, x + width - radius, y + height, radius);
  context.lineTo(x + radius, y + height);
  context.arcTo(x, y + height, x, y + height - radius, radius);
  context.lineTo(x, y + radius);
  context.arcTo(x, y, x + radius, y, radius);
  context.closePath();
}

interface TextStyle {
  font: string;
  fillStyle: string;
  textAlign: TextAlignment;
  textBaseline: TextBaseline;
}

interface OutlinedTextStyle extends TextStyle {
  strokeStyle: string;
  strokeWidth: number;
}

function applyTextStyle(context: DrawingContext, style: TextStyle): void {
  if (context.font !== style.font) context.font = style.font;
  if (context.textAlign !== style.textAlign)
    context.textAlign = style.textAlign;
  if (context.textBaseline !== style.textBaseline)
    context.textBaseline = style.textBaseline;
  context.fillStyle = style.fillStyle;
}

export function fillText(
  context: DrawingContext,
  text: string,
  x: number,
  y: number,
  style: TextStyle,
): void {
  applyTextStyle(context, style);
  context.fillText(text, x, y);
}

export function outlinedText(
  context: DrawingContext,
  text: string,
  x: number,
  y: number,
  style: OutlinedTextStyle,
): void {
  applyTextStyle(context, style);
  context.strokeStyle = style.strokeStyle;
  context.lineWidth = style.strokeWidth;
  context.lineJoin = "round";
  context.strokeText(text, x, y);
  context.fillText(text, x, y);
}

export function arrowhead(
  context: DrawingContext,
  tipX: number,
  tipY: number,
  angle: number,
  size: number,
): void {
  const halfSpread = Math.PI / 6;
  const baseLeftX = tipX - size * Math.cos(angle - halfSpread);
  const baseLeftY = tipY - size * Math.sin(angle - halfSpread);
  const baseRightX = tipX - size * Math.cos(angle + halfSpread);
  const baseRightY = tipY - size * Math.sin(angle + halfSpread);

  context.beginPath();
  context.moveTo(tipX, tipY);
  context.lineTo(baseLeftX, baseLeftY);
  context.lineTo(baseRightX, baseRightY);
  context.closePath();
}

export function circle(
  context: DrawingContext,
  centerX: number,
  centerY: number,
  radius: number,
): void {
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
}

export function smoothPath(
  context: DrawingContext,
  points: RoutePoints,
  cornerRadius: number,
): void {
  context.beginPath();
  context.moveTo(points[0], points[1]);
  for (let offset = 2; offset < points.length - 2; offset += 2) {
    const previousX = points[offset - 2];
    const previousY = points[offset - 1];
    const currentX = points[offset];
    const currentY = points[offset + 1];
    const nextX = points[offset + 2];
    const nextY = points[offset + 3];
    const distanceToPrevious = Math.hypot(
      currentX - previousX,
      currentY - previousY,
    );
    const distanceToNext = Math.hypot(nextX - currentX, nextY - currentY);
    const radius = Math.min(
      cornerRadius,
      distanceToPrevious / 2,
      distanceToNext / 2,
    );
    const enterX =
      currentX - (radius * (currentX - previousX)) / distanceToPrevious;
    const enterY =
      currentY - (radius * (currentY - previousY)) / distanceToPrevious;
    const leaveX = currentX + (radius * (nextX - currentX)) / distanceToNext;
    const leaveY = currentY + (radius * (nextY - currentY)) / distanceToNext;
    context.lineTo(enterX, enterY);
    context.quadraticCurveTo(currentX, currentY, leaveX, leaveY);
  }
  context.lineTo(points[points.length - 2], points[points.length - 1]);
}
