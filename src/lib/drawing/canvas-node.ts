import type { TextBaseline, DrawingContext } from "./context.ts";

import { roundedRect, outlinedText, circle } from "./canvas-primitives.ts";
import {
  GRID_UNIT,
  gridAlignedPortOffset,
  PORT_SPACING,
} from "../diagram/geometry.ts";
import {
  NODE_STROKE_WIDTH,
  NODE_LABEL_FONT,
  NODE_LABEL_OUTLINE_WIDTH,
} from "./styles.ts";
import type { ColorPalette } from "./colors.ts";
import type { VisibleRect } from "./types.ts";
import type { DiagramNode } from "../diagram/graph.ts";

interface DrawNodeDetailsOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  node: DiagramNode;
  visibleRect: VisibleRect;
}

interface DrawPortsOptions {
  x: number;
  y: number;
  portCount: number;
  labelSide: "above" | "below";
  color: string;
  visibleRect: VisibleRect;
}

const NODE_CORNER_RADIUS = 3;
const NODE_STROKE_DARKEN = 0.3;
const PORT_CIRCLE_RADIUS = 3;
const PORT_FILL = "#1c2030";

const ID_BADGE_FONT = "9px monospace";
const PORT_LABEL_FONT = "7px monospace";
const TOGGLE_FONT = "bold 10px monospace";

export function drawNodeBody(
  context: DrawingContext,
  colors: ColorPalette,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
): void {
  roundedRect(context, x, y, width, height, NODE_CORNER_RADIUS);
  context.fillStyle = color;
  context.fill();
  context.strokeStyle = colors.darkenColor(color, NODE_STROKE_DARKEN);
  context.lineWidth = NODE_STROKE_WIDTH;
  context.stroke();
}

export function drawLeafNodeDetails(
  context: DrawingContext,
  colors: ColorPalette,
  options: DrawNodeDetailsOptions,
): void {
  const { x, y, width, height, node } = options;
  outlinedText(context, node.label, x + width / 2, y + height / 2, {
    font: NODE_LABEL_FONT,
    fillStyle: "#ffffff",
    strokeStyle: "#000000",
    strokeWidth: NODE_LABEL_OUTLINE_WIDTH,
    textAlign: "center",
    textBaseline: "middle",
  });

  outlinedText(context, String(node.id), x + width + 3, y - 2, {
    font: ID_BADGE_FONT,
    fillStyle: "#dddddd",
    strokeStyle: "#000000",
    strokeWidth: 1,
    textAlign: "left",
    textBaseline: "bottom",
  });

  if (node.subgraphs.length > 0) {
    outlinedText(context, "[+]", x + 4, y + 4, {
      font: TOGGLE_FONT,
      fillStyle: "#eeeeee",
      strokeStyle: "#000000",
      strokeWidth: 1,
      textAlign: "left",
      textBaseline: "top",
    });
  }

  if (node.inputPortCount > 0) {
    drawPorts(context, colors, {
      x,
      y,
      portCount: node.inputPortCount,
      labelSide: "above",
      color: node.color,
      visibleRect: options.visibleRect,
    });
  }
  if (node.outputPortCount > 0) {
    drawPorts(context, colors, {
      x,
      y: y + height,
      portCount: node.outputPortCount,
      labelSide: "below",
      color: node.color,
      visibleRect: options.visibleRect,
    });
  }
}

export function drawPorts(
  context: DrawingContext,
  colors: ColorPalette,
  options: DrawPortsOptions,
): void {
  const isAbove = options.labelSide === "above";
  const portLabelHalfWidth = (String(options.portCount).length * 7) / 2 + 2;
  const portSpacing = PORT_SPACING * GRID_UNIT;
  const firstPortIndex = Math.max(
    0,
    Math.ceil(
      (options.visibleRect.left -
        portLabelHalfWidth -
        options.x -
        gridAlignedPortOffset(0) * GRID_UNIT) /
        portSpacing,
    ),
  );
  const lastPortIndex = Math.min(
    options.portCount - 1,
    Math.floor(
      (options.visibleRect.right +
        portLabelHalfWidth -
        options.x -
        gridAlignedPortOffset(0) * GRID_UNIT) /
        portSpacing,
    ),
  );
  for (
    let portIndex = firstPortIndex;
    portIndex <= lastPortIndex;
    portIndex += 1
  ) {
    const centerX = options.x + gridAlignedPortOffset(portIndex) * GRID_UNIT;
    const centerY = options.y;

    circle(context, centerX, centerY, PORT_CIRCLE_RADIUS);
    context.fillStyle = PORT_FILL;
    context.fill();
    context.strokeStyle = colors.darkenColor(options.color, NODE_STROKE_DARKEN);
    context.lineWidth = NODE_STROKE_WIDTH;
    context.stroke();

    let labelY: number;
    if (isAbove) {
      labelY = centerY - PORT_CIRCLE_RADIUS - 3;
    } else {
      labelY = centerY + PORT_CIRCLE_RADIUS + 3;
    }
    let baseline: TextBaseline;
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
