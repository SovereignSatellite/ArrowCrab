import type { Edge } from "../graph/types";

type CellOccupant =
  | { kind: "h-lane"; edgeKey: string }
  | { kind: "v-lane"; edgeKey: string }
  | { kind: "padding" };

export interface PlacedNode {
  nodeId: number;
  column: number;
  row: number;
  width: number;
  height: number;
  layer: number;
}

export interface RoutingArea {
  startRow: number;
  height: number;
  laneCount: number;
  firstLaneRow: number;
}

/** Include `edgeIndex` so parallel edges with identical endpoints and ports remain distinct. */
export function edgeKey(edge: Edge): string {
  return `${edge.sourceId}:${edge.sourcePort}:${edge.targetId}:${edge.targetPort}:${edge.edgeIndex}`;
}

interface Interval {
  start: number;
  end: number;
  occupant: CellOccupant;
}

interface NodeRect {
  column: number;
  row: number;
  width: number;
  height: number;
}

function positiveOverlapLength(
  firstStart: number,
  firstEnd: number,
  secondStart: number,
  secondEnd: number,
): number {
  return Math.max(
    0,
    Math.min(firstEnd, secondEnd) - Math.max(firstStart, secondStart),
  );
}

function copyIntervals(
  source: Map<number, Interval[]>,
): Map<number, Interval[]> {
  const copy = new Map<number, Interval[]>();
  for (const [key, intervals] of source) {
    copy.set(
      key,
      intervals.map((interval) => ({ ...interval })),
    );
  }
  return copy;
}

function copyPortHandleIntervals(
  source: Map<number, Map<number, Interval[]>>,
): Map<number, Map<number, Interval[]>> {
  const copy = new Map<number, Map<number, Interval[]>>();
  for (const [areaIndex, columns] of source) {
    copy.set(areaIndex, copyIntervals(columns));
  }
  return copy;
}

/** Store lane intervals sparsely so long routes do not allocate one record per grid cell. */
export class LayoutGrid {
  private horizontalIntervals = new Map<number, Interval[]>();
  private verticalIntervals = new Map<number, Interval[]>();
  private nonPortVerticalIntervals = new Map<number, Interval[]>();
  private portHandleIntervals = new Map<number, Map<number, Interval[]>>();
  private nodeRects: NodeRect[] = [];

  markNodeRect(
    column: number,
    row: number,
    width: number,
    height: number,
  ): void {
    this.nodeRects.push({ column, row, width, height });
  }

  markHorizontal(
    row: number,
    columnStart: number,
    columnEnd: number,
    occupant: CellOccupant,
  ): void {
    this.addInterval(
      this.horizontalIntervals,
      row,
      Math.min(columnStart, columnEnd),
      Math.max(columnStart, columnEnd),
      occupant,
    );
  }

  markVertical(
    column: number,
    rowStart: number,
    rowEnd: number,
    occupant: CellOccupant,
  ): void {
    const minRow = Math.min(rowStart, rowEnd);
    const maxRow = Math.max(rowStart, rowEnd);
    this.addInterval(this.verticalIntervals, column, minRow, maxRow, occupant);
    if (
      occupant.kind === "v-lane" &&
      !occupant.edgeKey.startsWith("port-handle:") &&
      !occupant.edgeKey.startsWith("port-reservation:")
    ) {
      this.addInterval(
        this.nonPortVerticalIntervals,
        column,
        minRow,
        maxRow,
        occupant,
      );
    }
  }

  markVerticalColumn(column: number, rowStart: number, rowEnd: number): void {
    this.addMergedInterval(
      this.verticalIntervals,
      column,
      Math.min(rowStart, rowEnd),
      Math.max(rowStart, rowEnd),
      { kind: "padding" },
    );
  }

  markPortHandle(
    areaIndex: number,
    column: number,
    rowStart: number,
    rowEnd: number,
    occupant: CellOccupant,
  ): void {
    this.markVertical(column, rowStart, rowEnd, occupant);
    let areaIntervals = this.portHandleIntervals.get(areaIndex);
    if (!areaIntervals) {
      areaIntervals = new Map<number, Interval[]>();
      this.portHandleIntervals.set(areaIndex, areaIntervals);
    }
    this.addInterval(
      areaIntervals,
      column,
      Math.min(rowStart, rowEnd),
      Math.max(rowStart, rowEnd),
      occupant,
    );
  }

  columnOverlapCost(column: number, rowStart: number, rowEnd: number): number {
    const minRow = Math.min(rowStart, rowEnd);
    const maxRow = Math.max(rowStart, rowEnd);
    if (
      this.nodeRects.some(
        (rect) =>
          column >= rect.column &&
          column < rect.column + rect.width &&
          rect.row <= maxRow &&
          rect.row + rect.height - 1 >= minRow,
      )
    ) {
      return Number.POSITIVE_INFINITY;
    }
    let cost = 0;
    for (const interval of this.verticalIntervals.get(column) ?? []) {
      cost += positiveOverlapLength(
        minRow,
        maxRow,
        interval.start,
        interval.end,
      );
    }
    return cost;
  }

  portHandleOverlapCost(
    areaIndex: number,
    column: number,
    rowStart: number,
    rowEnd: number,
  ): number {
    const minRow = Math.min(rowStart, rowEnd);
    const maxRow = Math.max(rowStart, rowEnd);
    const handleKey = `port-handle:${column}:${rowStart}`;
    let cost = 0;
    for (const interval of this.nonPortVerticalIntervals.get(column) ?? []) {
      cost += positiveOverlapLength(
        minRow,
        maxRow,
        interval.start,
        interval.end,
      );
    }
    for (const interval of this.portHandleIntervals
      .get(areaIndex)
      ?.get(column) ?? []) {
      if (
        interval.occupant.kind === "v-lane" &&
        interval.occupant.edgeKey !== handleKey
      ) {
        cost += positiveOverlapLength(
          minRow,
          maxRow,
          interval.start,
          interval.end,
        );
      }
    }
    return cost;
  }

  clone(): LayoutGrid {
    const copy = new LayoutGrid();
    copy.horizontalIntervals = copyIntervals(this.horizontalIntervals);
    copy.verticalIntervals = copyIntervals(this.verticalIntervals);
    copy.nonPortVerticalIntervals = copyIntervals(
      this.nonPortVerticalIntervals,
    );
    copy.portHandleIntervals = copyPortHandleIntervals(
      this.portHandleIntervals,
    );
    copy.nodeRects = this.nodeRects.map((rectangle) => ({ ...rectangle }));
    return copy;
  }

  private addInterval(
    target: Map<number, Interval[]>,
    key: number,
    start: number,
    end: number,
    occupant: CellOccupant,
  ): void {
    const intervals = target.get(key);
    const interval = { start, end, occupant };
    if (intervals) {
      intervals.push(interval);
    } else {
      target.set(key, [interval]);
    }
  }

  private addMergedInterval(
    target: Map<number, Interval[]>,
    key: number,
    start: number,
    end: number,
    occupant: CellOccupant,
  ): void {
    const intervals = target.get(key);
    if (!intervals || intervals.length === 0) {
      target.set(key, [{ start, end, occupant }]);
      return;
    }
    const last = intervals[intervals.length - 1];
    if (last.end + 1 >= start) {
      last.end = Math.max(last.end, end);
      return;
    }
    intervals.push({ start, end, occupant });
  }
}
