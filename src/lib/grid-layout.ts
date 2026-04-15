import type { Edge, GraphModel, Node, Scope } from "./graph-types";
import { TOP_LEVEL_SCOPE_ID } from "./graph-model";
import type { Point } from "./draw-edge";
import { SpatialIndex } from "./spatial-index";
import {
  LayoutGrid,
  edgeKey,
  type PlacedNode,
  type RoutingArea,
} from "./grid-types";
import {
  MIN_NODE_WIDTH,
  PORT_SPACING,
  LEAF_NODE_HEIGHT,
  MIN_CHANNEL_SIZE,
  LANE_SPACING,
  LABEL_BAR_HEIGHT,
  NODE_INNER_GAP,
  LABEL_CHAR_WIDTH,
  LABEL_PADDING,
  GRID_UNIT,
  NODE_HORIZONTAL_PADDING,
  ROUTING_PADDING,
  gridAlignedPortOffset,
  portOffset,
} from "./canvas-constants";

export interface NodePosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScopeLayout {
  nodePositions: Map<number, NodePosition>;
  gridWidth: number;
  gridHeight: number;
  channelY: number[];
  channelLaneCount: number[];
  layerOf: Map<number, number>;
  layers: number[][];
  /** Placement grid with node cells pre-marked, reused during routing. */
  grid: LayoutGrid;
  /** Placed node records from layout, reused during routing. */
  placedNodes: Map<number, PlacedNode>;
  /** Spatial index over node positions (grid-unit coords) for fast culling/hit detection. */
  nodeSpatialIndex: SpatialIndex<number>;
}

export interface RoutedEdge {
  edge: Edge;
  waypoints: Point[];
  colorIndex: number;
  key: string;
}

export interface ScopeRouting {
  routedEdges: RoutedEdge[];
  crossings: Point[];
}

export function subgraphScopeId(inId: number, outId: number): string {
  return `subgraph_${inId}_${outId}`;
}

function assignLayers(
  nodeIds: number[],
  successors: Map<number, number[]>,
): { layers: number[][]; layerOf: Map<number, number> } {
  const distanceToSink = new Map<number, number>();

  for (let i = nodeIds.length - 1; i >= 0; i -= 1) {
    const nodeId = nodeIds[i];
    let maxDistance = -1;
    for (const successorId of successors.get(nodeId) ?? []) {
      const distance = distanceToSink.get(successorId) ?? 0;
      if (distance > maxDistance) {
        maxDistance = distance;
      }
    }
    distanceToSink.set(nodeId, maxDistance + 1);
  }

  let maxDepth = 0;
  for (const distance of distanceToSink.values()) {
    if (distance > maxDepth) {
      maxDepth = distance;
    }
  }

  const layerOf = new Map<number, number>();
  const layers: number[][] = Array.from({ length: maxDepth + 1 }, () => []);

  for (const nodeId of nodeIds) {
    const layer = maxDepth - (distanceToSink.get(nodeId) ?? 0);
    layerOf.set(nodeId, layer);
    layers[layer].push(nodeId);
  }

  return { layers, layerOf };
}

function computeLeafWidth(node: Node): number {
  const portWidth =
    Math.max(node.portCountIn, node.portCountOut) * PORT_SPACING;
  const labelWidth = Math.ceil(
    (node.label.length * LABEL_CHAR_WIDTH + LABEL_PADDING) / GRID_UNIT,
  );
  return Math.max(MIN_NODE_WIDTH, portWidth, labelWidth);
}

function computeNodeSize(
  node: Node,
  expandedNodes: Set<number>,
  layoutMap: Map<string, ScopeLayout>,
): { width: number; height: number } {
  const leafWidth = computeLeafWidth(node);

  if (!expandedNodes.has(node.id) || node.subgraphs.length === 0) {
    return { width: leafWidth, height: LEAF_NODE_HEIGHT };
  }

  let totalSubgraphWidth = 0;
  let maxSubgraphHeight = 0;

  for (const subgraph of node.subgraphs) {
    const scopeId = subgraphScopeId(subgraph.inId, subgraph.outId);
    const childLayout = layoutMap.get(scopeId);
    if (childLayout) {
      totalSubgraphWidth += childLayout.gridWidth;
      maxSubgraphHeight = Math.max(maxSubgraphHeight, childLayout.gridHeight);
    }
  }

  const separatorCount = node.subgraphs.length - 1;
  const expandedWidth = Math.max(
    leafWidth,
    totalSubgraphWidth + separatorCount * NODE_INNER_GAP + NODE_INNER_GAP * 2,
  );
  const expandedHeight =
    maxSubgraphHeight + LABEL_BAR_HEIGHT + NODE_INNER_GAP * 2;

  return { width: expandedWidth, height: expandedHeight };
}

