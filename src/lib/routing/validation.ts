import type { Point } from "../geometry/types";
import type { RoutingArea } from "./occupancy";
import type { RoutedEdge } from "./types";
import { GRID_UNIT } from "../rendering/constants";

interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  edgeIndex: number;
}

interface HorizontalTrackSegment extends Segment {
  areaIndex: number;
  pointIndex: number;
  row: number;
  minX: number;
  maxX: number;
}

interface RouteCrossing {
  horizontal: HorizontalTrackSegment;
  vertical: Segment;
}

function collectRouteSegments(
  routedEdges: RoutedEdge[],
  routingAreas: RoutingArea[],
  offsetY: number,
): { horizontals: HorizontalTrackSegment[]; verticals: Segment[] } {
  const horizontals: HorizontalTrackSegment[] = [];
  const verticals: Segment[] = [];
  for (let edgeIndex = 0; edgeIndex < routedEdges.length; edgeIndex += 1) {
    const points = routedEdges[edgeIndex].waypoints;
    if (!points) continue;
    for (let pointIndex = 0; pointIndex < points.length - 1; pointIndex += 1) {
      const first = points[pointIndex];
      const second = points[pointIndex + 1];
      if (first.y === second.y && first.x !== second.x) {
        const row = Math.round((first.y - offsetY) / GRID_UNIT);
        const areaIndex =
          routingAreas.length === 0
            ? 0
            : routingAreas.findIndex(
                (area) =>
                  row >= area.startRow && row < area.startRow + area.height,
              );
        if (areaIndex >= 0) {
          horizontals.push({
            x1: first.x,
            y1: first.y,
            x2: second.x,
            y2: second.y,
            edgeIndex,
            areaIndex,
            pointIndex,
            row,
            minX: Math.min(first.x, second.x),
            maxX: Math.max(first.x, second.x),
          });
        }
      } else if (first.x === second.x && first.y !== second.y) {
        verticals.push({
          x1: first.x,
          y1: first.y,
          x2: second.x,
          y2: second.y,
          edgeIndex,
        });
      }
    }
  }
  return { horizontals, verticals };
}

function findRouteCrossings(
  routedEdges: RoutedEdge[],
  routingAreas: RoutingArea[],
  offsetY: number,
): RouteCrossing[] {
  const { horizontals, verticals } = collectRouteSegments(
    routedEdges,
    routingAreas,
    offsetY,
  );
  verticals.sort(
    (left, right) => left.x1 - right.x1 || left.edgeIndex - right.edgeIndex,
  );
  const crossings: RouteCrossing[] = [];
  for (const horizontal of horizontals) {
    let low = 0;
    let high = verticals.length;
    while (low < high) {
      const middle = low + ((high - low) >> 1);
      if (verticals[middle].x1 <= horizontal.minX) low = middle + 1;
      else high = middle;
    }
    for (let index = low; index < verticals.length; index += 1) {
      const vertical = verticals[index];
      if (vertical.x1 >= horizontal.maxX) break;
      if (vertical.edgeIndex === horizontal.edgeIndex) continue;
      const minY = Math.min(vertical.y1, vertical.y2);
      const maxY = Math.max(vertical.y1, vertical.y2);
      if (horizontal.y1 <= minY || horizontal.y1 >= maxY) continue;
      crossings.push({ horizontal, vertical });
    }
  }
  return crossings;
}

function hasHorizontalConflict(
  segments: HorizontalTrackSegment[],
  areaIndex: number,
  row: number,
  minX: number,
  maxX: number,
  first: HorizontalTrackSegment,
  second: HorizontalTrackSegment,
): boolean {
  return segments.some(
    (segment) =>
      segment !== first &&
      segment !== second &&
      segment.areaIndex === areaIndex &&
      segment.row === row &&
      segment.minX < maxX &&
      minX < segment.maxX,
  );
}

