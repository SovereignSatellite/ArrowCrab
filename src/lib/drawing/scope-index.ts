import { isNodeExpanded } from "../diagram/types.ts";
import {
  subgraphScopeId,
  GRID_UNIT,
  LABEL_BAR_HEIGHT,
  NODE_INNER_GAP,
} from "../diagram/geometry.ts";
import { SpatialIndex, spatialEntry } from "./spatial-index.ts";

import {
  CROSSING_CIRCLE_RADIUS,
  CROSSING_CIRCLE_WIDTH,
  EDGE_STROKE_WIDTH,
  NODE_DECORATION_MARGIN,
  NODE_LABEL_FONT,
  NODE_LABEL_OUTLINE_WIDTH,
} from "./styles.ts";
import type { DrawingFrame } from "./types.ts";

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ScopeRenderIndex {
  readonly nodeIndex: SpatialIndex<number>;
  readonly edgeIndex: SpatialIndex<number>;
  readonly crossingIndex: SpatialIndex<number>;
  readonly bounds: Readonly<Bounds>;
}

type ScopeIndexContext = Pick<
  DrawingFrame,
  "context" | "nodeMap" | "layoutMap" | "routingMap" | "scopeIndexes"
>;

function includeBounds(
  target: Bounds,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): void {
  target.minX = Math.min(target.minX, minX);
  target.minY = Math.min(target.minY, minY);
  target.maxX = Math.max(target.maxX, maxX);
  target.maxY = Math.max(target.maxY, maxY);
}

export function getScopeRenderIndex(
  scene: ScopeIndexContext,
  scopeId: string,
  offsetX: number,
  offsetY: number,
): ScopeRenderIndex {
  const cached = scene.scopeIndexes.get(scopeId);
  if (cached) return cached;

  const layout = scene.layoutMap.get(scopeId)!;
  const routing = scene.routingMap.get(scopeId)!;
  const bounds = {
    minX: 0,
    minY: 0,
    maxX: layout.gridWidth * GRID_UNIT,
    maxY: layout.gridHeight * GRID_UNIT,
  };
  const nodeEntries = [];
  const context = scene.context;
  context.save();
  try {
    context.font = NODE_LABEL_FONT;
    context.textAlign = "center";
    context.textBaseline = "middle";
    const outline = NODE_LABEL_OUTLINE_WIDTH / 2;
    for (const [nodeId, position] of layout.nodePositions) {
      const node = scene.nodeMap.get(nodeId)!;
      const x = position.x * GRID_UNIT;
      const y = position.y * GRID_UNIT;
      const width = position.width * GRID_UNIT;
      const height = position.height * GRID_UNIT;
      const expanded = isNodeExpanded(scene, node);
      const labelX = x + width / 2;
      const labelY = y + (expanded ? LABEL_BAR_HEIGHT * GRID_UNIT : height) / 2;
      const text = context.measureText(node.label);
      const entry = {
        item: nodeId,
        minX: x - NODE_DECORATION_MARGIN,
        minY: y - NODE_DECORATION_MARGIN,
        maxX: x + width + NODE_DECORATION_MARGIN,
        maxY: y + height + NODE_DECORATION_MARGIN,
      };
      includeBounds(
        entry,
        labelX - text.actualBoundingBoxLeft - outline,
        labelY - text.actualBoundingBoxAscent - outline,
        labelX + text.actualBoundingBoxRight + outline,
        labelY + text.actualBoundingBoxDescent + outline,
      );
      if (expanded) {
        let childX = x + NODE_INNER_GAP * GRID_UNIT;
        const childY = y + (LABEL_BAR_HEIGHT + NODE_INNER_GAP) * GRID_UNIT;
        for (const subgraph of node.subgraphs) {
          const childId = subgraphScopeId(subgraph.inId, subgraph.outId);
          const child = getScopeRenderIndex(
            scene,
            childId,
            offsetX + childX,
            offsetY + childY,
          );
          includeBounds(
            entry,
            childX + child.bounds.minX,
            childY + child.bounds.minY,
            childX + child.bounds.maxX,
            childY + child.bounds.maxY,
          );
          childX +=
            (scene.layoutMap.get(childId)!.gridWidth + NODE_INNER_GAP) *
            GRID_UNIT;
        }
      }
      nodeEntries.push(entry);
      includeBounds(bounds, entry.minX, entry.minY, entry.maxX, entry.maxY);
    }
  } finally {
    context.restore();
  }

  const edgeEntries = [];
  const routeMargin = EDGE_STROKE_WIDTH / 2 + 3;
  for (let index = 0; index < routing.routedEdges.length; index += 1) {
    const slot = index * 4;
    const entry = spatialEntry(
      index,
      routing.routeBounds[slot] - routeMargin,
      routing.routeBounds[slot + 1] - routeMargin,
      routing.routeBounds[slot + 2] + routeMargin,
      routing.routeBounds[slot + 3] + routeMargin,
    );
    edgeEntries.push(entry);
    includeBounds(
      bounds,
      entry.minX - offsetX,
      entry.minY - offsetY,
      entry.maxX - offsetX,
      entry.maxY - offsetY,
    );
  }
  const crossingMargin = CROSSING_CIRCLE_RADIUS + CROSSING_CIRCLE_WIDTH / 2;
  const crossingEntries = routing.crossings.map((point, index) =>
    spatialEntry(
      index,
      point.x - crossingMargin,
      point.y - crossingMargin,
      point.x + crossingMargin,
      point.y + crossingMargin,
    ),
  );
  for (const entry of crossingEntries) {
    includeBounds(
      bounds,
      entry.minX - offsetX,
      entry.minY - offsetY,
      entry.maxX - offsetX,
      entry.maxY - offsetY,
    );
  }
  const result = {
    bounds,
    nodeIndex: new SpatialIndex(nodeEntries, 240),
    edgeIndex: new SpatialIndex(edgeEntries, 240),
    crossingIndex: new SpatialIndex(crossingEntries, 240),
  };
  scene.scopeIndexes.set(scopeId, result);
  return result;
}