function orderLayers(
  layers: number[][],
  predecessors: Map<number, number[]>,
  successors: Map<number, number[]>,
  nodeWidths: Map<number, number>,
): void {
  const centerOf = new Map<number, number>();

  function updateCenters(layer: number[]): void {
    let accumulated = 0;
    for (const id of layer) {
      const w = nodeWidths.get(id) ?? MIN_NODE_WIDTH;
      centerOf.set(id, accumulated + w / 2);
      accumulated += w + NODE_HORIZONTAL_PADDING;
    }
  }

  function barycenter(id: number, neighbors: Map<number, number[]>): number {
    const neighborsWithCenters = (neighbors.get(id) ?? []).filter((neighbor) =>
      centerOf.has(neighbor),
    );
    if (neighborsWithCenters.length === 0) {
      return centerOf.get(id) ?? 0;
    }
    let sum = 0;
    for (const neighbor of neighborsWithCenters) {
      sum += centerOf.get(neighbor)!;
    }
    return sum / neighborsWithCenters.length;
  }

  if (layers.length > 0) {
    updateCenters(layers[0]);
  }

  for (let i = 1; i < layers.length; i += 1) {
    layers[i].sort(
      (a, b) => barycenter(a, predecessors) - barycenter(b, predecessors),
    );
    updateCenters(layers[i]);
  }

  for (let i = layers.length - 2; i >= 0; i -= 1) {
    layers[i].sort(
      (a, b) => barycenter(a, successors) - barycenter(b, successors),
    );
    updateCenters(layers[i]);
  }
}

function computeRoutingAreaHeights(
  layerCount: number,
  edges: Edge[],
  layerOf: Map<number, number>,
): number[] {
  // There are layerCount + 1 routing areas:
  // area 0 = above layer 0, area i = between layer i-1 and layer i, area layerCount = below last layer
  const areaCount = layerCount + 1;
  const edgesPerArea = new Array<number>(areaCount).fill(0);

  for (const edge of edges) {
    const sourceLayer = layerOf.get(edge.sourceId) ?? -1;
    const targetLayer = layerOf.get(edge.targetId) ?? -1;

    // Each edge needs a horizontal lane in the area below its source layer
    const sourceArea = sourceLayer + 1;
    if (sourceArea >= 0 && sourceArea < areaCount) {
      edgesPerArea[sourceArea] += 1;
    }

    // Long edges also need a horizontal lane in the area above their target layer
    if (targetLayer > sourceLayer + 1) {
      const targetArea = targetLayer;
      if (targetArea >= 0 && targetArea < areaCount) {
        edgesPerArea[targetArea] += 1;
      }
    }
  }

  return edgesPerArea.map((count) =>
    Math.max(
      MIN_CHANNEL_SIZE,
      ROUTING_PADDING + count * LANE_SPACING + ROUTING_PADDING,
    ),
  );
}

interface PlacementResult {
  grid: LayoutGrid;
  placedNodes: Map<number, PlacedNode>;
  routingAreas: RoutingArea[];
  gridWidth: number;
  gridHeight: number;
  channelY: number[];
}

