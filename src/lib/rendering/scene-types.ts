import type { Edge, GraphModel } from "../graph/types";
import type { ScopeLayout } from "../layout/types";
import type { ScopeRouting } from "../routing/types";
import type { Point } from "../geometry/types";
import type { WebGLGraphRenderer } from "./webgl-renderer";

interface HitRegion {
  nodeId: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface EdgeHitRegion {
  edgeKey: string;
  edge: Edge;
  waypoints: readonly Point[];
}

export interface GlobalAdjacency {
  successors: Map<number, number[]>;
  predecessors: Map<number, number[]>;
  allEdges: Edge[];
}

export interface GraphScene {
  context: CanvasRenderingContext2D;
  model: GraphModel;
  layoutMap: Map<string, ScopeLayout>;
  routingMap: Map<string, ScopeRouting>;
  expandedNodes: Set<number>;
  viewport: { offsetX: number; offsetY: number; scale: number };
  toggleRegions: HitRegion[];
  leafNodeRegions: HitRegion[];
  expandedNodeRegions: HitRegion[];
  edgeRegions: EdgeHitRegion[];
  selectedNodes: Set<number>;
  selectedEdges: Set<string>;
  highlightedNodes: Set<number>;
  highlightedEdges: Set<string>;
  cachedAdjacency: GlobalAdjacency | null;
  webglRenderer: WebGLGraphRenderer | null;
}

export interface VisibleRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
