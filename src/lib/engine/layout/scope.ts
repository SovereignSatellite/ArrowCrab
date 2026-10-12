import type { GraphModel } from "../graph/types.ts";
import {
  TOP_LEVEL_SCOPE_ID,
  subgraphScopeId,
  MIN_NODE_WIDTH,
  LEAF_NODE_HEIGHT,
} from "../../diagram/geometry.ts";
import {
  NodePositionLookup,
  type ScopeLayout,
} from "../../diagram/positions.ts";
import {
  assignLayers,
  buildScopeSuccessors,
  orderLayers,
} from "./layer-order.ts";
import { computeBrandesKopfCoordinates } from "./coordinates.ts";
import {
  computeNodeSize,
  computeRoutingAreaHeights,
  placeNodesOnGrid,
} from "./placement.ts";

function computeScopeLayout(
  scopeId: string,
  model: GraphModel,
  expandedNodes: ReadonlySet<number>,
  layoutMap: Map<string, ScopeLayout>,
): ScopeLayout {
  const scope = model.scopeMap.get(scopeId)!;
  if (scope.nodeIds.length === 0) {
    const boundaryLayers = new Map<number, number>();
    if (scope.inId !== null) boundaryLayers.set(scope.inId, -1);
    if (scope.outId !== null) boundaryLayers.set(scope.outId, 0);
    return {
      nodePositions: new NodePositionLookup([]),
      gridWidth: MIN_NODE_WIDTH,
      gridHeight: Math.max(
        LEAF_NODE_HEIGHT,
        computeRoutingAreaHeights(0, scope.edges, boundaryLayers)[0],
      ),
    };
  }

  const nodeWidths = new Map<number, number>();
  const nodeHeights = new Map<number, number>();
  for (const nodeId of scope.nodeIds) {
    const node = model.nodeMap.get(nodeId)!;
    const size = computeNodeSize(node, expandedNodes, layoutMap);
    nodeWidths.set(nodeId, size.width);
    nodeHeights.set(nodeId, size.height);
  }

  const { layers, layerOf } = assignLayers(
    scope.nodeIds,
    buildScopeSuccessors(scope.edges),
  );
  const orderedGraph = orderLayers(layers, layerOf, scope.edges);
  const preferredX = computeBrandesKopfCoordinates(orderedGraph);
  if (scope.inId !== null) layerOf.set(scope.inId, -1);
  if (scope.outId !== null) layerOf.set(scope.outId, layers.length);

  const placement = placeNodesOnGrid(
    layers,
    nodeWidths,
    nodeHeights,
    computeRoutingAreaHeights(layers.length, scope.edges, layerOf),
    scope.edges,
    layerOf,
    preferredX,
  );

  return {
    nodePositions: new NodePositionLookup(
      scope.nodeIds.map((nodeId) => [
        nodeId,
        placement.nodePositions.get(nodeId)!,
      ]),
    ),
    gridWidth: placement.gridWidth,
    gridHeight: placement.gridHeight,
  };
}

function buildLayoutBottomUp(
  scopeId: string,
  model: GraphModel,
  expandedNodes: ReadonlySet<number>,
  layoutMap: Map<string, ScopeLayout>,
): void {
  const scope = model.scopeMap.get(scopeId)!;
  for (const nodeId of scope.nodeIds) {
    const node = model.nodeMap.get(nodeId)!;
    if (!expandedNodes.has(nodeId)) continue;
    for (const subgraph of node.subgraphs) {
      const childScopeId = subgraphScopeId(subgraph.inId, subgraph.outId);
      if (!layoutMap.has(childScopeId)) {
        buildLayoutBottomUp(childScopeId, model, expandedNodes, layoutMap);
      }
    }
  }
  layoutMap.set(
    scopeId,
    computeScopeLayout(scopeId, model, expandedNodes, layoutMap),
  );
}

export function computeAllLayouts(
  model: GraphModel,
  expandedNodes: ReadonlySet<number>,
): Map<string, ScopeLayout> {
  const layoutMap = new Map<string, ScopeLayout>();
  buildLayoutBottomUp(TOP_LEVEL_SCOPE_ID, model, expandedNodes, layoutMap);
  return layoutMap;
}

function recomputeLayoutChainUpward(
  scopeId: string,
  model: GraphModel,
  expandedNodes: ReadonlySet<number>,
  layoutMap: Map<string, ScopeLayout>,
): void {
  layoutMap.set(
    scopeId,
    computeScopeLayout(scopeId, model, expandedNodes, layoutMap),
  );
  const scope = model.scopeMap.get(scopeId)!;
  if (scope.parentNodeId !== null) {
    const parentNode = model.nodeMap.get(scope.parentNodeId)!;
    recomputeLayoutChainUpward(
      parentNode.scopeId!,
      model,
      expandedNodes,
      layoutMap,
    );
  }
}

export function toggleNodeExpansion(
  nodeId: number,
  model: GraphModel,
  expandedNodes: Set<number>,
  layoutMap: Map<string, ScopeLayout>,
): void {
  const node = model.nodeMap.get(nodeId)!;
  if (expandedNodes.has(nodeId)) {
    expandedNodes.delete(nodeId);
  } else {
    expandedNodes.add(nodeId);
    for (const subgraph of node.subgraphs) {
      const childScopeId = subgraphScopeId(subgraph.inId, subgraph.outId);
      if (!layoutMap.has(childScopeId)) {
        buildLayoutBottomUp(childScopeId, model, expandedNodes, layoutMap);
      }
    }
  }
  recomputeLayoutChainUpward(node.scopeId!, model, expandedNodes, layoutMap);
}
