import type { Edge, Node } from "../graph/types";
import { subgraphScopeId } from "../graph/scopes";
import type { ScopeLayout, NodePosition } from "./types";
import { LayoutGrid, type RoutingArea } from "../routing/occupancy";
import {
  MIN_NODE_WIDTH,
  PORT_SPACING,
  LEAF_NODE_HEIGHT,
  MIN_CHANNEL_SIZE,
  LANE_SPACING,
  NODE_INNER_GAP,
  LABEL_BAR_HEIGHT,
  LABEL_CHAR_WIDTH,
  LABEL_PADDING,
  NODE_HORIZONTAL_PADDING,
  ROUTING_PADDING,
  GRID_UNIT,
} from "../rendering/constants";

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
  expandedNodes: Set<number>,
  layoutMap: Map<string, ScopeLayout>,
): { width: number; height: number } {
  const leafWidth = computeLeafWidth(node);
  if (!expandedNodes.has(node.id) || node.subgraphs.length === 0) {
    return { width: leafWidth, height: LEAF_NODE_HEIGHT };
  }

  let totalSubgraphWidth = 0;
  let maximumSubgraphHeight = 0;
  for (const subgraph of node.subgraphs) {
    const child = layoutMap.get(subgraphScopeId(subgraph.inId, subgraph.outId));
    if (!child) {
      continue;
    }
    totalSubgraphWidth += child.gridWidth;
    maximumSubgraphHeight = Math.max(maximumSubgraphHeight, child.gridHeight);
  }

  const separatorCount = Math.max(0, node.subgraphs.length - 1);
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
    const sourceLayer = layerOf.get(edge.sourceId);
    const targetLayer = layerOf.get(edge.targetId);
    if (sourceLayer === undefined || targetLayer === undefined) {
      continue;
    }
    if (sourceLayer + 1 >= 0 && sourceLayer + 1 < laneDemand.length) {
      laneDemand[sourceLayer + 1] += 1;
    }
    if (targetLayer > sourceLayer + 1 && targetLayer < laneDemand.length) {
      laneDemand[targetLayer] += 1;
    }
  }
  return laneDemand.map((demand) =>
    Math.max(MIN_CHANNEL_SIZE, ROUTING_PADDING * 2 + demand * LANE_SPACING),
  );
}

interface PlacementResult {
  grid: LayoutGrid;
  nodePositions: Map<number, NodePosition>;
  routingAreas: RoutingArea[];
  gridWidth: number;
  gridHeight: number;
  channelY: number[];
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
  const grid = new LayoutGrid();
  const nodePositions = new Map<number, NodePosition>();
  const routingAreas: RoutingArea[] = [];
  const channelY: number[] = [];

  let longEdgeCount = 0;
  for (const edge of edges) {
    const sourceLayer = layerOf.get(edge.sourceId);
    const targetLayer = layerOf.get(edge.targetId);
    if (
      sourceLayer !== undefined &&
      targetLayer !== undefined &&
      targetLayer - sourceLayer > 1
    ) {
      longEdgeCount += 1;
    }
  }
  const verticalChannelReserve = Math.max(2, longEdgeCount);

  const layerWidths = layers.map((layer) => {
    let width = NODE_HORIZONTAL_PADDING * 2;
    for (let index = 0; index < layer.length; index += 1) {
      width += nodeWidths.get(layer[index]) ?? MIN_NODE_WIDTH;
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
    const areaHeight = routingAreaHeights[layerIndex] ?? MIN_CHANNEL_SIZE;
    const laneCount = Math.max(
      1,
      Math.floor((areaHeight - ROUTING_PADDING * 2) / LANE_SPACING),
    );
    channelY.push(currentRow);
    routingAreas.push({
      startRow: currentRow,
      height: areaHeight,
      laneCount,
      firstLaneRow: currentRow + ROUTING_PADDING,
    });
    currentRow += areaHeight;

    const layer = layers[layerIndex];
    const layerHeight = Math.max(
      LEAF_NODE_HEIGHT,
      ...layer.map((nodeId) => nodeHeights.get(nodeId) ?? LEAF_NODE_HEIGHT),
    );
    const layerOffset = Math.floor((gridWidth - layerWidths[layerIndex]) / 2);
    const firstPreferredX =
      layer.length > 0 ? (preferredX.get(layer[0]) ?? 0) : 0;
    let column = layerOffset + NODE_HORIZONTAL_PADDING;
    for (let index = 0; index < layer.length; index += 1) {
      const nodeId = layer[index];
      const width = nodeWidths.get(nodeId) ?? MIN_NODE_WIDTH;
      const height = nodeHeights.get(nodeId) ?? LEAF_NODE_HEIGHT;
      const preferredColumn =
        layerOffset +
        NODE_HORIZONTAL_PADDING +
        Math.round(
          (preferredX.get(nodeId) ?? firstPreferredX) - firstPreferredX,
        );
      column = Math.max(column, preferredColumn);
      nodePositions.set(nodeId, {
        x: column,
        y: currentRow,
        width,
        height,
      });
      grid.markNodeRect(column, currentRow, width, height);
      column += width;
      if (index < layer.length - 1) {
        column += NODE_HORIZONTAL_PADDING * 2 + verticalChannelReserve;
      }
    }
    currentRow += layerHeight;
  }

  const finalAreaHeight = routingAreaHeights[layers.length] ?? MIN_CHANNEL_SIZE;
  const finalLaneCount = Math.max(
    1,
    Math.floor((finalAreaHeight - ROUTING_PADDING * 2) / LANE_SPACING),
  );
  channelY.push(currentRow);
  routingAreas.push({
    startRow: currentRow,
    height: finalAreaHeight,
    laneCount: finalLaneCount,
    firstLaneRow: currentRow + ROUTING_PADDING,
  });
  currentRow += finalAreaHeight;

  return {
    grid,
    nodePositions,
    routingAreas,
    gridWidth,
    gridHeight: currentRow,
    channelY,
  };
}