function placeNodesOnGrid(
  layers: number[][],
  layerOf: Map<number, number>,
  nodeWidths: Map<number, number>,
  nodeHeights: Map<number, number>,
  routingAreaHeights: number[],
  edges: Edge[],
): PlacementResult {
  const grid = new LayoutGrid();
  const placedNodes = new Map<number, PlacedNode>();
  const routingAreas: RoutingArea[] = [];
  const channelY: number[] = [];

  // Count long edges for vertical lane reservation
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
  const verticalLaneReserve = Math.max(2, Math.min(longEdgeCount, 8));

  // Compute max layer width to determine gridWidth
  const layerWidths: number[] = [];
  for (const layer of layers) {
    let accumulatedWidth = NODE_HORIZONTAL_PADDING;
    for (let i = 0; i < layer.length; i += 1) {
      accumulatedWidth += nodeWidths.get(layer[i]) ?? MIN_NODE_WIDTH;
      if (i < layer.length - 1) {
        accumulatedWidth += NODE_HORIZONTAL_PADDING * 2 + verticalLaneReserve;
      }
    }
    accumulatedWidth += NODE_HORIZONTAL_PADDING;
    layerWidths.push(accumulatedWidth);
  }

  const gridWidth =
    Math.max(...layerWidths, MIN_NODE_WIDTH + NODE_HORIZONTAL_PADDING * 2) +
    verticalLaneReserve * 2; // extra margin for vertical lanes on edges

  let currentRow = 0;

  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    const layer = layers[layerIndex];

    // Routing area above this layer
    const areaHeight = routingAreaHeights[layerIndex];
    const laneCount = Math.max(
      1,
      Math.floor((areaHeight - ROUTING_PADDING * 2) / LANE_SPACING),
    );
    const firstLaneRow = currentRow + ROUTING_PADDING;

    channelY.push(currentRow);
    routingAreas.push({
      startRow: currentRow,
      height: areaHeight,
      laneCount,
      firstLaneRow,
    });

    currentRow += areaHeight;

    // Layer height = max height of nodes in this layer
    let layerHeight = 0;
    for (const id of layer) {
      layerHeight = Math.max(
        layerHeight,
        nodeHeights.get(id) ?? LEAF_NODE_HEIGHT,
      );
    }

    // Center this layer horizontally
    const layerWidth = layerWidths[layerIndex];
    const layerOffset = Math.floor((gridWidth - layerWidth) / 2);

    let col = layerOffset + NODE_HORIZONTAL_PADDING;

    for (let i = 0; i < layer.length; i += 1) {
      const nodeId = layer[i];
      const nodeWidth = nodeWidths.get(nodeId) ?? MIN_NODE_WIDTH;
      const nodeHeight = nodeHeights.get(nodeId) ?? LEAF_NODE_HEIGHT;

      placedNodes.set(nodeId, {
        nodeId,
        col,
        row: currentRow,
        width: nodeWidth,
        height: nodeHeight,
        layer: layerIndex,
      });

      grid.markNodeRect(col, currentRow, nodeWidth, nodeHeight);

      if (i < layer.length - 1) {
        col += nodeWidth + NODE_HORIZONTAL_PADDING * 2 + verticalLaneReserve;
      }
    }

    currentRow += layerHeight;
  }

  // Final routing area (below last layer)
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
    placedNodes,
    routingAreas,
    gridWidth,
    gridHeight: currentRow,
    channelY,
  };
}

function findUnusedVerticalLane(
  grid: LayoutGrid,
  rowStart: number,
  rowEnd: number,
  preferredCol: number,
  gridWidth: number,
): number {
  const minRow = Math.min(rowStart, rowEnd);
  const maxRow = Math.max(rowStart, rowEnd);

  // Search outward from preferred column
  for (let offset = 0; offset < gridWidth; offset += 1) {
    const rightCol = preferredCol + offset;
    if (rightCol < gridWidth && grid.isColumnFree(rightCol, minRow, maxRow)) {
      return rightCol;
    }
    if (offset > 0) {
      const leftCol = preferredCol - offset;
      if (leftCol >= 0 && grid.isColumnFree(leftCol, minRow, maxRow)) {
        return leftCol;
      }
    }
  }

  // Fallback: use preferredCol
  return preferredCol;
}

function markHorizontalLane(
  grid: LayoutGrid,
  row: number,
  colStart: number,
  colEnd: number,
  key: string,
): void {
  const minCol = Math.min(colStart, colEnd);
  const maxCol = Math.max(colStart, colEnd);
  for (let col = minCol; col <= maxCol; col += 1) {
    grid.mark(col, row, { kind: "h-lane", edgeKey: key });
  }
}

