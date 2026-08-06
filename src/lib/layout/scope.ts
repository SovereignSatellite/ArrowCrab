import type { GraphModel } from "../graph/types";
import { TOP_LEVEL_SCOPE_ID, subgraphScopeId } from "../graph/scopes";
import { NodePositionLookup, type ScopeLayout } from "./types";
import { assignLayers, buildScopeSuccessors, orderLayers } from "./layer-order";
import { computeBrandesKopfCoordinates } from "./coordinates";
import {
  computeNodeSize,
  computeRoutingAreaHeights,
  placeNodesOnGrid,
} from "./placement";
import { LayoutGrid } from "../routing/occupancy";
import { TilePyramid, tileEntry } from "../scene/tile-pyramid";
import { MIN_NODE_WIDTH, LEAF_NODE_HEIGHT } from "../rendering/constants";

function computeScopeLayout(
  scopeId: string,
  model: GraphModel,
  expandedNodes: Set<number>,
  layoutMap: Map<string, ScopeLayout>,
): ScopeLayout {
  const scope = model.scopeMap.get(scopeId)!;
  if (scope.nodeIds.length === 0) {
    return {
      nodePositions: new NodePositionLookup([]),
      gridWidth: MIN_NODE_WIDTH,
      gridHeight: LEAF_NODE_HEIGHT,
      channelY: [0],
      channelLaneCount: [1],
      layerOf: new Map(),
      layers: [],
      grid: new LayoutGrid(),
      nodeTileIndex: new TilePyramid([], 20),
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
  const preferredX = computeBrandesKopfCoordinates(
    layers,
    layerOf,
    scope.edges.filter(
      (edge) => layerOf.has(edge.sourceId) && layerOf.has(edge.targetId),
    ),
    orderedGraph,
  );
  const effectiveLayerOf = new Map(layerOf);
  if (scope.inId !== null) effectiveLayerOf.set(scope.inId, -1);
  if (scope.outId !== null) effectiveLayerOf.set(scope.outId, layers.length);

  const placement = placeNodesOnGrid(
    layers,
    nodeWidths,
    nodeHeights,
    computeRoutingAreaHeights(layers.length, scope.edges, effectiveLayerOf),
    scope.edges,
    layerOf,
    preferredX,
  );

  const nodeTileEntries = [];
  for (const [nodeId, position] of placement.nodePositions) {
    nodeTileEntries.push(
      tileEntry(
        nodeId,
        position.x,
        position.y,
        position.x + position.width,
        position.y + position.height,
      ),
    );
  }

  return {
    nodePositions: new NodePositionLookup([
      ...placement.nodePositions.entries(),
    ]),
    gridWidth: placement.gridWidth,
    gridHeight: placement.gridHeight,
    channelY: placement.channelY,
    channelLaneCount: placement.routingAreas.map((area) => area.laneCount),
    layerOf,
    layers,
    grid: placement.grid,
    nodeTileIndex: new TilePyramid(nodeTileEntries, 20),
  };
}

function buildLayoutBottomUp(
  scopeId: string,
  model: GraphModel,
  expandedNodes: Set<number>,
  layoutMap: Map<string, ScopeLayout>,
): void {
  const scope = model.scopeMap.get(scopeId);
  if (!scope) return;
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
  expandedNodes: Set<number>,
): Map<string, ScopeLayout> {
  const layoutMap = new Map<string, ScopeLayout>();
  buildLayoutBottomUp(TOP_LEVEL_SCOPE_ID, model, expandedNodes, layoutMap);
  return layoutMap;
}

function recomputeLayoutChainUpward(
  scopeId: string,
  model: GraphModel,
  expandedNodes: Set<number>,
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
      parentNode.scopeId,
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
  const node = model.nodeMap.get(nodeId);
  if (!node) return;
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
  recomputeLayoutChainUpward(node.scopeId, model, expandedNodes, layoutMap);
}
