import type { Edge } from "./graph.ts";
import type { Point } from "./point.ts";

export type RoutePoints = ArrayLike<number>;

export interface RoutedPolyline {
  edge: Edge;
  waypoints: Point[];
}

export interface ScopeRouting {
  routedEdges: Edge[];
  crossings: Point[];
  routeOffsets: Uint32Array;
  routePoints: Float64Array;
  routeBounds: Float64Array;
}

export function getRoutePoints(
  routing: ScopeRouting,
  routeIndex: number,
): RoutePoints {
  return routing.routePoints.subarray(
    routing.routeOffsets[routeIndex] * 2,
    routing.routeOffsets[routeIndex + 1] * 2,
  );
}
