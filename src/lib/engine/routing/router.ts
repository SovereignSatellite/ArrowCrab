import type { Edge } from "../graph/types.ts";
import type { Point } from "../../diagram/point.ts";
import {
  edgeKey,
  LayoutGrid,
  routingAreaIndex,
  type RoutingArea,
} from "./occupancy.ts";
import {
  NodePositionLookup,
  type NodePosition,
} from "../../diagram/positions.ts";
import type { RoutedPolyline } from "../../diagram/routing.ts";
import { TrackAllocator } from "./tracks.ts";
import {
  GRID_UNIT,
  gridAlignedPortOffset,
  LANE_SPACING,
  ROUTING_PADDING,
  portOffset,
} from "../../diagram/geometry.ts";

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
  let retained = 1;
  for (let index = 1; index < waypoints.length; index += 1) {
    const previous = waypoints[retained - 1];
    const current = waypoints[index];
    if (current.x !== previous.x || current.y !== previous.y) {
      waypoints[retained] = current;
      retained += 1;
    }
  }
  waypoints.length = retained;
  return waypoints;
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
  entryPortCount: number;
  exitPortCount: number;
  gridWidth: number;
  gridHeight: number;
  offsetX: number;
  offsetY: number;
  inId: number | null;
  outId: number | null;
}

interface HandleConstraint {
  column: number;
  edgeRow: number;
}

interface TrackRequest {
  edge: Edge;
  start: number;
  end: number;
  phase: "start" | "finish";
  constraints:
    readonly [HandleConstraint] | readonly [HandleConstraint, HandleConstraint];
}

interface LongEdgeTracks {
  sourceRow: number;
  targetRow: number;
}

export class EdgeRouter {
  private readonly grid: LayoutGrid;
  private readonly routingAreas: RoutingArea[];
  private readonly entryPortCount: number;
  private readonly exitPortCount: number;
  private readonly gridWidth: number;
  private readonly offsetX: number;
  private readonly offsetY: number;
  private readonly inId: number | null;
  private readonly outId: number | null;
  private readonly nodePositions: NodePositionLookup;
  private readonly boundaryNodes = new Map<number, NodePosition>();
  private readonly trackAllocators: TrackAllocator[];
  private readonly trackAssignments = new Map<
    number,
    number | LongEdgeTracks
  >();

  constructor(config: EdgeRouterConfig) {
    this.grid = config.grid;
    this.routingAreas = config.routingAreas;
    this.entryPortCount = config.entryPortCount;
    this.exitPortCount = config.exitPortCount;
    this.gridWidth = config.gridWidth;
    this.offsetX = config.offsetX;
    this.offsetY = config.offsetY;
    this.inId = config.inId;
    this.outId = config.outId;
    this.nodePositions = config.nodePositions;
    this.trackAllocators = this.routingAreas.map(() => new TrackAllocator());
    this.addBoundaryNodes(config);
  }

  run(edges: Edge[]): RoutedPolyline[] {
    this.reservePortHandleColumns(edges);
    this.preallocateTracks(edges);
    const sortedEdges = [...edges].sort((left, right) => {
      const leftSpan = this.edgeSpan(left);
      const rightSpan = this.edgeSpan(right);
      return rightSpan - leftSpan || left.edgeIndex - right.edgeIndex;
    });
    return sortedEdges.map((edge) => {
      const sourceNode = this.getPlacedNode(edge.sourceId);
      const targetNode = this.getPlacedNode(edge.targetId);

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
        targetLayer === sourceLayer + 1
          ? this.routeShortEdge(edge, source, target)
          : this.routeLongEdge(edge, source, target);
      return { edge, waypoints: deduplicateWaypoints(waypoints) };
    });
  }

  private preallocateTracks(edges: Edge[]): void {
    const requestsByArea: TrackRequest[][] = this.routingAreas.map(() => []);
    for (const edge of edges) {
      const sourceNode = this.getPlacedNode(edge.sourceId);
      const targetNode = this.getPlacedNode(edge.targetId);
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
      if (targetLayer === sourceLayer + 1) {
        requestsByArea[sourceLayer + 1].push({
          edge,
          start: source.column,
          end: target.column,
          phase: "start",
          constraints: [
            { column: source.column, edgeRow: sourceEdgeRow },
            { column: target.column, edgeRow: targetEdgeRow },
          ],
        });
        continue;
      }
      requestsByArea[sourceLayer + 1].push({
        edge,
        start: 0,
        end: this.gridWidth,
        phase: "start",
        constraints: [{ column: source.column, edgeRow: sourceEdgeRow }],
      });
      requestsByArea[targetLayer].push({
        edge,
        start: 0,
        end: this.gridWidth,
        phase: "finish",
        constraints: [{ column: target.column, edgeRow: targetEdgeRow }],
      });
    }

    for (let areaIndex = 0; areaIndex < requestsByArea.length; areaIndex += 1) {
      const requests = requestsByArea[areaIndex];
      requests.sort((left, right) => {
        return (
          left.constraints[0].edgeRow - right.constraints[0].edgeRow ||
          left.constraints[left.constraints.length - 1].edgeRow -
            right.constraints[right.constraints.length - 1].edgeRow ||
          this.edgeSpan(right.edge) - this.edgeSpan(left.edge) ||
          left.edge.edgeIndex - right.edge.edgeIndex
        );
      });

      for (const request of requests) {
        const row = this.laneRow(
          areaIndex,
          request.start,
          request.end,
          request.constraints,
          request.edge,
        );
        if (request.phase === "finish") {
          this.trackAssignments.set(request.edge.edgeIndex, {
            sourceRow: this.trackAssignments.get(
              request.edge.edgeIndex,
            ) as number,
            targetRow: row,
          });
        } else {
          this.trackAssignments.set(request.edge.edgeIndex, row);
        }
        this.markPortHandles(areaIndex, request.constraints, row);
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
      );
    }
  }

