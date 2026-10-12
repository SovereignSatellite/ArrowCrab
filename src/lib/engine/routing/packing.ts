import type { RoutedPolyline, ScopeRouting } from "../../diagram/routing.ts";

export function buildPackedRouting(
  routedEdges: RoutedPolyline[],
): Omit<ScopeRouting, "routedEdges" | "crossings"> {
  const routeOffsets = new Uint32Array(routedEdges.length + 1);
  let pointCount = 0;
  for (let index = 0; index < routedEdges.length; index += 1) {
    pointCount += routedEdges[index].waypoints.length;
    routeOffsets[index + 1] = pointCount;
  }

  const routePoints = new Float64Array(pointCount * 2);
  const routeBounds = new Float64Array(routedEdges.length * 4);
  for (let edgeIndex = 0; edgeIndex < routedEdges.length; edgeIndex += 1) {
    const waypoints = routedEdges[edgeIndex].waypoints;
    const pointOffset = routeOffsets[edgeIndex] * 2;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let pointIndex = 0; pointIndex < waypoints.length; pointIndex += 1) {
      const { x, y } = waypoints[pointIndex];
      routePoints[pointOffset + pointIndex * 2] = x;
      routePoints[pointOffset + pointIndex * 2 + 1] = y;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    routeBounds[edgeIndex * 4] = minX;
    routeBounds[edgeIndex * 4 + 1] = minY;
    routeBounds[edgeIndex * 4 + 2] = maxX;
    routeBounds[edgeIndex * 4 + 3] = maxY;
  }
  return { routeOffsets, routePoints, routeBounds };
}
