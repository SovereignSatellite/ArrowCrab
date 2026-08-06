import type { Edge } from "../graph/types";
import type { Point } from "../geometry/types";
import {
  edgeKey,
  LayoutGrid,
  type PlacedNode,
  type RoutingArea,
} from "./occupancy";
import { NodePositionLookup } from "../layout/types";
import type { RoutedEdge } from "./types";
import { TrackAllocator } from "./tracks";
import {
  GRID_UNIT,
  gridAlignedPortOffset,
  LANE_SPACING,
  ROUTING_PADDING,
  portOffset,
} from "../rendering/constants";

function findBestVerticalLane(
  grid: LayoutGrid,
  rowStart: number,
  rowEnd: number,
  preferredColumn: number,
  gridWidth: number,
): number {
  let selectedColumn = -1;
  let selectedCost = Number.POSITIVE_INFINITY;
  for (let offset = 0; offset <= gridWidth; offset += 1) {
    const right = preferredColumn + offset;
    if (right <= gridWidth) {
      const cost = grid.columnOverlapCost(right, rowStart, rowEnd);
      if (cost === 0) return right;
      if (cost < selectedCost) {
        selectedColumn = right;
        selectedCost = cost;
      }
    }
    if (offset > 0) {
      const left = preferredColumn - offset;
      if (left >= 0) {
        const cost = grid.columnOverlapCost(left, rowStart, rowEnd);
        if (cost === 0) return left;
        if (cost < selectedCost) {
          selectedColumn = left;
          selectedCost = cost;
        }
      }
    }
  }
  if (selectedColumn >= 0) return selectedColumn;
  throw new Error(
    `Unable to allocate an orthogonal channel between rows ${rowStart} and ${rowEnd}`,
  );
}

function deduplicateWaypoints(waypoints: Point[]): Point[] {
  if (waypoints.length === 0) {
    return [];
  }
  const result: Point[] = [waypoints[0]];
  for (let index = 1; index < waypoints.length; index += 1) {
    const previous = result[result.length - 1];
    if (
      waypoints[index].x !== previous.x ||
      waypoints[index].y !== previous.y
    ) {
      result.push(waypoints[index]);
    }
  }
  return result;
}

interface PortEndpoint {
  portPixels: number;
  edgePixels: number;
  column: number;
}

interface EdgeRouterConfig {
  grid: LayoutGrid;
  nodePositions: NodePositionLookup;
  routingAreas: RoutingArea[];
  layerOf: Map<number, number>;
  outputPortCounts: Map<number, number>;
  inputPortCounts: Map<number, number>;
  gridWidth: number;
  gridHeight: number;
  offsetX: number;
  offsetY: number;
  inId: number | null;
  outId: number | null;
  scopeGridWidth: number;
}

interface HandleConstraint {
  column: number;
  edgeRow: number;
}

type TrackRequestKind = "short" | "source" | "target";

interface TrackRequest {
  edge: Edge;
  areaIndex: number;
  start: number;
  end: number;
  kind: TrackRequestKind;
  constraints: readonly HandleConstraint[];
  minimumAnchor: number;
  maximumAnchor: number;
}

interface EdgeTrackAssignment {
  shortRow?: number;
  sourceRow?: number;
  targetRow?: number;
}

export class EdgeRouter {
  private readonly grid: LayoutGrid;
  private readonly routingAreas: RoutingArea[];
  private readonly outputPortCounts: Map<number, number>;
  private readonly inputPortCounts: Map<number, number>;
  private readonly gridWidth: number;
  private readonly offsetX: number;
  private readonly offsetY: number;
  private readonly inId: number | null;
  private readonly outId: number | null;
  private readonly nodePositions: NodePositionLookup;
  private readonly layerOf: Map<number, number>;
  private readonly boundaryNodes = new Map<number, PlacedNode>();
  private readonly trackAllocators: TrackAllocator[];
  private readonly trackAssignments = new Map<number, EdgeTrackAssignment>();

  constructor(config: EdgeRouterConfig) {
    this.grid = config.grid;
    this.routingAreas = config.routingAreas;
    this.outputPortCounts = config.outputPortCounts;
    this.inputPortCounts = config.inputPortCounts;
    this.gridWidth = config.gridWidth;
    this.offsetX = config.offsetX;
    this.offsetY = config.offsetY;
    this.inId = config.inId;
    this.outId = config.outId;
    this.nodePositions = config.nodePositions;
    this.layerOf = config.layerOf;
    this.trackAllocators = this.routingAreas.map(() => new TrackAllocator());
    this.addBoundaryNodes(config);
  }

