import type { Edge } from "../graph/types";
import type { Point } from "../geometry/types";
import type { TilePyramid } from "../scene/tile-pyramid";

export interface RoutedEdge {
  edge: Edge;
  waypoints?: Point[];
  colorIndex: number;
  key: string;
}

export interface ScopeRouting {
  routedEdges: RoutedEdge[];
  crossings: Point[];
  routeOffsets: Uint32Array;
  routePoints: Float64Array;
  routeBounds: Float64Array;
  edgeTileIndex: TilePyramid<number>;
  crossingTileIndex: TilePyramid<number>;
}
