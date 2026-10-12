import type { GraphModel } from "../engine/graph/types.ts";
import { createDiagram } from "../engine/diagram.ts";
import { TOP_LEVEL_SCOPE_ID, GRID_UNIT } from "../diagram/geometry.ts";
import {
  deserializeLayoutSnapshot,
  type LayoutSnapshot,
} from "../diagram/index.ts";
import { createDrawing, drawDiagram } from "../drawing/index.ts";
import type { StructuralRenderer } from "../drawing/types.ts";
import { MIN_ZOOM_SCALE } from "./constants.ts";
import type { ViewerState } from "./types.ts";

export function createViewer(
  context: CanvasRenderingContext2D,
  model: GraphModel,
  snapshot: LayoutSnapshot,
  structuralRenderer: StructuralRenderer | null,
): ViewerState {
  const prepared = deserializeLayoutSnapshot(snapshot);
  const colorCanvas = document.createElement("canvas");
  colorCanvas.width = colorCanvas.height = 1;
  return {
    context,
    model,
    layoutMap: prepared.layoutMap,
    diagram: createDiagram(model, prepared.layoutMap, prepared.routingMap),
    drawing: createDrawing(
      context,
      colorCanvas.getContext("2d")!,
      structuralRenderer,
    ),
    regions: { nodes: [], edges: [] },
    expandedNodes: new Set(),
    viewport: { offsetX: 0, offsetY: 0, scale: 1 },
    selectedNodes: new Set(),
    selectedEdges: new Map(),
    highlightedNodes: new Set(),
    highlightedEdges: new Set(),
    cachedAdjacency: null,
  };
}

export function renderViewer(viewer: ViewerState): void {
  const canvas = viewer.context.canvas;
  viewer.regions = drawDiagram(viewer.drawing, viewer.diagram, {
    width: canvas.clientWidth,
    height: canvas.clientHeight,
    pixelRatio: window.devicePixelRatio,
    viewport: viewer.viewport,
    highlightedNodes: viewer.highlightedNodes,
    highlightedEdges: viewer.highlightedEdges,
    background: null,
  });
}

export function centerViewport(viewer: ViewerState): void {
  const topLayout = viewer.diagram.layoutMap.get(TOP_LEVEL_SCOPE_ID)!;
  const graphPixelWidth = topLayout.gridWidth * GRID_UNIT;
  const graphPixelHeight = topLayout.gridHeight * GRID_UNIT;
  const canvas = viewer.context.canvas;
  const padding = 60;
  const availableWidth = canvas.clientWidth - 2 * padding;
  const availableHeight = canvas.clientHeight - 2 * padding;
  const scale = Math.min(
    1.5,
    Math.max(
      MIN_ZOOM_SCALE,
      Math.min(
        availableWidth / graphPixelWidth,
        availableHeight / graphPixelHeight,
      ),
    ),
  );
  viewer.viewport.scale = scale;
  viewer.viewport.offsetX = (canvas.clientWidth - graphPixelWidth * scale) / 2;
  viewer.viewport.offsetY =
    (canvas.clientHeight - graphPixelHeight * scale) / 2;
}
