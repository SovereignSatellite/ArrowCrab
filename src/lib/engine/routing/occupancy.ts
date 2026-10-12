import type { Edge } from "../graph/types.ts";
import type { NodePositionLookup } from "../../diagram/positions.ts";
import {
  MIN_CHANNEL_SIZE,
  ROUTING_PADDING,
  LANE_SPACING,
} from "../../diagram/geometry.ts";

export interface RoutingArea {
  startRow: number;
  height: number;
}

export function routingAreaHeight(laneDemand: number): number {
  return Math.max(
    MIN_CHANNEL_SIZE,
    ROUTING_PADDING * 2 + laneDemand * LANE_SPACING,
  );
}

export function routingAreaIndex(
  areas: readonly RoutingArea[],
  row: number,
): number {
  let low = 0;
  let high = areas.length;
  while (low < high) {
    const middle = low + ((high - low) >> 1);
    if (areas[middle].startRow <= row) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}

export function edgeKey(edge: Edge): string {
  return `${edge.sourceId}:${edge.sourcePort}:${edge.targetId}:${edge.targetPort}:${edge.edgeIndex}`;
}

interface Interval {
  start: number;
  end: number;
}

type VerticalInterval = Interval &
  ({ kind: "route" } | { kind: "handle"; areaIndex: number; edgeRow: number });

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

export class LayoutGrid {
  private readonly nodePositions: NodePositionLookup;
  private readonly reservations = new Map<number, Interval[]>();
  private readonly verticalIntervals = new Map<number, VerticalInterval[]>();

  constructor(nodePositions: NodePositionLookup) {
    this.nodePositions = nodePositions;
  }

  markVerticalRoute(column: number, rowStart: number, rowEnd: number): void {
    this.addVerticalInterval(column, {
      start: Math.min(rowStart, rowEnd),
      end: Math.max(rowStart, rowEnd),
      kind: "route",
    });
  }

  reservePortColumn(column: number, rowStart: number, rowEnd: number): void {
    const intervals = this.reservations.get(column);
    let start = Math.min(rowStart, rowEnd);
    let end = Math.max(rowStart, rowEnd);
    if (!intervals) {
      this.reservations.set(column, [{ start, end }]);
      return;
    }

    let low = 0;
    let high = intervals.length;
    while (low < high) {
      const middle = low + ((high - low) >> 1);
      if (intervals[middle].end + 1 < start) low = middle + 1;
      else high = middle;
    }
    const first = low;
    while (low < intervals.length && intervals[low].start <= end + 1) {
      start = Math.min(start, intervals[low].start);
      end = Math.max(end, intervals[low].end);
      low += 1;
    }
    intervals.splice(first, low - first, { start, end });
  }

  markPortHandle(
    areaIndex: number,
    column: number,
    edgeRow: number,
    laneRow: number,
  ): void {
    this.addVerticalInterval(column, {
      start: Math.min(edgeRow, laneRow),
      end: Math.max(edgeRow, laneRow),
      kind: "handle",
      areaIndex,
      edgeRow,
    });
  }

  columnOverlapCost(column: number, rowStart: number, rowEnd: number): number {
    const minRow = Math.min(rowStart, rowEnd);
    const maxRow = Math.max(rowStart, rowEnd);
    if (this.nodePositions.intersectsColumn(column, minRow, maxRow)) {
      return Number.POSITIVE_INFINITY;
    }
    let cost = 0;
    for (const interval of this.reservations.get(column) ?? []) {
      cost += positiveOverlapLength(
        minRow,
        maxRow,
        interval.start,
        interval.end,
      );
    }
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
    edgeRow: number,
    laneRow: number,
  ): number {
    const minRow = Math.min(edgeRow, laneRow);
    const maxRow = Math.max(edgeRow, laneRow);
    let cost = 0;
    for (const interval of this.verticalIntervals.get(column) ?? []) {
      if (
        interval.kind === "route" ||
        (interval.areaIndex === areaIndex && interval.edgeRow !== edgeRow)
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

  private addVerticalInterval(
    column: number,
    interval: VerticalInterval,
  ): void {
    const intervals = this.verticalIntervals.get(column);
    if (intervals) intervals.push(interval);
    else this.verticalIntervals.set(column, [interval]);
  }
}