function markVerticalLane(
  grid: LayoutGrid,
  col: number,
  rowStart: number,
  rowEnd: number,
  key: string,
): void {
  const minRow = Math.min(rowStart, rowEnd);
  const maxRow = Math.max(rowStart, rowEnd);
  for (let row = minRow; row <= maxRow; row += 1) {
    grid.mark(col, row, { kind: "v-lane", edgeKey: key });
  }
}

/** Remove consecutive duplicate waypoints (within 0.1 px tolerance). */
function deduplicateWaypoints(waypoints: Point[]): Point[] {
  const cleaned: Point[] = [waypoints[0]];
  for (let i = 1; i < waypoints.length; i += 1) {
    const previous = cleaned[cleaned.length - 1];
    if (
      Math.abs(waypoints[i].x - previous.x) > 0.1 ||
      Math.abs(waypoints[i].y - previous.y) > 0.1
    ) {
      cleaned.push(waypoints[i]);
    }
  }
  return cleaned;
}

/** Pixel + grid-column position of a port endpoint. */
interface PortEndpoint {
  portPx: number;
  edgePx: number;
  col: number;
}

interface EdgeRouterConfig {
  grid: LayoutGrid;
  placedNodes: Map<number, PlacedNode>;
  routingAreas: RoutingArea[];
  layerOf: Map<number, number>;
  portCountOut: Map<number, number>;
  portCountIn: Map<number, number>;
  gridWidth: number;
  gridHeight: number;
  offsetX: number;
  offsetY: number;
  inId: number | null;
  outId: number | null;
  scopeGridWidth: number;
}

/**
 * Routes edges on a layout grid as orthogonal polylines.
 *
 * Encapsulated as a class because routing allocates significant working state
 * (effective placed-node map, effective layer map, lane counters) and has
 * multiple interdependent helper methods that share it.
 */
class EdgeRouter {
  private readonly grid: LayoutGrid;
  private readonly routingAreas: RoutingArea[];
  private readonly portCountOut: Map<number, number>;
  private readonly portCountIn: Map<number, number>;
  private readonly gridWidth: number;
  private readonly offsetX: number;
  private readonly offsetY: number;
  private readonly inId: number | null;
  private readonly outId: number | null;

  private readonly effectivePlaced: Map<number, PlacedNode>;
  private readonly effectiveLayerOf: Map<number, number>;
  private readonly laneCounters: number[];

  constructor(config: EdgeRouterConfig) {
    this.grid = config.grid;
    this.routingAreas = config.routingAreas;
    this.portCountOut = config.portCountOut;
    this.portCountIn = config.portCountIn;
    this.gridWidth = config.gridWidth;
    this.offsetX = config.offsetX;
    this.offsetY = config.offsetY;
    this.inId = config.inId;
    this.outId = config.outId;
    this.laneCounters = new Array<number>(config.routingAreas.length).fill(0);

    this.effectivePlaced = new Map(config.placedNodes);
    this.effectiveLayerOf = new Map(config.layerOf);
    this.addBoundaryNodes(config);
  }

  run(edges: Edge[]): RoutedEdge[] {
    const sortedEdges = this.sortBySpan(edges);

    // O(1) color index lookup (avoids O(E) indexOf per edge).
    const edgeIndexMap = new Map<Edge, number>();
    for (let i = 0; i < edges.length; i += 1) {
      edgeIndexMap.set(edges[i], i);
    }

    const results: RoutedEdge[] = [];
    for (let i = 0; i < sortedEdges.length; i += 1) {
      const edge = sortedEdges[i];
      const sourceNode = this.effectivePlaced.get(edge.sourceId);
      const targetNode = this.effectivePlaced.get(edge.targetId);
      if (!sourceNode || !targetNode) {
        continue;
      }

      const sourceLayer = this.effectiveLayerOf.get(edge.sourceId) ?? 0;
      const targetLayer = this.effectiveLayerOf.get(edge.targetId) ?? 0;
      const source = this.computePortEndpoint(
        edge.sourceId,
        edge.sourcePort,
        sourceNode,
        "out",
      );
      const target = this.computePortEndpoint(
        edge.targetId,
        edge.targetPort,
        targetNode,
        "in",
      );

      let waypoints: Point[];
      if (targetLayer <= sourceLayer + 1) {
        waypoints = this.routeShortEdge(edge, source, target, sourceLayer);
      } else {
        waypoints = this.routeLongEdge(
          edge,
          source,
          target,
          sourceLayer,
          targetLayer,
        );
      }

      const colorIndex = edgeIndexMap.get(edge) ?? i;
      results.push({
        edge,
        waypoints: deduplicateWaypoints(waypoints),
        colorIndex,
        key: edgeKey(edge),
      });
    }
    return results;
  }