  private reservePortHandleColumns(edges: Edge[]): void {
    for (const edge of edges) {
      const sourceNode = this.getPlacedNode(edge.sourceId);
      const targetNode = this.getPlacedNode(edge.targetId);
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
      const sourceAreaIndex = this.getLayer(edge.sourceId) + 1;
      const targetAreaIndex = this.getLayer(edge.targetId);
      const sourceArea = this.routingAreas[sourceAreaIndex];
      const targetArea = this.routingAreas[targetAreaIndex];
      this.grid.reservePortColumn(
        source.column,
        sourceArea.startRow,
        sourceArea.startRow + sourceArea.height - 1,
      );
      this.grid.reservePortColumn(
        target.column,
        targetArea.startRow,
        targetArea.startRow + targetArea.height - 1,
      );
    }
  }

  private edgeSpan(edge: Edge): number {
    return this.getLayer(edge.targetId) - this.getLayer(edge.sourceId);
  }

  private addBoundaryNodes(config: EdgeRouterConfig): void {
    if (config.inId !== null) {
      this.boundaryNodes.set(config.inId, {
        x: 0,
        y: 0,
        width: config.gridWidth,
        height: 0,
      });
    }
    if (config.outId !== null) {
      this.boundaryNodes.set(config.outId, {
        x: 0,
        y: config.gridHeight,
        width: config.gridWidth,
        height: 0,
      });
    }
  }

  private getLayer(nodeId: number): number {
    if (nodeId === this.inId) return -1;
    if (nodeId === this.outId) return this.routingAreas.length - 1;
    return routingAreaIndex(
      this.routingAreas,
      this.nodePositions.get(nodeId)!.y,
    );
  }

  private getPlacedNode(nodeId: number): NodePosition {
    if (nodeId === this.inId || nodeId === this.outId) {
      return this.boundaryNodes.get(nodeId)!;
    }
    return this.nodePositions.get(nodeId)!;
  }

  private computePortEndpoint(
    nodeId: number,
    portIndex: number,
    placed: NodePosition,
    side: "in" | "out",
  ): PortEndpoint {
    const isBoundary = nodeId === this.inId || nodeId === this.outId;
    const portGridUnits = isBoundary
      ? placed.x +
        portOffset(
          placed.width,
          portIndex,
          side === "out" ? this.entryPortCount : this.exitPortCount,
        )
      : placed.x + gridAlignedPortOffset(portIndex);
    const edgeGridUnits = side === "out" ? placed.y + placed.height : placed.y;
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
    handleConstraints: readonly HandleConstraint[],
    edge: Edge,
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
          const row =
            area.startRow + ROUTING_PADDING + candidate * LANE_SPACING;
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
          .join(",")} (${edgeKey(edge)}); rows ${area.startRow}..${
          area.startRow + area.height - 1
        }, lanes ${maximumLaneCount}, allocated ${
          this.trackAllocators[areaIndex].laneCount
        }`,
        { cause: error },
      );
    }
    return area.startRow + ROUTING_PADDING + laneIndex * LANE_SPACING;
  }

  private routeShortEdge(
    edge: Edge,
    source: PortEndpoint,
    target: PortEndpoint,
  ): Point[] {
    const row = this.trackAssignments.get(edge.edgeIndex) as number;
    const laneY = this.offsetY + row * GRID_UNIT;
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
    const { sourceRow, targetRow } = this.trackAssignments.get(
      edge.edgeIndex,
    ) as LongEdgeTracks;
    const preferredColumn = Math.round((source.column + target.column) / 2);
    const verticalColumn = findBestVerticalLane(
      this.grid,
      sourceRow,
      targetRow,
      preferredColumn,
      this.gridWidth,
    );
    this.grid.markVerticalRoute(verticalColumn, sourceRow, targetRow);

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
