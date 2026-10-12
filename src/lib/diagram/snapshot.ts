import type { Edge } from "./graph.ts";
import type { Point } from "./point.ts";
import {
  type ScopeLayout,
  type NodePosition,
  NodePositionLookup,
} from "./positions.ts";

import type { ScopeRouting } from "./routing.ts";
export interface LayoutSnapshot {
  layouts: Array<{
    scopeId: string;
    nodePositions: Array<[number, NodePosition]>;
    gridWidth: number;
    gridHeight: number;
  }>;
  routing: Array<{
    scopeId: string;
    routedEdges: Edge[];
    crossings: Point[];
    routeOffsets: Uint32Array;
    routePoints: Float64Array;
    routeBounds: Float64Array;
  }>;
}

export function serializeLayoutSnapshot(
  layoutMap: ReadonlyMap<string, ScopeLayout>,
  routingMap: ReadonlyMap<string, ScopeRouting>,
): LayoutSnapshot {
  return {
    layouts: [...layoutMap.entries()].map(([scopeId, layout]) => ({
      scopeId,
      nodePositions: [...layout.nodePositions.entries()],
      gridWidth: layout.gridWidth,
      gridHeight: layout.gridHeight,
    })),
    routing: [...routingMap.entries()].map(([scopeId, routing]) => ({
      scopeId,
      routedEdges: routing.routedEdges,
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
    layoutMap.set(serialized.scopeId, {
      nodePositions,
      gridWidth: serialized.gridWidth,
      gridHeight: serialized.gridHeight,
    });
  }

  const routingMap = new Map<string, ScopeRouting>();
  for (const serialized of snapshot.routing) {
    routingMap.set(serialized.scopeId, {
      routedEdges: serialized.routedEdges,
      crossings: serialized.crossings,
      routeOffsets: serialized.routeOffsets,
      routePoints: serialized.routePoints,
      routeBounds: serialized.routeBounds,
    });
  }
  return { layoutMap, routingMap };
}