  static once(edges: Edge[], config: EdgeRouterConfig): RoutedEdge[] {
    return new EdgeRouter(config).run(edges);
  }

  /** Synthetic placements let edges reference scope entry/exit points. */
  private addBoundaryNodes(config: EdgeRouterConfig): void {
    const layerCount = config.routingAreas.length - 1;
    if (config.inId !== null) {
      this.effectivePlaced.set(config.inId, {
        nodeId: config.inId,
        col: 0,
        row: 0,
        width: config.scopeGridWidth,
        height: 0,
        layer: -1,
      });
      this.effectiveLayerOf.set(config.inId, -1);
    }
    if (config.outId !== null) {
      this.effectivePlaced.set(config.outId, {
        nodeId: config.outId,
        col: 0,
        row: config.gridHeight,
        width: config.scopeGridWidth,
        height: 0,
        layer: layerCount,
      });
      this.effectiveLayerOf.set(config.outId, layerCount);
    }
  }

  private sortBySpan(edges: Edge[]): Edge[] {
    return [...edges].sort((a, b) => {
      const spanA = Math.abs(
        (this.effectiveLayerOf.get(a.targetId) ?? 0) -
          (this.effectiveLayerOf.get(a.sourceId) ?? 0),
      );
      const spanB = Math.abs(
        (this.effectiveLayerOf.get(b.targetId) ?? 0) -
          (this.effectiveLayerOf.get(b.sourceId) ?? 0),
      );
      return spanB - spanA;
    });
  }

  /**
   * Compute the pixel + grid-column position of a port.
   * Boundary nodes use proportional spacing; content nodes use grid-aligned spacing.
   */
  private computePortEndpoint(
    nodeId: number,
    portIndex: number,
    placed: PlacedNode,
    side: "in" | "out",
  ): PortEndpoint {
    const isBoundary = nodeId === this.inId || nodeId === this.outId;

    let portCount: number;
    if (side === "out") {
      portCount = this.portCountOut.get(nodeId) ?? 1;
    } else {
      portCount = this.portCountIn.get(nodeId) ?? 1;
    }

    let portGU: number;
    if (isBoundary) {
      portGU = placed.col + portOffset(placed.width, portIndex, portCount);
    } else {
      portGU = placed.col + gridAlignedPortOffset(portIndex);
    }

    let edgeGU: number;
    if (side === "out") {
      edgeGU = placed.row + placed.height;
    } else {
      edgeGU = placed.row;
    }

    return {
      portPx: this.offsetX + portGU * GRID_UNIT,
      edgePx: this.offsetY + edgeGU * GRID_UNIT,
      col: Math.round(portGU),
    };
  }

  private routeShortEdge(
    edge: Edge,
    source: PortEndpoint,
    target: PortEndpoint,
    sourceLayer: number,
  ): Point[] {
    const areaIndex = Math.max(
      0,
      Math.min(sourceLayer + 1, this.routingAreas.length - 1),
    );
    const area = this.routingAreas[areaIndex];
    const laneIndex = this.laneCounters[areaIndex];
    this.laneCounters[areaIndex] += 1;
    const horizontalLaneRow = area.firstLaneRow + laneIndex * LANE_SPACING;
    const horizontalLanePx = this.offsetY + horizontalLaneRow * GRID_UNIT;

    markHorizontalLane(
      this.grid,
      horizontalLaneRow,
      source.col,
      target.col,
      edgeKey(edge),
    );

    return [
      { x: source.portPx, y: source.edgePx },
      { x: source.portPx, y: horizontalLanePx },
      { x: target.portPx, y: horizontalLanePx },
      { x: target.portPx, y: target.edgePx },
    ];
  }

