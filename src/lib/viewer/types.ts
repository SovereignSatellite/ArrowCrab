import type { Edge, GraphModel } from "../engine/graph/types.ts";
import type { ScopeLayout } from "../diagram/positions.ts";
import type { Diagram } from "../diagram/index.ts";
import type {
  DrawingResult,
  DrawingSurface,
  ViewTransform,
} from "../drawing/types.ts";

export interface GlobalAdjacency {
  successors: Map<number, number[]>;
  predecessors: Map<number, number[]>;
}

export interface ViewerState {
  context: CanvasRenderingContext2D;
  model: GraphModel;
  layoutMap: Map<string, ScopeLayout>;
  diagram: Diagram;
  drawing: DrawingSurface;
  regions: DrawingResult;
  expandedNodes: Set<number>;
  viewport: ViewTransform;
  selectedNodes: Set<number>;
  selectedEdges: Map<number, Edge>;
  highlightedNodes: Set<number>;
  highlightedEdges: Set<number>;
  cachedAdjacency: GlobalAdjacency | null;
}
