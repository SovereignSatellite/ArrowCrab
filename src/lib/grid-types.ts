import type { Edge } from "./graph-types";

/** What occupies a grid cell. */
export type CellOccupant =
  | { kind: "node"; nodeId: number }
  | { kind: "h-lane"; edgeKey: string }
  | { kind: "v-lane"; edgeKey: string }
  | { kind: "padding" };

/** Internal node placement record. */
export interface PlacedNode {
  nodeId: number;
  col: number;
  row: number;
  width: number;
  height: number;
  layer: number;
}

/** Describes the horizontal routing area between two layers. */
export interface RoutingArea {
  /** Grid row where this routing area starts. */
  startRow: number;
  /** Total height of this routing area in grid units. */
  height: number;
  /** Number of usable horizontal lane rows. */
  laneCount: number;
  /** Grid row of the first usable lane. */
  firstLaneRow: number;
}

/** Edge key for lane tracking. */
export function edgeKey(edge: Edge): string {
  return `${edge.sourceId}:${edge.sourcePort}:${edge.targetId}:${edge.targetPort}`;
}

// Multiplier must exceed the maximum row value to avoid key collisions.
// 94_906_265 is floor(sqrt(MAX_SAFE_INTEGER)), so both col and row can reach
// this value without the product exceeding MAX_SAFE_INTEGER.
const ROW_MULTIPLIER = 94_906_265;

function gridKey(col: number, row: number): number {
  return col * ROW_MULTIPLIER + row;
}

interface NodeRect {
  col: number;
  row: number;
  width: number;
  height: number;
}

/**
 * Sparse grid data structure for unified node placement and edge routing.
 *
 * Node occupancy is stored as axis-aligned rectangles (O(N) memory regardless
 * of node area), avoiding the V8 Map size limit (~16.7M entries) that would be
 * hit when expanded nodes contain millions of grid cells. Lane marks remain
 * individual cells in a Map since they are sparse.
 */
export class LayoutGrid {
  private lanes = new Map<number, CellOccupant>();
  private nodeRects: NodeRect[] = [];

  /** Register a rectangular node region. O(1) regardless of area. */
  markNodeRect(col: number, row: number, width: number, height: number): void {
    this.nodeRects.push({ col, row, width, height });
  }

  /** Mark a single cell (used for lane marks during routing). */
  mark(col: number, row: number, occupant: CellOccupant): void {
    this.lanes.set(gridKey(col, row), occupant);
  }

  /** Check if an entire column range is free of nodes and lanes (inclusive). */
  isColumnFree(col: number, rowStart: number, rowEnd: number): boolean {
    for (let row = rowStart; row <= rowEnd; row += 1) {
      if (this.lanes.has(gridKey(col, row))) {
        return false;
      }
    }
    for (const rect of this.nodeRects) {
      if (
        col >= rect.col &&
        col < rect.col + rect.width &&
        rect.row <= rowEnd &&
        rect.row + rect.height > rowStart
      ) {
        return false;
      }
    }
    return true;
  }

  /** Check if an entire row range is free of nodes and lanes (inclusive). */
  isRowFree(row: number, colStart: number, colEnd: number): boolean {
    const minCol = Math.min(colStart, colEnd);
    const maxCol = Math.max(colStart, colEnd);
    for (let col = minCol; col <= maxCol; col += 1) {
      if (this.lanes.has(gridKey(col, row))) {
        return false;
      }
    }
    for (const rect of this.nodeRects) {
      if (
        row >= rect.row &&
        row < rect.row + rect.height &&
        rect.col <= maxCol &&
        rect.col + rect.width > minCol
      ) {
        return false;
      }
    }
    return true;
  }

  /** Shallow-copy for routing. Node rects are shared; lane Map is copied. */
  clone(): LayoutGrid {
    const copy = new LayoutGrid();
    copy.lanes = new Map(this.lanes);
    copy.nodeRects = this.nodeRects;
    return copy;
  }
}