  private routeLongEdge(
    edge: Edge,
    source: PortEndpoint,
    target: PortEndpoint,
    sourceLayer: number,
    targetLayer: number,
  ): Point[] {
    const key = edgeKey(edge);
    const sourceAreaIndex = Math.max(
      0,
      Math.min(sourceLayer + 1, this.routingAreas.length - 1),
    );
    const sourceArea = this.routingAreas[sourceAreaIndex];
    const targetAreaIndex = Math.max(
      0,
      Math.min(targetLayer, this.routingAreas.length - 1),
    );
    const targetArea = this.routingAreas[targetAreaIndex];

    const preferredVerticalCol = Math.round((source.col + target.col) / 2);
    const verticalLaneRowEnd =
      targetArea.firstLaneRow + targetArea.laneCount * LANE_SPACING;
    const verticalLaneCol = findUnusedVerticalLane(
      this.grid,
      sourceArea.firstLaneRow,
      verticalLaneRowEnd,
      preferredVerticalCol,
      this.gridWidth,
    );

    const sourceLaneIndex = this.laneCounters[sourceAreaIndex];
    this.laneCounters[sourceAreaIndex] += 1;
    const sourceHorizontalRow =
      sourceArea.firstLaneRow + sourceLaneIndex * LANE_SPACING;

    const targetLaneIndex = this.laneCounters[targetAreaIndex];
    this.laneCounters[targetAreaIndex] += 1;
    const targetHorizontalRow =
      targetArea.firstLaneRow + targetLaneIndex * LANE_SPACING;

    markHorizontalLane(
      this.grid,
      sourceHorizontalRow,
      Math.min(source.col, verticalLaneCol),
      Math.max(source.col, verticalLaneCol),
      key,
    );
    markVerticalLane(
      this.grid,
      verticalLaneCol,
      sourceHorizontalRow,
      targetHorizontalRow,
      key,
    );
    markHorizontalLane(
      this.grid,
      targetHorizontalRow,
      Math.min(verticalLaneCol, target.col),
      Math.max(verticalLaneCol, target.col),
      key,
    );

    const sourceHorizontalPx = this.offsetY + sourceHorizontalRow * GRID_UNIT;
    const targetHorizontalPx = this.offsetY + targetHorizontalRow * GRID_UNIT;
    const verticalLanePx = this.offsetX + verticalLaneCol * GRID_UNIT;

    return [
      { x: source.portPx, y: source.edgePx },
      { x: source.portPx, y: sourceHorizontalPx },
      { x: verticalLanePx, y: sourceHorizontalPx },
      { x: verticalLanePx, y: targetHorizontalPx },
      { x: target.portPx, y: targetHorizontalPx },
      { x: target.portPx, y: target.edgePx },
    ];
  }
}

interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface ClassifiedSegment extends Segment {
  edgeIndex: number;
}

/**
 * Detect crossings between routed edges using spatial bucketing.
 * Collects all H and V segments, sorts V segments by x, then for each
 * H segment binary-searches for V segments in its x range and checks y overlap.
 * Only tests H-V pairs from different edges. O((S + K) log S) where K = crossings.
 */
function detectCrossings(routedEdges: RoutedEdge[]): Point[] {
  const horizontals: ClassifiedSegment[] = [];
  const verticals: ClassifiedSegment[] = [];

  for (let i = 0; i < routedEdges.length; i += 1) {
    const points = routedEdges[i].waypoints;
    for (let j = 0; j < points.length - 1; j += 1) {
      const segment: ClassifiedSegment = {
        x1: points[j].x,
        y1: points[j].y,
        x2: points[j + 1].x,
        y2: points[j + 1].y,
        edgeIndex: i,
      };
      if (Math.abs(segment.y1 - segment.y2) < 0.1) {
        horizontals.push(segment);
      } else if (Math.abs(segment.x1 - segment.x2) < 0.1) {
        verticals.push(segment);
      }
    }
  }

  // Sort verticals by x for binary search.
  verticals.sort((a, b) => a.x1 - b.x1);

  const crossings: Point[] = [];
  const epsilon = 1;

  for (const horizontal of horizontals) {
    const horizontalY = horizontal.y1;
    const horizontalMinX = Math.min(horizontal.x1, horizontal.x2) + epsilon;
    const horizontalMaxX = Math.max(horizontal.x1, horizontal.x2) - epsilon;

    let low = 0;
    let high = verticals.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (verticals[mid].x1 <= horizontalMinX) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }

    for (let k = low; k < verticals.length; k += 1) {
      const vertical = verticals[k];
      if (vertical.x1 >= horizontalMaxX) {
        break;
      }
      if (vertical.edgeIndex === horizontal.edgeIndex) {
        continue;
      }

      const verticalMinY = Math.min(vertical.y1, vertical.y2) + epsilon;
      const verticalMaxY = Math.max(vertical.y1, vertical.y2) - epsilon;
      if (horizontalY > verticalMinY && horizontalY < verticalMaxY) {
        crossings.push({ x: vertical.x1, y: horizontalY });
      }
    }
  }

  return crossings;
}