  run(edges: Edge[]): RoutedEdge[] {
    this.reservePortHandleColumns(edges);
    this.preallocateTracks(edges);
    const sortedEdges = [...edges].sort((left, right) => {
      const leftSpan = this.edgeSpan(left);
      const rightSpan = this.edgeSpan(right);
      return rightSpan - leftSpan || left.edgeIndex - right.edgeIndex;
    });
    return sortedEdges.flatMap((edge) => {
      const sourceNode = this.getPlacedNode(edge.sourceId);
      const targetNode = this.getPlacedNode(edge.targetId);
      if (!sourceNode || !targetNode) {
        return [];
      }

      const sourceLayer = this.getLayer(edge.sourceId);
      const targetLayer = this.getLayer(edge.targetId);
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
      const waypoints =
        targetLayer <= sourceLayer + 1
          ? this.routeShortEdge(edge, source, target)
          : this.routeLongEdge(edge, source, target);
      return [
        {
          edge,
          waypoints: deduplicateWaypoints(waypoints),
          colorIndex: edge.edgeIndex,
          key: edgeKey(edge),
        },
      ];
    });
  }

  private preallocateTracks(edges: Edge[]): void {
    const requestsByArea: TrackRequest[][] = this.routingAreas.map(() => []);
    const addRequest = (
      request: Omit<TrackRequest, "minimumAnchor" | "maximumAnchor">,
    ): void => {
      const anchors = request.constraints.map(
        (constraint) => constraint.edgeRow,
      );
      requestsByArea[request.areaIndex].push({
        ...request,
        minimumAnchor: Math.min(...anchors),
        maximumAnchor: Math.max(...anchors),
      });
    };
    for (const edge of edges) {
      const sourceNode = this.getPlacedNode(edge.sourceId);
      const targetNode = this.getPlacedNode(edge.targetId);
      if (!sourceNode || !targetNode) continue;
      const sourceLayer = this.getLayer(edge.sourceId);
      const targetLayer = this.getLayer(edge.targetId);
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
      const sourceEdgeRow = Math.round(
        (source.edgePixels - this.offsetY) / GRID_UNIT,
      );
      const targetEdgeRow = Math.round(
        (target.edgePixels - this.offsetY) / GRID_UNIT,
      );
      if (targetLayer <= sourceLayer + 1) {
        addRequest({
          edge,
          areaIndex: Math.max(
            0,
            Math.min(sourceLayer + 1, this.routingAreas.length - 1),
          ),
          start: source.column,
          end: target.column,
          kind: "short",
          constraints: [
            { column: source.column, edgeRow: sourceEdgeRow },
            { column: target.column, edgeRow: targetEdgeRow },
          ],
        });
        continue;
      }
      addRequest({
        edge,
        areaIndex: Math.max(
          0,
          Math.min(sourceLayer + 1, this.routingAreas.length - 1),
        ),
        start: 0,
        end: this.gridWidth,
        kind: "source",
        constraints: [{ column: source.column, edgeRow: sourceEdgeRow }],
      });
      addRequest({
        edge,
        areaIndex: Math.max(
          0,
          Math.min(targetLayer, this.routingAreas.length - 1),
        ),
        start: 0,
        end: this.gridWidth,
        kind: "target",
        constraints: [{ column: target.column, edgeRow: targetEdgeRow }],
      });
    }

    for (const requests of requestsByArea) {
      requests.sort((left, right) => {
        return (
          left.minimumAnchor - right.minimumAnchor ||
          left.maximumAnchor - right.maximumAnchor ||
          this.edgeSpan(right.edge) - this.edgeSpan(left.edge) ||
          left.edge.edgeIndex - right.edge.edgeIndex ||
          (left.kind === "short" ? 2 : left.kind === "source" ? 0 : 1) -
            (right.kind === "short" ? 2 : right.kind === "source" ? 0 : 1)
        );
      });

      for (const request of requests) {
        const row = this.laneRow(
          request.areaIndex,
          request.start,
          request.end,
          request.constraints,
          edgeKey(request.edge),
        );
        const assignment =
          this.trackAssignments.get(request.edge.edgeIndex) ?? {};
        if (request.kind === "short") assignment.shortRow = row;
        else if (request.kind === "source") assignment.sourceRow = row;
        else assignment.targetRow = row;
        this.trackAssignments.set(request.edge.edgeIndex, assignment);
        this.markPortHandles(request.areaIndex, request.constraints, row);
      }
    }
  }

