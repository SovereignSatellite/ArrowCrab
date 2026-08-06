import { roundedRect, outlinedText, circle } from "./canvas-primitives";
import { GRID_UNIT, NODE_STROKE_WIDTH, portOffset } from "./constants";
import { darkenColor } from "./colors";

interface DrawNodeOptions {
  x: number;
  y: number;
  widthGridUnits: number;
  heightGridUnits: number;
  color: string;
  label: string;
  nodeId: number;
  inputPortCount: number;
  outputPortCount: number;
  isCompound?: boolean;
  isExpanded?: boolean;
  drawBody?: boolean;
  inputPortXOffsetsGridUnits?: number[];
  outputPortXOffsetsGridUnits?: number[];
}

interface DrawPortsOptions {
  x: number;
  y: number;
  containerWidthGridUnits: number;
  portCount: number;
  labelSide: "above" | "below";
  color: string;
  portXOffsetsGridUnits?: number[];
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

export function drawNode(
  context: CanvasRenderingContext2D,
  options: DrawNodeOptions,
): void {
  const width = options.widthGridUnits * GRID_UNIT;
  const height = options.heightGridUnits * GRID_UNIT;
  const { x, y } = options;

  if (options.drawBody !== false) {
    roundedRect(context, x, y, width, height, NODE_CORNER_RADIUS);
    context.fillStyle = options.color;
    context.fill();
    context.strokeStyle = darkenColor(options.color, NODE_STROKE_DARKEN);
    context.lineWidth = NODE_STROKE_WIDTH;
    context.stroke();
  }

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

  if (options.inputPortCount > 0) {
    drawPorts(context, {
      x,
      y,
      containerWidthGridUnits: options.widthGridUnits,
      portCount: options.inputPortCount,
      labelSide: "above",
      color: options.color,
      portXOffsetsGridUnits: options.inputPortXOffsetsGridUnits,
    });
  }
  if (options.outputPortCount > 0) {
    drawPorts(context, {
      x,
      y: y + height,
      containerWidthGridUnits: options.widthGridUnits,
      portCount: options.outputPortCount,
      labelSide: "below",
      color: options.color,
      portXOffsetsGridUnits: options.outputPortXOffsetsGridUnits,
    });
  }
}

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
        portOffset(
          options.containerWidthGridUnits,
          portIndex,
          options.portCount,
        ) *
          GRID_UNIT;
    }
    const centerY = options.y + offsetY;

    circle(context, centerX, centerY, PORT_CIRCLE_RADIUS);
    context.fillStyle = PORT_FILL;
    context.fill();
    context.strokeStyle = darkenColor(options.color, NODE_STROKE_DARKEN);
    context.lineWidth = NODE_STROKE_WIDTH;
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

    outlinedText(context, String(portIndex + 1), centerX, labelY, {
      font: PORT_LABEL_FONT,
      fillStyle: "#dddddd",
      strokeStyle: "#000000",
      strokeWidth: 1,
      textAlign: "center",
      textBaseline: baseline,
    });
  }
}
