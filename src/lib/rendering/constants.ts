export const GRID_UNIT = 12;

export const MIN_NODE_WIDTH = 4;

export const PORT_SPACING = 2;

export const LEAF_NODE_HEIGHT = 3;

export const MIN_CHANNEL_SIZE = 3;

export const LANE_SPACING = 1;

export const LABEL_BAR_HEIGHT = 2;

export const NODE_INNER_GAP = 1;

export const CORNER_RADIUS = 4;

export const NODE_STROKE_WIDTH = 2;

export const EDGE_STROKE_WIDTH = 2;

export const FRAME_STROKE_WIDTH = 1;

export const CROSSING_CIRCLE_RADIUS = 3;

export const CROSSING_CIRCLE_WIDTH = 1;

export const LABEL_CHAR_WIDTH = 7;

export const LABEL_PADDING = 12;

export const NODE_HORIZONTAL_PADDING = 2;

export const ROUTING_PADDING = 1;

export function gridAlignedPortOffset(portIndex: number): number {
  return PORT_SPACING * portIndex + PORT_SPACING / 2;
}

export function portOffset(
  containerWidth: number,
  portIndex: number,
  portCount: number,
): number {
  if (portCount <= 0) {
    return containerWidth / 2;
  }
  const clampedIndex = Math.min(portIndex, portCount - 1);
  return (containerWidth / portCount) * (clampedIndex + 0.5);
}