function computeScopeLayout(
  scopeId: string,
  model: GraphModel,
  expandedNodes: Set<number>,
  layoutMap: Map<string, ScopeLayout>,
): ScopeLayout {
  const scope = model.scopeMap.get(scopeId)!;

  if (scope.nodeIds.length === 0) {
    return {
      nodePositions: new Map(),
      gridWidth: MIN_NODE_WIDTH,
      gridHeight: LEAF_NODE_HEIGHT,
      channelY: [0],
      channelLaneCount: [0],
      layerOf: new Map(),
      layers: [],
      grid: new LayoutGrid(),
      placedNodes: new Map(),
      nodeSpatialIndex: new SpatialIndex<number>(20),
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

  // Phase 1: Layer assignment
  const { layers, layerOf } = assignLayers(scope.nodeIds, scope.successors);

  // Phase 2: Ordering within layers
  orderLayers(layers, scope.predecessors, scope.successors, nodeWidths);

  // Phase 3: Routing area heights
  // Add boundary nodes to layerOf for edge counting
  const effectiveLayerOf = new Map(layerOf);
  if (scope.inId !== null) {
    effectiveLayerOf.set(scope.inId, -1);
  }
  if (scope.outId !== null) {
    effectiveLayerOf.set(scope.outId, layers.length);
  }

  const routingAreaHeights = computeRoutingAreaHeights(
    layers.length,
    scope.edges,
    effectiveLayerOf,
  );

  // Phase 4: Grid construction and node placement
  const placement = placeNodesOnGrid(
    layers,
    layerOf,
    nodeWidths,
    nodeHeights,
    routingAreaHeights,
    scope.edges,
  );

  const nodePositions = new Map<number, NodePosition>();
  for (const [id, placed] of placement.placedNodes) {
    nodePositions.set(id, {
      x: placed.col,
      y: placed.row,
      width: placed.width,
      height: placed.height,
    });
  }

  const channelLaneCount = placement.routingAreas.map((area) => area.laneCount);

  // Build spatial index over node positions (in grid-unit coordinates).
  // Cell size of 20 GU provides good bucket distribution for typical graphs.
  const nodeSpatialIndex = new SpatialIndex<number>(20);
  for (const [id, pos] of nodePositions) {
    nodeSpatialIndex.insert(
      id,
      pos.x,
      pos.y,
      pos.x + pos.width,
      pos.y + pos.height,
    );
  }

  return {
    nodePositions,
    gridWidth: placement.gridWidth,
    gridHeight: placement.gridHeight,
    channelY: placement.channelY,
    channelLaneCount,
    layerOf,
    layers,
    grid: placement.grid,
    placedNodes: placement.placedNodes,
    nodeSpatialIndex,
  };
}

function buildLayoutBottomUp(
  scopeId: string,
  model: GraphModel,
  expandedNodes: Set<number>,
  layoutMap: Map<string, ScopeLayout>,
): void {
  const scope = model.scopeMap.get(scopeId);
  if (!scope) {
    return;
  }

  for (const nodeId of scope.nodeIds) {
    const node = model.nodeMap.get(nodeId)!;
    if (expandedNodes.has(nodeId)) {
      for (const subgraph of node.subgraphs) {
        const childScopeId = subgraphScopeId(subgraph.inId, subgraph.outId);
        if (!layoutMap.has(childScopeId)) {
          buildLayoutBottomUp(childScopeId, model, expandedNodes, layoutMap);
        }
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

interface RoutingState {
  grid: LayoutGrid;
  placedNodes: Map<number, PlacedNode>;
  routingAreas: RoutingArea[];
  portCountOut: Map<number, number>;
  portCountIn: Map<number, number>;
  layerOf: Map<number, number>;
}

/**
 * Build the mutable grid, placed-node map, routing areas, and port counts
 * needed by EdgeRouter. Separated from buildRoutingRecursive because routing
 * mutates the grid with lane marks, so a fresh grid is needed each time.
 */
function prepareRoutingState(scope: Scope, layout: ScopeLayout): RoutingState {
  const portCountOut = new Map<number, number>();
  const portCountIn = new Map<number, number>();
  for (const edge of scope.edges) {
    portCountOut.set(
      edge.sourceId,
      Math.max(portCountOut.get(edge.sourceId) ?? 0, edge.sourcePort + 1),
    );
    portCountIn.set(
      edge.targetId,
      Math.max(portCountIn.get(edge.targetId) ?? 0, edge.targetPort + 1),
    );
  }

  const layerOf = new Map(layout.layerOf);
  if (scope.inId !== null) {
    layerOf.set(scope.inId, -1);
  }
  if (scope.outId !== null) {
    layerOf.set(scope.outId, layout.layers.length);
  }

  // Clone the layout grid (node cells already marked) instead of rebuilding.
  // Routing adds lane marks to the clone without mutating the original.
  const grid = layout.grid.clone();
  const placedNodes = new Map(layout.placedNodes);

  const routingAreas: RoutingArea[] = layout.channelY.map(
    (channelStartRow, i) => {
      const laneCount = layout.channelLaneCount[i] ?? 1;
      let height: number;
      if (i + 1 < layout.channelY.length) {
        height = layout.channelY[i + 1] - channelStartRow;
      } else {
        height = layout.gridHeight - channelStartRow;
      }
      return {
        startRow: channelStartRow,
        height,
        laneCount,
        firstLaneRow: channelStartRow + ROUTING_PADDING,
      };
    },
  );

  return {
    grid,
    placedNodes,
    routingAreas,
    portCountOut,
    portCountIn,
    layerOf,
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
  if (!scope || !layout) {
    return;
  }

  const {
    grid,
    placedNodes,
    routingAreas,
    portCountOut,
    portCountIn,
    layerOf,
  } = prepareRoutingState(scope, layout);

  const routedEdges = EdgeRouter.once(scope.edges, {
    grid,
    placedNodes,
    routingAreas,
    layerOf,
    portCountOut,
    portCountIn,
    gridWidth: layout.gridWidth,
    gridHeight: layout.gridHeight,
    offsetX,
    offsetY,
    inId: scope.inId,
    outId: scope.outId,
    scopeGridWidth: layout.gridWidth,
  });

  routingMap.set(scopeId, {
    routedEdges,
    crossings: detectCrossings(routedEdges),
  });

  // Recurse into expanded child scopes.
  for (const nodeId of scope.nodeIds) {
    const node = model.nodeMap.get(nodeId)!;
    if (!expandedNodes.has(nodeId) || node.subgraphs.length === 0) {
      continue;
    }

    const position = layout.nodePositions.get(nodeId);
    if (!position) {
      continue;
    }

    const nodePixelX = offsetX + position.x * GRID_UNIT;
    const nodePixelY = offsetY + position.y * GRID_UNIT;
    const subgraphAreaY =
      nodePixelY + (LABEL_BAR_HEIGHT + NODE_INNER_GAP) * GRID_UNIT;
    let currentSubgraphX = nodePixelX + NODE_INNER_GAP * GRID_UNIT;

    for (const subgraph of node.subgraphs) {
      const childScopeId = subgraphScopeId(subgraph.inId, subgraph.outId);
      const childLayout = layoutMap.get(childScopeId);
      if (!childLayout) {
        continue;
      }

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

  recomputeLayoutChainUpward(node.scopeId, model, expandedNodes, layoutMap);
}
