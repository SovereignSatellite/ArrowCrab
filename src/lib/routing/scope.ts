import type { GraphModel, Scope } from "../graph/types";
import { TOP_LEVEL_SCOPE_ID, subgraphScopeId } from "../graph/scopes";
import type { ScopeLayout } from "../layout/types";
import { NodePositionLookup } from "../layout/types";
import { LayoutGrid, type RoutingArea } from "./occupancy";
import type { ScopeRouting } from "./types";
import { EdgeRouter } from "./router";
import { repairTrackConflicts, detectCrossings } from "./validation";
import { buildPackedRouting } from "./packing";
import {
  GRID_UNIT,
  LABEL_BAR_HEIGHT,
  NODE_INNER_GAP,
  ROUTING_PADDING,
} from "../rendering/constants";

interface RoutingState {
  grid: LayoutGrid;
  nodePositions: NodePositionLookup;
  routingAreas: RoutingArea[];
  outputPortCounts: Map<number, number>;
  inputPortCounts: Map<number, number>;
  layerOf: Map<number, number>;
}

function prepareRoutingState(scope: Scope, layout: ScopeLayout): RoutingState {
  const outputPortCounts = new Map<number, number>();
  const inputPortCounts = new Map<number, number>();
  for (const edge of scope.edges) {
    outputPortCounts.set(
      edge.sourceId,
      Math.max(outputPortCounts.get(edge.sourceId) ?? 0, edge.sourcePort + 1),
    );
    inputPortCounts.set(
      edge.targetId,
      Math.max(inputPortCounts.get(edge.targetId) ?? 0, edge.targetPort + 1),
    );
  }

  const routingAreas = layout.channelY.map((startRow, index) => {
    const layerRows =
      index < layout.layers.length
        ? layout.layers[index].map(
            (nodeId) => layout.nodePositions.get(nodeId)!.y,
          )
        : [];
    const layerStart =
      layerRows.length > 0
        ? Math.min(...layerRows)
        : (layout.channelY[index + 1] ?? layout.gridHeight);
    if (layerStart < startRow) {
      throw new Error(`Invalid routing channel boundary at index ${index}`);
    }
    return {
      startRow,
      height: layerStart - startRow,
      laneCount: layout.channelLaneCount[index] ?? 1,
      firstLaneRow: startRow + ROUTING_PADDING,
    };
  });
  return {
    grid: layout.grid.clone(),
    nodePositions: layout.nodePositions,
    routingAreas,
    outputPortCounts,
    inputPortCounts,
    layerOf: layout.layerOf,
  };
}

export function computeAllRouting(
  model: GraphModel,
  layoutMap: Map<string, ScopeLayout>,
  expandedNodes: Set<number>,
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
  expandedNodes: Set<number>,
  routingMap: Map<string, ScopeRouting>,
  offsetX: number,
  offsetY: number,
): void {
  const scope = model.scopeMap.get(scopeId);
  const layout = layoutMap.get(scopeId);
  if (!scope || !layout) return;

  const state = prepareRoutingState(scope, layout);
  const routedEdgesWithGeometry = new EdgeRouter({
    ...state,
    gridWidth: layout.gridWidth,
    gridHeight: layout.gridHeight,
    offsetX,
    offsetY,
    inId: scope.inId,
    outId: scope.outId,
    scopeGridWidth: layout.gridWidth,
  }).run(scope.edges);
  repairTrackConflicts(routedEdgesWithGeometry, state.routingAreas, offsetY);
  const crossings = detectCrossings(routedEdgesWithGeometry);
  const packedRouting = buildPackedRouting(routedEdgesWithGeometry, crossings);
  const routedEdges = routedEdgesWithGeometry.map(
    ({ edge, colorIndex, key }) => ({ edge, colorIndex, key }),
  );
  routingMap.set(scopeId, {
    routedEdges,
    crossings,
    ...packedRouting,
  });

  for (const nodeId of scope.nodeIds) {
    const node = model.nodeMap.get(nodeId)!;
    if (!expandedNodes.has(nodeId) || node.subgraphs.length === 0) continue;
    const position = layout.nodePositions.get(nodeId);
    if (!position) continue;

    const nodePixelX = offsetX + position.x * GRID_UNIT;
    const nodePixelY = offsetY + position.y * GRID_UNIT;
    const subgraphAreaY =
      nodePixelY + (LABEL_BAR_HEIGHT + NODE_INNER_GAP) * GRID_UNIT;
    let currentSubgraphX = nodePixelX + NODE_INNER_GAP * GRID_UNIT;
    for (const subgraph of node.subgraphs) {
      const childScopeId = subgraphScopeId(subgraph.inId, subgraph.outId);
      const childLayout = layoutMap.get(childScopeId);
      if (!childLayout) continue;
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