export function repairTrackConflicts(
  routedEdges: RoutedEdge[],
  routingAreas: RoutingArea[],
  offsetY: number,
): void {
  let crossings = findRouteCrossings(routedEdges, routingAreas, offsetY);
  while (crossings.length > 0) {
    const { horizontals } = collectRouteSegments(
      routedEdges,
      routingAreas,
      offsetY,
    );
    const byRouteAndArea = new Map<string, HorizontalTrackSegment[]>();
    for (const segment of horizontals) {
      const key = `${segment.edgeIndex}:${segment.areaIndex}`;
      const list = byRouteAndArea.get(key);
      if (list) list.push(segment);
      else byRouteAndArea.set(key, [segment]);
    }
    const rowsByArea = new Map<number, number[]>();
    for (const segment of horizontals) {
      const rows = rowsByArea.get(segment.areaIndex);
      if (rows) {
        if (!rows.includes(segment.row)) rows.push(segment.row);
      } else {
        rowsByArea.set(segment.areaIndex, [segment.row]);
      }
    }
    for (const rows of rowsByArea.values())
      rows.sort((left, right) => left - right);

    let repaired = false;
    for (const crossing of crossings) {
      const first = crossing.horizontal;
      const candidates = byRouteAndArea.get(
        `${crossing.vertical.edgeIndex}:${first.areaIndex}`,
      );
      const second = candidates?.find(
        (candidate) => candidate.row !== first.row,
      );
      if (!second) continue;
      const rows = rowsByArea.get(first.areaIndex) ?? [];
      if (
        Math.abs(rows.indexOf(first.row) - rows.indexOf(second.row)) !== 1 ||
        hasHorizontalConflict(
          horizontals,
          first.areaIndex,
          second.row,
          first.minX,
          first.maxX,
          first,
          second,
        ) ||
        hasHorizontalConflict(
          horizontals,
          first.areaIndex,
          first.row,
          second.minX,
          second.maxX,
          first,
          second,
        )
      ) {
        continue;
      }

      const firstRoute = routedEdges[first.edgeIndex].waypoints;
      const secondRoute = routedEdges[second.edgeIndex].waypoints;
      if (!firstRoute || !secondRoute) continue;
      const firstRow = first.row;
      const secondRow = second.row;
      const firstY = offsetY + secondRow * GRID_UNIT;
      const secondY = offsetY + firstRow * GRID_UNIT;
      firstRoute[first.pointIndex].y = firstY;
      firstRoute[first.pointIndex + 1].y = firstY;
      secondRoute[second.pointIndex].y = secondY;
      secondRoute[second.pointIndex + 1].y = secondY;

      const nextCrossings = findRouteCrossings(
        routedEdges,
        routingAreas,
        offsetY,
      );
      if (nextCrossings.length < crossings.length) {
        crossings = nextCrossings;
        repaired = true;
        break;
      }

      firstRoute[first.pointIndex].y = offsetY + firstRow * GRID_UNIT;
      firstRoute[first.pointIndex + 1].y = offsetY + firstRow * GRID_UNIT;
      secondRoute[second.pointIndex].y = offsetY + secondRow * GRID_UNIT;
      secondRoute[second.pointIndex + 1].y = offsetY + secondRow * GRID_UNIT;
    }
    if (!repaired) break;
  }
}

export function detectCrossings(routedEdges: RoutedEdge[]): Point[] {
  const horizontals: Segment[] = [];
  const verticals: Segment[] = [];
  for (let edgeIndex = 0; edgeIndex < routedEdges.length; edgeIndex += 1) {
    const points = routedEdges[edgeIndex].waypoints;
    if (!points) continue;
    for (let pointIndex = 0; pointIndex < points.length - 1; pointIndex += 1) {
      const first = points[pointIndex];
      const second = points[pointIndex + 1];
      if (first.y === second.y && first.x !== second.x) {
        horizontals.push({
          x1: first.x,
          y1: first.y,
          x2: second.x,
          y2: second.y,
          edgeIndex,
        });
      } else if (first.x === second.x && first.y !== second.y) {
        verticals.push({
          x1: first.x,
          y1: first.y,
          x2: second.x,
          y2: second.y,
          edgeIndex,
        });
      }
    }
  }

  verticals.sort(
    (left, right) => left.x1 - right.x1 || left.edgeIndex - right.edgeIndex,
  );
  const crossings = new Map<string, Point>();
  for (const horizontal of horizontals) {
    const minX = Math.min(horizontal.x1, horizontal.x2);
    const maxX = Math.max(horizontal.x1, horizontal.x2);
    let firstCandidate = 0;
    let candidateLimit = verticals.length;
    while (firstCandidate < candidateLimit) {
      const middle = Math.floor((firstCandidate + candidateLimit) / 2);
      if (verticals[middle].x1 <= minX) {
        firstCandidate = middle + 1;
      } else {
        candidateLimit = middle;
      }
    }
    for (
      let verticalIndex = firstCandidate;
      verticalIndex < verticals.length;
      verticalIndex += 1
    ) {
      const vertical = verticals[verticalIndex];
      if (vertical.x1 >= maxX) {
        break;
      }
      if (vertical.edgeIndex === horizontal.edgeIndex) {
        continue;
      }
      const verticalMinY = Math.min(vertical.y1, vertical.y2);
      const verticalMaxY = Math.max(vertical.y1, vertical.y2);
      if (horizontal.y1 <= verticalMinY || horizontal.y1 >= verticalMaxY) {
        continue;
      }
      const key = `${vertical.x1}:${horizontal.y1}`;
      crossings.set(key, { x: vertical.x1, y: horizontal.y1 });
    }
  }
  return [...crossings.values()];
}