  private markPortHandles(
    areaIndex: number,
    constraints: readonly HandleConstraint[],
    row: number,
  ): void {
    for (const constraint of constraints) {
      this.grid.markPortHandle(
        areaIndex,
        constraint.column,
        constraint.edgeRow,
        row,
        {
          kind: "v-lane",
          edgeKey: `port-handle:${constraint.column}:${constraint.edgeRow}`,
        },
      );
    }
  }

  private reservePortHandleColumns(edges: Edge[]): void {
    for (const edge of edges) {
      const sourceNode = this.getPlacedNode(edge.sourceId);
      const targetNode = this.getPlacedNode(edge.targetId);
      if (!sourceNode || !targetNode) continue;
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
      const sourceAreaIndex = Math.max(
        0,
        Math.min(
          this.getLayer(edge.sourceId) + 1,
          this.routingAreas.length - 1,
        ),
      );
      const targetAreaIndex = Math.max(
        0,
        Math.min(this.getLayer(edge.targetId), this.routingAreas.length - 1),
      );
      const sourceArea = this.routingAreas[sourceAreaIndex];
      const targetArea = this.routingAreas[targetAreaIndex];
      this.grid.markVerticalColumn(
        source.column,
        sourceArea.startRow,
        sourceArea.startRow + sourceArea.height - 1,
      );
      this.grid.markVerticalColumn(
        target.column,
        targetArea.startRow,
        targetArea.startRow + targetArea.height - 1,
      );
    }
  }

  private edgeSpan(edge: Edge): number {
    return Math.abs(
      this.getLayer(edge.targetId) - this.getLayer(edge.sourceId),
    );
  }

  private addBoundaryNodes(config: EdgeRouterConfig): void {
    const layerCount = config.routingAreas.length - 1;
    if (config.inId !== null) {
      this.boundaryNodes.set(config.inId, {
        nodeId: config.inId,
        column: 0,
        row: 0,
        width: config.scopeGridWidth,
        height: 0,
        layer: -1,
      });
    }
    if (config.outId !== null) {
      this.boundaryNodes.set(config.outId, {
        nodeId: config.outId,
        column: 0,
        row: config.gridHeight,
        width: config.scopeGridWidth,
        height: 0,
        layer: layerCount,
      });
    }
  }

  private getLayer(nodeId: number): number {
    if (nodeId === this.inId) return -1;
    if (nodeId === this.outId) return this.routingAreas.length - 1;
    return this.layerOf.get(nodeId) ?? 0;
  }

  private getPlacedNode(nodeId: number): PlacedNode | undefined {
    const boundary = this.boundaryNodes.get(nodeId);
    if (boundary) return boundary;
    const position = this.nodePositions.get(nodeId);
    if (!position) return undefined;
    return {
      nodeId,
      column: position.x,
      row: position.y,
      width: position.width,
      height: position.height,
      layer: this.getLayer(nodeId),
    };
  }

  private computePortEndpoint(
    nodeId: number,
    portIndex: number,
    placed: PlacedNode,
    side: "in" | "out",
  ): PortEndpoint {
    const isBoundary = nodeId === this.inId || nodeId === this.outId;
    const portCount =
      side === "out"
        ? (this.outputPortCounts.get(nodeId) ?? 1)
        : (this.inputPortCounts.get(nodeId) ?? 1);
    const portGridUnits = isBoundary
      ? placed.column + portOffset(placed.width, portIndex, portCount)
      : placed.column + gridAlignedPortOffset(portIndex);
    const edgeGridUnits =
      side === "out" ? placed.row + placed.height : placed.row;
    return {
      portPixels: this.offsetX + portGridUnits * GRID_UNIT,
      edgePixels: this.offsetY + edgeGridUnits * GRID_UNIT,
      column: Math.round(portGridUnits),
    };
  }

