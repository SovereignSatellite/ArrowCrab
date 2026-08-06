import { roundedRect, outlinedText, circle } from "./canvas-primitives";
import { FRAME_STROKE_WIDTH, GRID_UNIT, portOffset } from "./constants";
import { darkenColor } from "./colors";

interface DrawSubgraphFrameOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  parentColor: string;
  label?: string | null;
  drawBody?: boolean;
}

interface DrawBoundaryPortsOptions {
  x: number;
  y: number;
  frameWidthGridUnits: number;
  portCount: number;
  side: "top" | "bottom";
  parentColor: string;
  portXOffsetsGridUnits?: number[];
}

const FRAME_CORNER_RADIUS = 2;
const FRAME_STROKE_DARKEN = 0.1;
const FRAME_BACKGROUND = "#141414";
const LABEL_FONT = "bold 10px sans-serif";
const LABEL_COLOR = "#aaaaaa";
const PORT_CIRCLE_RADIUS = 3;
const PORT_OUTER_OFFSET = 0;
const PORT_FILL = "#1c2030";

export function drawSubgraphFrame(
  context: CanvasRenderingContext2D,
  options: DrawSubgraphFrameOptions,
): void {
  const { x, y, width, height, parentColor } = options;

  if (options.drawBody !== false) {
    roundedRect(context, x, y, width, height, FRAME_CORNER_RADIUS);
    context.fillStyle = FRAME_BACKGROUND;
    context.fill();
    context.strokeStyle = darkenColor(parentColor, FRAME_STROKE_DARKEN);
    context.lineWidth = FRAME_STROKE_WIDTH;
    context.stroke();
  }

  if (options.label != null) {
    outlinedText(context, options.label, x + 6, y + 10, {
      font: LABEL_FONT,
      fillStyle: LABEL_COLOR,
      textAlign: "left",
      textBaseline: "top",
    });
  }
}

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

  for (let portIndex = 0; portIndex < options.portCount; portIndex += 1) {
    let centerX: number;
    if (
      options.portXOffsetsGridUnits &&
      portIndex < options.portXOffsetsGridUnits.length &&
      options.portXOffsetsGridUnits[portIndex] >= 0
    ) {
      centerX =
        options.x + options.portXOffsetsGridUnits[portIndex] * GRID_UNIT;
    } else {
      centerX =
        options.x +
        portOffset(options.frameWidthGridUnits, portIndex, options.portCount) *
          GRID_UNIT;
    }
    const centerY = options.y + offsetY;

    circle(context, centerX, centerY, PORT_CIRCLE_RADIUS);
    context.fillStyle = PORT_FILL;
    context.fill();
    context.strokeStyle = darkenColor(options.parentColor, FRAME_STROKE_DARKEN);
    context.lineWidth = FRAME_STROKE_WIDTH;
    context.stroke();
  }
}
