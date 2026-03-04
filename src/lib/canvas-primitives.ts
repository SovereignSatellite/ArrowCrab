/**
 * Trace a rounded rectangle path. Does not fill or stroke -
 * the caller decides how to render it.
 */
export function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const clampedRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + clampedRadius, y);
  context.lineTo(x + width - clampedRadius, y);
  context.arcTo(x + width, y, x + width, y + clampedRadius, clampedRadius);
  context.lineTo(x + width, y + height - clampedRadius);
  context.arcTo(
    x + width,
    y + height,
    x + width - clampedRadius,
    y + height,
    clampedRadius,
  );
  context.lineTo(x + clampedRadius, y + height);
  context.arcTo(x, y + height, x, y + height - clampedRadius, clampedRadius);
  context.lineTo(x, y + clampedRadius);
  context.arcTo(x, y, x + clampedRadius, y, clampedRadius);
  context.closePath();
}

export interface TextStyle {
  font: string;
  fillStyle: string;
  /** Draws a stroke outline behind the fill (paint-order: stroke) for readability. */
  strokeStyle?: string;
  strokeWidth?: number;
  textAlign?: CanvasTextAlign;
  textBaseline?: CanvasTextBaseline;
}

// Track current canvas text state to avoid redundant (expensive) font changes.
let currentFont = "";
let currentTextAlign: CanvasTextAlign = "start";
let currentTextBaseline: CanvasTextBaseline = "alphabetic";

/** Reset tracked font state (call if context is replaced). */
export function resetTextState(): void {
  currentFont = "";
  currentTextAlign = "start";
  currentTextBaseline = "alphabetic";
}

/**
 * Draw text with an optional stroke outline for readability on colored backgrounds.
 * Strokes first, then fills, mimicking SVG `paint-order: stroke fill`.
 */
export function outlinedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  style: TextStyle,
): void {
  const font = style.font;
  const textAlign = style.textAlign ?? "center";
  const textBaseline = style.textBaseline ?? "middle";

  if (font !== currentFont) {
    context.font = font;
    currentFont = font;
  }
  if (textAlign !== currentTextAlign) {
    context.textAlign = textAlign;
    currentTextAlign = textAlign;
  }
  if (textBaseline !== currentTextBaseline) {
    context.textBaseline = textBaseline;
    currentTextBaseline = textBaseline;
  }

  if (style.strokeStyle) {
    context.strokeStyle = style.strokeStyle;
    context.lineWidth = style.strokeWidth ?? 1.8;
    context.lineJoin = "round";
    context.strokeText(text, x, y);
  }

  context.fillStyle = style.fillStyle;
  context.fillText(text, x, y);
}

/**
 * Trace a triangular arrowhead path pointing in the given direction.
 * Does not fill or stroke.
 *
 * @param angle Direction the arrow points (radians; 0 = right, π/2 = down).
 * @param size  Distance from tip to base corners.
 */
export function arrowhead(
  context: CanvasRenderingContext2D,
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

/** Trace a circle path. Does not fill or stroke. */
export function circle(
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radius: number,
): void {
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
}

/** Trace a circle and stroke it (no fill) - used for edge-crossing markers. */
export function hollowCircle(
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radius: number,
  strokeColor: string,
  lineWidth: number = 1.5,
): void {
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
  context.strokeStyle = strokeColor;
  context.lineWidth = lineWidth;
  context.stroke();
}

/**
 * Trace a smooth path through waypoints using quadratic Bézier curves
 * at corners. Does not stroke or fill.
 */
export function smoothPath(
  context: CanvasRenderingContext2D,
  points: ReadonlyArray<{ x: number; y: number }>,
  cornerRadius: number,
): void {
  if (points.length < 2) {
    return;
  }

  context.beginPath();

  if (points.length === 2) {
    context.moveTo(points[0].x, points[0].y);
    context.lineTo(points[1].x, points[1].y);
    return;
  }

  context.moveTo(points[0].x, points[0].y);

  for (let i = 1; i < points.length - 1; i += 1) {
    const previous = points[i - 1];
    const current = points[i];
    const next = points[i + 1];

    const distanceToPrevious = Math.hypot(
      current.x - previous.x,
      current.y - previous.y,
    );
    const distanceToNext = Math.hypot(next.x - current.x, next.y - current.y);

    // Clamp so the curve doesn't overshoot either segment.
    const clampedRadius = Math.min(
      cornerRadius,
      distanceToPrevious / 2,
      distanceToNext / 2,
    );

    const enterX =
      current.x -
      (clampedRadius * (current.x - previous.x)) / distanceToPrevious;
    const enterY =
      current.y -
      (clampedRadius * (current.y - previous.y)) / distanceToPrevious;
    const leaveX =
      current.x + (clampedRadius * (next.x - current.x)) / distanceToNext;
    const leaveY =
      current.y + (clampedRadius * (next.y - current.y)) / distanceToNext;

    context.lineTo(enterX, enterY);
    context.quadraticCurveTo(current.x, current.y, leaveX, leaveY);
  }

  const last = points[points.length - 1];
  context.lineTo(last.x, last.y);
}
