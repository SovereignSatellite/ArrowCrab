import type { DrawingContext } from "./context.ts";
import { roundedRect, fillText, circle } from "./canvas-primitives.ts";
import { GRID_UNIT, portOffset } from "../diagram/geometry.ts";
import { FRAME_STROKE_WIDTH } from "./styles.ts";
import type { ColorPalette } from "./colors.ts";

interface DrawSubgraphFrameOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  parentColor: string;
}

interface DrawBoundaryPortsOptions {
  x: number;
  y: number;
  frameWidthGridUnits: number;
  portCount: number;
  parentColor: string;
}

const FRAME_CORNER_RADIUS = 2;
const FRAME_STROKE_DARKEN = 0.1;
const FRAME_BACKGROUND = "#141414";
const LABEL_FONT = "bold 10px sans-serif";
const LABEL_COLOR = "#aaaaaa";
const PORT_CIRCLE_RADIUS = 3;
const PORT_FILL = "#1c2030";

export function drawSubgraphFrame(
  context: DrawingContext,
  colors: ColorPalette,
  options: DrawSubgraphFrameOptions,
): void {
  const { x, y, width, height, parentColor } = options;

  roundedRect(context, x, y, width, height, FRAME_CORNER_RADIUS);
  context.fillStyle = FRAME_BACKGROUND;
  context.fill();
  context.strokeStyle = colors.darkenColor(parentColor, FRAME_STROKE_DARKEN);
  context.lineWidth = FRAME_STROKE_WIDTH;
  context.stroke();
}

export function drawSubgraphLabel(
  context: DrawingContext,
  label: string,
  frameX: number,
  frameY: number,
): void {
  fillText(context, label, frameX + 6, frameY + 10, {
    font: LABEL_FONT,
    fillStyle: LABEL_COLOR,
    textAlign: "left",
    textBaseline: "top",
  });
}

export function drawBoundaryPorts(
  context: DrawingContext,
  colors: ColorPalette,
  options: DrawBoundaryPortsOptions,
): void {
  for (let portIndex = 0; portIndex < options.portCount; portIndex += 1) {
    const centerX =
      options.x +
      portOffset(options.frameWidthGridUnits, portIndex, options.portCount) *
        GRID_UNIT;
    const centerY = options.y;

    circle(context, centerX, centerY, PORT_CIRCLE_RADIUS);
    context.fillStyle = PORT_FILL;
    context.fill();
    context.strokeStyle = colors.darkenColor(
      options.parentColor,
      FRAME_STROKE_DARKEN,
    );
    context.lineWidth = FRAME_STROKE_WIDTH;
    context.stroke();
  }
}
