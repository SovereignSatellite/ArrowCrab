import type { Edge } from "../graph/types";
import type { Point } from "../geometry/types";
import { LayoutGrid } from "../routing/occupancy";
import type { ScopeLayout, NodePosition } from "../layout/types";
import { NodePositionLookup } from "../layout/types";
import type { ScopeRouting } from "../routing/types";
import { buildPackedRoutingIndexes } from "../routing/packing";
import { TilePyramid, tileEntry } from "./tile-pyramid";

export interface LayoutSnapshot {
  layouts: Array<{
    scopeId: string;
    nodePositions: Array<[number, NodePosition]>;
    gridWidth: number;
    gridHeight: number;
    channelY: number[];
    channelLaneCount: number[];
    layerOf: Array<[number, number]>;
    layers: number[][];
  }>;
  routing: Array<{
    scopeId: string;
    routedEdges: Array<{
      edge: Edge;
      colorIndex: number;
      key: string;
    }>;
    crossings: Point[];
    routeOffsets: Uint32Array;
    routePoints: Float64Array;
    routeBounds: Float64Array;
  }>;
}

export function serializeLayoutSnapshot(
  layoutMap: Map<string, ScopeLayout>,
  routingMap: Map<string, ScopeRouting>,
): LayoutSnapshot {
  return {
    layouts: [...layoutMap.entries()].map(([scopeId, layout]) => ({
      scopeId,
      nodePositions: [...layout.nodePositions.entries()],
      gridWidth: layout.gridWidth,
      gridHeight: layout.gridHeight,
      channelY: layout.channelY,
      channelLaneCount: layout.channelLaneCount,
      layerOf: [...layout.layerOf.entries()],
      layers: layout.layers,
    })),
    routing: [...routingMap.entries()].map(([scopeId, routing]) => ({
      scopeId,
      routedEdges: routing.routedEdges.map(({ edge, colorIndex, key }) => ({
        edge,
        colorIndex,
        key,
      })),
      crossings: routing.crossings,
      routeOffsets: routing.routeOffsets,
      routePoints: routing.routePoints,
      routeBounds: routing.routeBounds,
    })),
  };
}

export function deserializeLayoutSnapshot(snapshot: LayoutSnapshot): {
  layoutMap: Map<string, ScopeLayout>;
  routingMap: Map<string, ScopeRouting>;
} {
  const layoutMap = new Map<string, ScopeLayout>();
  for (const serialized of snapshot.layouts) {
    const nodePositions = new NodePositionLookup(serialized.nodePositions);
    const layerOf = new Map(serialized.layerOf);
    const grid = new LayoutGrid();
    const nodeTileEntries = [];
    for (const [nodeId, position] of nodePositions) {
      grid.markNodeRect(
        position.x,
        position.y,
        position.width,
        position.height,
      );
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
    layoutMap.set(serialized.scopeId, {
      nodePositions,
      gridWidth: serialized.gridWidth,
      gridHeight: serialized.gridHeight,
      channelY: serialized.channelY,
      channelLaneCount: serialized.channelLaneCount,
      layerOf,
      layers: serialized.layers,
      grid,
      nodeTileIndex: new TilePyramid(nodeTileEntries, 20),
    });
  }

  const routingMap = new Map<string, ScopeRouting>();
  for (const serialized of snapshot.routing) {
    const routedEdges = serialized.routedEdges;
    routingMap.set(serialized.scopeId, {
      routedEdges,
      crossings: serialized.crossings,
      ...buildPackedRoutingIndexes(
        serialized.routeOffsets,
        serialized.routePoints,
        serialized.routeBounds,
        serialized.crossings,
      ),
    });
  }
  return { layoutMap, routingMap };
}