  private laneRow(
    areaIndex: number,
    start: number,
    end: number,
    handleConstraints: readonly HandleConstraint[] = [],
    routeKey = "",
  ): number {
    const area = this.routingAreas[areaIndex];
    const maximumLaneCount = Math.max(
      0,
      Math.floor((area.height - ROUTING_PADDING * 2) / LANE_SPACING),
    );
    let laneIndex: number;
    try {
      laneIndex = this.trackAllocators[areaIndex].reserve(
        start,
        end,
        maximumLaneCount,
        (candidate, intervalOverlap) => {
          const row = area.firstLaneRow + candidate * LANE_SPACING;
          const handleOverlap = handleConstraints.reduce(
            (total, constraint) =>
              total +
              this.grid.portHandleOverlapCost(
                areaIndex,
                constraint.column,
                constraint.edgeRow,
                row,
              ),
            0,
          );
          return intervalOverlap + handleOverlap;
        },
      );
    } catch (error) {
      throw new Error(
        `Unable to allocate a routing track in area ${areaIndex} for ${handleConstraints
          .map((constraint) => `${constraint.column}:${constraint.edgeRow}`)
          .join(",")} (${routeKey}); rows ${area.startRow}..${
          area.startRow + area.height - 1
        }, lanes ${maximumLaneCount}, allocated ${
          this.trackAllocators[areaIndex].laneCount
        }`,
        { cause: error },
      );
    }
    area.laneCount = Math.max(area.laneCount, laneIndex + 1);
    return area.firstLaneRow + laneIndex * LANE_SPACING;
  }

  private routeShortEdge(
    edge: Edge,
    source: PortEndpoint,
    target: PortEndpoint,
  ): Point[] {
    const row = this.trackAssignments.get(edge.edgeIndex)?.shortRow;
    if (row === undefined) {
      throw new Error(
        `Missing short-edge track assignment for ${edgeKey(edge)}`,
      );
    }
    const laneY = this.offsetY + row * GRID_UNIT;
    const key = edgeKey(edge);
    this.grid.markHorizontal(row, source.column, target.column, {
      kind: "h-lane",
      edgeKey: key,
    });
    return [
      { x: source.portPixels, y: source.edgePixels },
      { x: source.portPixels, y: laneY },
      { x: target.portPixels, y: laneY },
      { x: target.portPixels, y: target.edgePixels },
    ];
  }

  private routeLongEdge(
    edge: Edge,
    source: PortEndpoint,
    target: PortEndpoint,
  ): Point[] {
    const assignment = this.trackAssignments.get(edge.edgeIndex);
    const sourceRow = assignment?.sourceRow;
    const targetRow = assignment?.targetRow;
    if (sourceRow === undefined || targetRow === undefined) {
      throw new Error(
        `Missing long-edge track assignment for ${edgeKey(edge)}`,
      );
    }
    const sourceKey = edgeKey(edge);
    const verticalRowStart = Math.min(sourceRow, targetRow);
    const verticalRowEnd = Math.max(sourceRow, targetRow);
    const preferredColumn = Math.round((source.column + target.column) / 2);
    const verticalColumn = findBestVerticalLane(
      this.grid,
      verticalRowStart,
      verticalRowEnd,
      preferredColumn,
      this.gridWidth,
    );
    this.grid.markHorizontal(sourceRow, source.column, verticalColumn, {
      kind: "h-lane",
      edgeKey: sourceKey,
    });
    this.grid.markHorizontal(targetRow, verticalColumn, target.column, {
      kind: "h-lane",
      edgeKey: sourceKey,
    });
    this.grid.markVertical(verticalColumn, verticalRowStart, verticalRowEnd, {
      kind: "v-lane",
      edgeKey: sourceKey,
    });

    const sourceY = this.offsetY + sourceRow * GRID_UNIT;
    const targetY = this.offsetY + targetRow * GRID_UNIT;
    const verticalX = this.offsetX + verticalColumn * GRID_UNIT;
    return [
      { x: source.portPixels, y: source.edgePixels },
      { x: source.portPixels, y: sourceY },
      { x: verticalX, y: sourceY },
      { x: verticalX, y: targetY },
      { x: target.portPixels, y: targetY },
      { x: target.portPixels, y: target.edgePixels },
    ];
  }
}
