/** Pixels per grid unit - the universal scaling factor. */
export const GRID_UNIT = 12;

/** Minimum node width (grid units). */
export const MIN_NODE_WIDTH = 4;

/** Horizontal spacing between ports (grid units). */
export const PORT_SPACING = 2;

/** Height of a leaf (non-compound) node (grid units). */
export const LEAF_NODE_HEIGHT = 3;

/** Minimum vertical gap between layers (grid units). */
export const MIN_CHANNEL_SIZE = 3;

/** Vertical spacing between edge routing lanes (grid units). */
export const LANE_SPACING = 1;

/** Height of the label bar in expanded compound nodes (grid units). */
export const LABEL_BAR_HEIGHT = 2;

/** Inner gap within compound nodes (grid units). */
export const NODE_INNER_GAP = 1;

/** Corner radius for smooth edge paths (pixels). */
export const CORNER_RADIUS = 4;

/** Radius of the hollow circle drawn where edges cross (pixels). */
export const CROSSING_CIRCLE_RADIUS = 3;

/** Stroke width of the crossing circle (pixels). */
export const CROSSING_CIRCLE_WIDTH = 1;

/** Approximate width of a single character in label text (pixels). */
export const LABEL_CHAR_WIDTH = 7;

/** Horizontal padding around label text (pixels). */
export const LABEL_PADDING = 12;

/** Horizontal padding on each side of a node (grid units). */
export const NODE_HORIZONTAL_PADDING = 2;

/** Padding above/below the horizontal lane area between layers (grid units). */
export const ROUTING_PADDING = 1;

/**
 * Compute the grid-aligned horizontal offset of a port (grid units).
 * Ports land on integer grid coordinates: 1, 3, 5, ... (PORT_SPACING * i + PORT_SPACING / 2).
 */
export function gridAlignedPortOffset(portIndex: number): number {
  return PORT_SPACING * portIndex + PORT_SPACING / 2;
}

/**
 * Compute the horizontal offset of a port within a container (grid units).
 * Centers ports evenly across the container width.
 */
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
