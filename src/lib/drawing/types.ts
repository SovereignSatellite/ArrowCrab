import type { Diagram, Edge } from "../diagram/index.ts";
import type { RoutePoints } from "../diagram/routing.ts";
import type { DrawingContext } from "./context.ts";
import type { ColorPalette } from "./colors.ts";
import type { ScopeRenderIndex } from "./scope-index.ts";

export interface ViewTransform {
  offsetX: number;
  offsetY: number;
  scale: number;
}

export interface DrawingOptions {
  width: number;
  height: number;
  pixelRatio: number;
  viewport: ViewTransform;
  highlightedNodes: ReadonlySet<number>;
  highlightedEdges: ReadonlySet<number>;
  background: string | null;
}

export interface DrawnNode {
  nodeId: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DrawnEdge {
  edge: Edge;
  points: RoutePoints;
}

export interface DrawingResult {
  nodes: DrawnNode[];
  edges: DrawnEdge[];
}

export interface StructuralRenderer {
  render(frame: DrawingFrame, visibleRect: VisibleRect): void;
}

export interface DrawingSurface {
  context: DrawingContext;
  colors: ColorPalette;
  structuralRenderer: StructuralRenderer | null;
  scopeIndexes: Map<string, ScopeRenderIndex>;
  indexedDiagram: Diagram | null;
}

export interface DrawingFrame extends Diagram, DrawingOptions, DrawingResult {
  context: DrawingContext;
  colors: ColorPalette;
  structuralRenderer: StructuralRenderer | null;
  scopeIndexes: Map<string, ScopeRenderIndex>;
}

export interface VisibleRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
