import type { GraphModel } from "../graph/types";
import { TOP_LEVEL_SCOPE_ID } from "../graph/scopes";
import type { LayoutSnapshot } from "../scene/snapshot";
import { deserializeLayoutSnapshot } from "../scene/snapshot";
import { computeAllRouting } from "../routing/scope";
import { computeAllLayouts } from "../layout/scope";
import { MIN_ZOOM_SCALE } from "../interaction/constants";
import { GRID_UNIT } from "./constants";
import type { WebGLGraphRenderer } from "./webgl-renderer";
import type { GraphScene } from "./scene-types";

export function createScene(
  context: CanvasRenderingContext2D,
  model: GraphModel,
  snapshot?: LayoutSnapshot,
  webglRenderer: WebGLGraphRenderer | null = null,
): GraphScene {
  const expandedNodes = new Set<number>();
  const prepared = snapshot
    ? deserializeLayoutSnapshot(snapshot)
    : (() => {
        const layoutMap = computeAllLayouts(model, expandedNodes);
        const routingMap = computeAllRouting(model, layoutMap, expandedNodes);
        return { layoutMap, routingMap };
      })();
  return {
    context,
    model,
    layoutMap: prepared.layoutMap,
    routingMap: prepared.routingMap,
    expandedNodes,
    viewport: { offsetX: 0, offsetY: 0, scale: 1 },
    toggleRegions: [],
    leafNodeRegions: [],
    expandedNodeRegions: [],
    edgeRegions: [],
    selectedNodes: new Set(),
    selectedEdges: new Set(),
    highlightedNodes: new Set(),
    highlightedEdges: new Set(),
    cachedAdjacency: null,
    webglRenderer,
  };
}

export function centerViewport(scene: GraphScene): void {
  const topLayout = scene.layoutMap.get(TOP_LEVEL_SCOPE_ID)!;
  const graphPixelWidth = topLayout.gridWidth * GRID_UNIT;
  const graphPixelHeight = topLayout.gridHeight * GRID_UNIT;
  const canvas = scene.context.canvas;

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

  scene.viewport.scale = scale;
  scene.viewport.offsetX = (canvas.clientWidth - graphPixelWidth * scale) / 2;
  scene.viewport.offsetY = (canvas.clientHeight - graphPixelHeight * scale) / 2;
}
