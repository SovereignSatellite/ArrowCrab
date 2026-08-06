import type { Point } from "../geometry/types";
import { TilePyramid, tileEntry } from "../scene/tile-pyramid";
import type { RoutedEdge, ScopeRouting } from "./types";

function routeBounds(
  waypoints: readonly Point[],
): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of waypoints) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return [minX, minY, maxX, maxY];
}

export function buildPackedRoutingIndexes(
  routeOffsets: Uint32Array,
  routePoints: Float64Array,
  routeBoundsArray: Float64Array,
  crossings: Point[],
): Omit<ScopeRouting, "routedEdges" | "crossings"> {
  const edgeTileEntries = [];
  const routeCount = routeOffsets.length - 1;
  for (let edgeIndex = 0; edgeIndex < routeCount; edgeIndex += 1) {
    const bounds = routeBoundsArray.subarray(edgeIndex * 4, edgeIndex * 4 + 4);
    edgeTileEntries.push(
      tileEntry(edgeIndex, bounds[0], bounds[1], bounds[2], bounds[3]),
    );
  }

  const crossingTileEntries = [];
  for (
    let crossingIndex = 0;
    crossingIndex < crossings.length;
    crossingIndex += 1
  ) {
    const crossing = crossings[crossingIndex];
    crossingTileEntries.push(
      tileEntry(crossingIndex, crossing.x, crossing.y, crossing.x, crossing.y),
    );
  }

  return {
    routeOffsets,
    routePoints,
    routeBounds: routeBoundsArray,
    edgeTileIndex: new TilePyramid(edgeTileEntries, 240),
    crossingTileIndex: new TilePyramid(crossingTileEntries, 240),
  };
}

export function buildPackedRouting(
  routedEdges: RoutedEdge[],
  crossings: Point[],
): Omit<ScopeRouting, "routedEdges" | "crossings"> {
  const routeOffsets = new Uint32Array(routedEdges.length + 1);
  const routeBoundsArray = new Float64Array(routedEdges.length * 4);
  let pointCount = 0;
  for (let index = 0; index < routedEdges.length; index += 1) {
    const waypoints = routedEdges[index].waypoints;
    if (!waypoints) throw new Error("Route geometry is missing during packing");
    pointCount += waypoints.length;
    routeOffsets[index + 1] = pointCount;
    const bounds = routeBounds(waypoints);
    routeBoundsArray.set(bounds, index * 4);
  }

  const routePoints = new Float64Array(pointCount * 2);
  for (let edgeIndex = 0; edgeIndex < routedEdges.length; edgeIndex += 1) {
    const waypoints = routedEdges[edgeIndex].waypoints;
    if (!waypoints) throw new Error("Route geometry is missing during packing");
    const pointOffset = routeOffsets[edgeIndex] * 2;
    for (let pointIndex = 0; pointIndex < waypoints.length; pointIndex += 1) {
      routePoints[pointOffset + pointIndex * 2] = waypoints[pointIndex].x;
      routePoints[pointOffset + pointIndex * 2 + 1] = waypoints[pointIndex].y;
    }
  }
  return buildPackedRoutingIndexes(
    routeOffsets,
    routePoints,
    routeBoundsArray,
    crossings,
  );
}
