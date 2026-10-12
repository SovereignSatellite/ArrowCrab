import type { GraphModel, Scope } from "../graph/types.ts";
import {
  TOP_LEVEL_SCOPE_ID,
  subgraphScopeId,
  GRID_UNIT,
  LABEL_BAR_HEIGHT,
  NODE_INNER_GAP,
} from "../../diagram/geometry.ts";
import type { ScopeLayout } from "../../diagram/positions.ts";
import { LayoutGrid } from "./occupancy.ts";
import type { ScopeRouting } from "../../diagram/routing.ts";
import { EdgeRouter } from "./router.ts";
import { repairTrackConflicts, detectCrossings } from "./validation.ts";
import { buildPackedRouting } from "./packing.ts";

function prepareRoutingState(
  model: GraphModel,
  scope: Scope,
  layout: ScopeLayout,
) {
  const layerBottoms = new Map<number, number>();
  for (const [, position] of layout.nodePositions) {
    layerBottoms.set(
      position.y,
      Math.max(layerBottoms.get(position.y) ?? 0, position.y + position.height),
    );
  }
  const layerRows = [...layerBottoms.keys()].sort(
    (left, right) => left - right,
  );
  const routingAreas = [];
  let startRow = 0;
  for (const row of layerRows) {
    routingAreas.push({ startRow, height: row - startRow });
    startRow = layerBottoms.get(row)!;
  }
  routingAreas.push({ startRow, height: layout.gridHeight - startRow });
  return {
    grid: new LayoutGrid(layout.nodePositions),
    nodePositions: layout.nodePositions,
    routingAreas,
    entryPortCount:
      scope.inId === null ? 0 : model.nodeMap.get(scope.inId)!.outputPortCount,
    exitPortCount:
      scope.outId === null ? 0 : model.nodeMap.get(scope.outId)!.inputPortCount,
  };
}

export function computeAllRouting(
  model: GraphModel,
  layoutMap: Map<string, ScopeLayout>,
  expandedNodes: ReadonlySet<number>,
): Map<string, ScopeRouting> {
  const routingMap = new Map<string, ScopeRouting>();
  buildRoutingRecursive(
    TOP_LEVEL_SCOPE_ID,
    model,
    layoutMap,
    expandedNodes,
    routingMap,
    0,
    0,
  );
  return routingMap;
}

function buildRoutingRecursive(
  scopeId: string,
  model: GraphModel,
  layoutMap: Map<string, ScopeLayout>,
  expandedNodes: ReadonlySet<number>,
  routingMap: Map<string, ScopeRouting>,
  offsetX: number,
  offsetY: number,
): void {
  const scope = model.scopeMap.get(scopeId)!;
  const layout = layoutMap.get(scopeId)!;

  const state = prepareRoutingState(model, scope, layout);
  const routedEdgesWithGeometry = new EdgeRouter({
    ...state,
    gridWidth: layout.gridWidth,
    gridHeight: layout.gridHeight,
    offsetX,
    offsetY,
    inId: scope.inId,
    outId: scope.outId,
  }).run(scope.edges);
  repairTrackConflicts(routedEdgesWithGeometry, state.routingAreas, offsetY);
  const crossings = detectCrossings(routedEdgesWithGeometry);
  const packedRouting = buildPackedRouting(routedEdgesWithGeometry);
  const routedEdges = routedEdgesWithGeometry.map(({ edge }) => edge);
  routingMap.set(scopeId, {
    routedEdges,
    crossings,
    ...packedRouting,
  });

  for (const nodeId of scope.nodeIds) {
    const node = model.nodeMap.get(nodeId)!;
    if (!expandedNodes.has(nodeId)) continue;
    const position = layout.nodePositions.get(nodeId)!;

    const nodePixelX = offsetX + position.x * GRID_UNIT;
    const nodePixelY = offsetY + position.y * GRID_UNIT;
    const subgraphAreaY =
      nodePixelY + (LABEL_BAR_HEIGHT + NODE_INNER_GAP) * GRID_UNIT;
    let currentSubgraphX = nodePixelX + NODE_INNER_GAP * GRID_UNIT;
    for (const subgraph of node.subgraphs) {
      const childScopeId = subgraphScopeId(subgraph.inId, subgraph.outId);
      const childLayout = layoutMap.get(childScopeId)!;
      buildRoutingRecursive(
        childScopeId,
        model,
        layoutMap,
        expandedNodes,
        routingMap,
        currentSubgraphX,
        subgraphAreaY,
      );
      currentSubgraphX +=
        childLayout.gridWidth * GRID_UNIT + NODE_INNER_GAP * GRID_UNIT;
    }
  }
}
