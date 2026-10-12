import type { Edge, Node } from "../graph/types.ts";
import {
  subgraphScopeId,
  MIN_NODE_WIDTH,
  PORT_SPACING,
  LEAF_NODE_HEIGHT,
  NODE_INNER_GAP,
  LABEL_BAR_HEIGHT,
  LABEL_CHAR_WIDTH,
  LABEL_PADDING,
  NODE_HORIZONTAL_PADDING,
  GRID_UNIT,
} from "../../diagram/geometry.ts";
import type { ScopeLayout, NodePosition } from "../../diagram/positions.ts";
import { routingAreaHeight } from "../routing/occupancy.ts";

function computeLeafWidth(node: Node): number {
  const portWidth =
    Math.max(node.inputPortCount, node.outputPortCount) * PORT_SPACING;
  const labelWidth = Math.ceil(
    (node.label.length * LABEL_CHAR_WIDTH + LABEL_PADDING) / GRID_UNIT,
  );
  return Math.max(MIN_NODE_WIDTH, portWidth, labelWidth);
}

export function computeNodeSize(
  node: Node,
  expandedNodes: ReadonlySet<number>,
  layoutMap: Map<string, ScopeLayout>,
): { width: number; height: number } {
  const leafWidth = computeLeafWidth(node);
  if (!expandedNodes.has(node.id)) {
    return { width: leafWidth, height: LEAF_NODE_HEIGHT };
  }

  let totalSubgraphWidth = 0;
  let maximumSubgraphHeight = 0;
  for (const subgraph of node.subgraphs) {
    const child = layoutMap.get(
      subgraphScopeId(subgraph.inId, subgraph.outId),
    )!;
    totalSubgraphWidth += child.gridWidth;
    maximumSubgraphHeight = Math.max(maximumSubgraphHeight, child.gridHeight);
  }

  const separatorCount = node.subgraphs.length - 1;
  return {
    width: Math.max(
      leafWidth,
      totalSubgraphWidth + separatorCount * NODE_INNER_GAP + NODE_INNER_GAP * 2,
    ),
    height: maximumSubgraphHeight + LABEL_BAR_HEIGHT + NODE_INNER_GAP * 2,
  };
}

export function computeRoutingAreaHeights(
  layerCount: number,
  edges: Edge[],
  layerOf: Map<number, number>,
): number[] {
  const laneDemand = new Array<number>(layerCount + 1).fill(1);
  for (const edge of edges) {
    const sourceLayer = layerOf.get(edge.sourceId)!;
    const targetLayer = layerOf.get(edge.targetId)!;
    laneDemand[sourceLayer + 1] += 1;
    if (targetLayer > sourceLayer + 1) laneDemand[targetLayer] += 1;
  }
  return laneDemand.map(routingAreaHeight);
}

interface PlacementResult {
  nodePositions: Map<number, NodePosition>;
  gridWidth: number;
  gridHeight: number;
}

export function placeNodesOnGrid(
  layers: number[][],
  nodeWidths: Map<number, number>,
  nodeHeights: Map<number, number>,
  routingAreaHeights: number[],
  edges: Edge[],
  layerOf: Map<number, number>,
  preferredX: Map<number, number>,
): PlacementResult {
  const nodePositions = new Map<number, NodePosition>();

  let longEdgeCount = 0;
  for (const edge of edges) {
    if (layerOf.get(edge.targetId)! - layerOf.get(edge.sourceId)! > 1) {
      longEdgeCount += 1;
    }
  }
  const verticalChannelReserve = Math.max(2, longEdgeCount);

  const layerWidths = layers.map((layer) => {
    let width = NODE_HORIZONTAL_PADDING * 2;
    for (let index = 0; index < layer.length; index += 1) {
      width += nodeWidths.get(layer[index])!;
      if (index < layer.length - 1) {
        width += NODE_HORIZONTAL_PADDING * 2 + verticalChannelReserve;
      }
    }
    return width;
  });
  let maximumLayerWidth = MIN_NODE_WIDTH + NODE_HORIZONTAL_PADDING * 2;
  for (const layerWidth of layerWidths) {
    maximumLayerWidth = Math.max(maximumLayerWidth, layerWidth);
  }
  const gridWidth = maximumLayerWidth + verticalChannelReserve * 2;

  let currentRow = 0;
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    currentRow += routingAreaHeights[layerIndex];

    const layer = layers[layerIndex];
    let layerHeight = LEAF_NODE_HEIGHT;
    for (const nodeId of layer) {
      layerHeight = Math.max(layerHeight, nodeHeights.get(nodeId)!);
    }
    const layerOffset = Math.floor((gridWidth - layerWidths[layerIndex]) / 2);
    const firstPreferredX = preferredX.get(layer[0])!;
    let column = layerOffset + NODE_HORIZONTAL_PADDING;
    for (let index = 0; index < layer.length; index += 1) {
      const nodeId = layer[index];
      const width = nodeWidths.get(nodeId)!;
      const height = nodeHeights.get(nodeId)!;
      const preferredColumn =
        layerOffset +
        NODE_HORIZONTAL_PADDING +
        Math.round(preferredX.get(nodeId)! - firstPreferredX);
      column = Math.max(column, preferredColumn);
      nodePositions.set(nodeId, {
        x: column,
        y: currentRow,
        width,
        height,
      });
      column += width;
      if (index < layer.length - 1) {
        column += NODE_HORIZONTAL_PADDING * 2 + verticalChannelReserve;
      }
    }
    currentRow += layerHeight;
  }

  currentRow += routingAreaHeights[layers.length];

  return {
    nodePositions,
    gridWidth,
    gridHeight: currentRow,
  };
}
