import { roundedRect, outlinedText, circle } from "./canvas-primitives";
import { GRID_UNIT, portOffset } from "./canvas-constants";
import { darkenColor } from "./color-utils";

export interface DrawSubgraphFrameOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Used to derive the border stroke color. */
  parentColor: string;
  /** Numeric label for multi-subgraph compound nodes. */
  label?: string | null;
}

export interface DrawBoundaryPortsOptions {
  x: number;
  y: number;
  frameWidthGU: number;
  portCount: number;
  side: "top" | "bottom";
  parentColor: string;
  /** Explicit X offsets in GU (relative to frame left). Overrides equal spacing. */
  portXOffsetsGU?: number[];
}

const FRAME_CORNER_RADIUS = 2;
const FRAME_STROKE_DARKEN = 0.1;
const FRAME_BACKGROUND = "#141414";
const FRAME_LINE_WIDTH = 1;
const LABEL_FONT = "bold 10px sans-serif";
const LABEL_COLOR = "#aaaaaa";
const PORT_CIRCLE_RADIUS = 3;
const PORT_OUTER_OFFSET = 0;
const PORT_FILL = "#1c2030";

/**
 * Draw the bordered rectangle that frames a subgraph.
 * Fills with the background color so child content can be drawn on top.
 */
export function drawSubgraphFrame(
  context: CanvasRenderingContext2D,
  options: DrawSubgraphFrameOptions,
): void {
  const { x, y, width, height, parentColor } = options;

  roundedRect(context, x, y, width, height, FRAME_CORNER_RADIUS);
  context.fillStyle = FRAME_BACKGROUND;
  context.fill();
  context.strokeStyle = darkenColor(parentColor, FRAME_STROKE_DARKEN);
  context.lineWidth = FRAME_LINE_WIDTH;
  context.stroke();

  if (options.label != null) {
    outlinedText(context, options.label, x + 6, y + 10, {
      font: LABEL_FONT,
      fillStyle: LABEL_COLOR,
      textAlign: "left",
      textBaseline: "top",
    });
  }
}

/** Draw boundary port circles just outside the top or bottom edge of a subgraph frame. */
export function drawBoundaryPorts(
  context: CanvasRenderingContext2D,
  options: DrawBoundaryPortsOptions,
): void {
  const isTop = options.side === "top";
  let offsetY: number;
  if (isTop) {
    offsetY = PORT_OUTER_OFFSET;
  } else {
    offsetY = -PORT_OUTER_OFFSET;
  }

  for (let i = 0; i < options.portCount; i += 1) {
    let centerX: number;
    if (
      options.portXOffsetsGU &&
      i < options.portXOffsetsGU.length &&
      options.portXOffsetsGU[i] >= 0
    ) {
      centerX = options.x + options.portXOffsetsGU[i] * GRID_UNIT;
    } else {
      centerX =
        options.x +
        portOffset(options.frameWidthGU, i, options.portCount) * GRID_UNIT;
    }
    const centerY = options.y + offsetY;

    circle(context, centerX, centerY, PORT_CIRCLE_RADIUS);
    context.fillStyle = PORT_FILL;
    context.fill();
    context.strokeStyle = darkenColor(options.parentColor, FRAME_STROKE_DARKEN);
    context.lineWidth = FRAME_LINE_WIDTH;
    context.stroke();
  }
}
