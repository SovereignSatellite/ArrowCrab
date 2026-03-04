import { roundedRect, outlinedText, circle } from "./canvas-primitives";
import { GRID_UNIT, portOffset } from "./canvas-constants";
import { darkenColor } from "./color-utils";

export interface DrawNodeOptions {
  x: number;
  y: number;
  /** Dimensions in grid units (scaled by GRID_UNIT internally). */
  widthGU: number;
  heightGU: number;
  color: string;
  label: string;
  nodeId: number;
  portCountIn: number;
  portCountOut: number;
  isCompound?: boolean;
  isExpanded?: boolean;
  /** Explicit input port X offsets in GU (relative to node left). */
  portInXOffsetsGU?: number[];
  /** Explicit output port X offsets in GU (relative to node left). */
  portOutXOffsetsGU?: number[];
}

export interface DrawPortsOptions {
  x: number;
  y: number;
  containerWidthGU: number;
  portCount: number;
  labelSide: "above" | "below";
  color: string;
  /** Explicit X offsets in GU (relative to container left). Overrides equal spacing. */
  portXOffsetsGU?: number[];
}

const NODE_CORNER_RADIUS = 3;
const NODE_STROKE_DARKEN = 0.3;
const PORT_CIRCLE_RADIUS = 3;
const PORT_OUTER_OFFSET = 0;
const PORT_FILL = "#1c2030";

const LABEL_FONT = "bold 11px sans-serif";
const ID_BADGE_FONT = "9px monospace";
const PORT_LABEL_FONT = "7px monospace";
const TOGGLE_FONT = "bold 10px monospace";

/**
 * Draw a complete node: body, stroke, label, ID badge, ports, and
 * (optionally) a compound-node toggle button.
 */
export function drawNode(
  context: CanvasRenderingContext2D,
  options: DrawNodeOptions,
): void {
  const width = options.widthGU * GRID_UNIT;
  const height = options.heightGU * GRID_UNIT;
  const { x, y } = options;

  roundedRect(context, x, y, width, height, NODE_CORNER_RADIUS);
  context.fillStyle = options.color;
  context.fill();
  context.strokeStyle = darkenColor(options.color, NODE_STROKE_DARKEN);
  context.lineWidth = 1.5;
  context.stroke();

  outlinedText(context, options.label, x + width / 2, y + height / 2, {
    font: LABEL_FONT,
    fillStyle: "#ffffff",
    strokeStyle: "#000000",
    strokeWidth: 1.8,
  });

  outlinedText(context, String(options.nodeId), x + width + 3, y - 2, {
    font: ID_BADGE_FONT,
    fillStyle: "#dddddd",
    strokeStyle: "#000000",
    strokeWidth: 1,
    textAlign: "left",
    textBaseline: "bottom",
  });

  if (options.isCompound) {
    let toggleLabel: string;
    if (options.isExpanded) {
      toggleLabel = "[\u2212]";
    } else {
      toggleLabel = "[+]";
    }
    outlinedText(context, toggleLabel, x + 4, y + 4, {
      font: TOGGLE_FONT,
      fillStyle: "#eeeeee",
      strokeStyle: "#000000",
      strokeWidth: 1,
      textAlign: "left",
      textBaseline: "top",
    });
  }

  if (options.portCountIn > 0) {
    drawPorts(context, {
      x,
      y,
      containerWidthGU: options.widthGU,
      portCount: options.portCountIn,
      labelSide: "above",
      color: options.color,
      portXOffsetsGU: options.portInXOffsetsGU,
    });
  }
  if (options.portCountOut > 0) {
    drawPorts(context, {
      x,
      y: y + height,
      containerWidthGU: options.widthGU,
      portCount: options.portCountOut,
      labelSide: "below",
      color: options.color,
      portXOffsetsGU: options.portOutXOffsetsGU,
    });
  }
}

/** Draw a row of port circles evenly spaced, offset just outside a horizontal edge. */
export function drawPorts(
  context: CanvasRenderingContext2D,
  options: DrawPortsOptions,
): void {
  const isAbove = options.labelSide === "above";
  let offsetY: number;
  if (isAbove) {
    offsetY = -PORT_OUTER_OFFSET;
  } else {
    offsetY = PORT_OUTER_OFFSET;
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
        portOffset(options.containerWidthGU, i, options.portCount) * GRID_UNIT;
    }
    const centerY = options.y + offsetY;

    circle(context, centerX, centerY, PORT_CIRCLE_RADIUS);
    context.fillStyle = PORT_FILL;
    context.fill();
    context.strokeStyle = darkenColor(options.color, NODE_STROKE_DARKEN);
    context.lineWidth = 1.5;
    context.stroke();

    let labelY: number;
    if (isAbove) {
      labelY = centerY - PORT_CIRCLE_RADIUS - 3;
    } else {
      labelY = centerY + PORT_CIRCLE_RADIUS + 3;
    }
    let baseline: CanvasTextBaseline;
    if (isAbove) {
      baseline = "bottom";
    } else {
      baseline = "top";
    }

    outlinedText(context, String(i + 1), centerX, labelY, {
      font: PORT_LABEL_FONT,
      fillStyle: "#dddddd",
      strokeStyle: "#000000",
      strokeWidth: 1,
      textAlign: "center",
      textBaseline: baseline,
    });
  }
}
