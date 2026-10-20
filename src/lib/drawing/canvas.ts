import {
  LOD_FULL,
  LOD_SIMPLIFIED,
  NODE_LABEL_FONT,
  NODE_LABEL_OUTLINE_WIDTH,
} from "./styles.ts";
import { isNodeExpanded, type Diagram } from "../diagram/types.ts";
import type { DrawingContext } from "./context.ts";
import { getScopeRenderIndex, type ScopeRenderIndex } from "./scope-index.ts";
import type { DiagramNode } from "../diagram/graph.ts";
import {
  TOP_LEVEL_SCOPE_ID,
  subgraphScopeId,
  GRID_UNIT,
  LABEL_BAR_HEIGHT,
  NODE_INNER_GAP,
} from "../diagram/geometry.ts";
import type { NodePosition } from "../diagram/positions.ts";
import { getRoutePoints, type ScopeRouting } from "../diagram/routing.ts";
import { outlinedText } from "./canvas-primitives.ts";
import { ColorPalette } from "./colors.ts";
import { drawNodeBody, drawLeafNodeDetails, drawPorts } from "./canvas-node.ts";
import {
  drawSubgraphFrame,
  drawSubgraphLabel,
  drawBoundaryPorts,
} from "./canvas-subgraph.ts";
import { drawEdge, drawCrossingCircle } from "./canvas-edge.ts";
import type {
  DrawingFrame,
  VisibleRect,
  DrawingSurface,
  DrawingOptions,
  DrawingResult,
  StructuralRenderer,
} from "./types.ts";

const DIM_ALPHA = 0.15;
const COMPACT_MARKER_STROKE = 1.5;

function drawCompactCompoundMarker(
  context: DrawingContext,
  pixelX: number,
  pixelY: number,
  pixelWidth: number,
  pixelHeight: number,
  scale: number,
  isExpanded: boolean,
): void {
  const centerX = pixelX + pixelWidth / 2;
  const centerY = pixelY + pixelHeight / 2;
  const horizontalArm = Math.min(pixelWidth * 0.35, 8 / scale);
  const verticalArm = Math.min(pixelHeight * 0.35, 8 / scale);
  const lineWidth = COMPACT_MARKER_STROKE / scale;

  context.save();
  context.lineCap = "square";
  context.beginPath();
  context.moveTo(centerX - horizontalArm, centerY);
  context.lineTo(centerX + horizontalArm, centerY);
  if (!isExpanded) {
    context.moveTo(centerX, centerY - verticalArm);
    context.lineTo(centerX, centerY + verticalArm);
  }
  context.strokeStyle = "#000000";
  context.lineWidth = lineWidth * 2;
  context.stroke();
  context.strokeStyle = "#ffffff";
  context.lineWidth = lineWidth;
  context.stroke();
  context.restore();
}

export function createDrawing(
  context: DrawingContext,
  colorContext: DrawingContext,
  structuralRenderer: StructuralRenderer | null,
): DrawingSurface {
  return {
    context,
    colors: new ColorPalette(colorContext),
    structuralRenderer,
    scopeIndexes: new Map(),
    indexedDiagram: null,
  };
}

function selectDiagram(surface: DrawingSurface, diagram: Diagram): void {
  if (surface.indexedDiagram !== diagram) {
    surface.scopeIndexes.clear();
    surface.indexedDiagram = diagram;
  }
}

export function measureDiagram(
  surface: DrawingSurface,
  diagram: Diagram,
): Readonly<{ minX: number; minY: number; maxX: number; maxY: number }> {
  selectDiagram(surface, diagram);
  return getScopeRenderIndex(
    {
      ...diagram,
      context: surface.context,
      scopeIndexes: surface.scopeIndexes,
    },
    TOP_LEVEL_SCOPE_ID,
    0,
    0,
  ).bounds;
}

export function drawDiagram(
  surface: DrawingSurface,
  diagram: Diagram,
  options: DrawingOptions,
): DrawingResult {
  selectDiagram(surface, diagram);
  const scene: DrawingFrame = {
    ...diagram,
    ...options,
    context: surface.context,
    colors: surface.colors,
    structuralRenderer: surface.structuralRenderer,
    scopeIndexes: surface.scopeIndexes,
    nodes: [],
    edges: [],
  };
  const { context, viewport } = scene;
  context.setTransform(options.pixelRatio, 0, 0, options.pixelRatio, 0, 0);
  context.clearRect(0, 0, options.width, options.height);
  if (options.background !== null && !scene.structuralRenderer) {
    context.fillStyle = options.background;
    context.fillRect(0, 0, options.width, options.height);
  }
  context.save();
  context.translate(viewport.offsetX, viewport.offsetY);
  context.scale(viewport.scale, viewport.scale);
  const padding =
    (COMPACT_MARKER_STROKE + 1 / options.pixelRatio) / viewport.scale;
  const visibleRect = {
    left: -viewport.offsetX / viewport.scale - padding,
    top: -viewport.offsetY / viewport.scale - padding,
    right: (-viewport.offsetX + options.width) / viewport.scale + padding,
    bottom: (-viewport.offsetY + options.height) / viewport.scale + padding,
  };
  scene.structuralRenderer?.render(scene, visibleRect);
  renderScope(scene, TOP_LEVEL_SCOPE_ID, 0, 0, visibleRect);
  context.restore();
  return { nodes: scene.nodes, edges: scene.edges };
}

function renderScope(
  scene: DrawingFrame,
  scopeId: string,
  offsetX: number,
  offsetY: number,
  visibleRect: VisibleRect,
): void {
  const layout = scene.layoutMap.get(scopeId)!;
  const routing = scene.routingMap.get(scopeId)!;
  const indexes = getScopeRenderIndex(scene, scopeId, offsetX, offsetY);
  const hasHighlights =
    scene.highlightedNodes.size > 0 || scene.highlightedEdges.size > 0;

  renderEdges(scene, routing, indexes, hasHighlights, visibleRect);
  const visibleNodeIds = indexes.nodeIndex.query(
    visibleRect.left - offsetX,
    visibleRect.top - offsetY,
    visibleRect.right - offsetX,
    visibleRect.bottom - offsetY,
  );

  for (const nodeId of visibleNodeIds) {
    const position = layout.nodePositions.get(nodeId)!;

    const pixelX = offsetX + position.x * GRID_UNIT;
    const pixelY = offsetY + position.y * GRID_UNIT;
    const pixelWidth = position.width * GRID_UNIT;
    const pixelHeight = position.height * GRID_UNIT;

    const node = scene.nodeMap.get(nodeId)!;
    const isCompound = node.subgraphs.length > 0;
    const isExpanded = isNodeExpanded(scene, node);

    if (hasHighlights) {
      if (scene.highlightedNodes.has(nodeId)) {
        scene.context.globalAlpha = 1.0;
      } else {
        scene.context.globalAlpha = DIM_ALPHA;
      }
    }

    const screenPixelWidth = pixelWidth * scene.viewport.scale;
    if (!scene.structuralRenderer || screenPixelWidth >= LOD_FULL) {
      if (screenPixelWidth < LOD_SIMPLIFIED) {
        scene.context.fillStyle = node.color;
        scene.context.fillRect(pixelX, pixelY, pixelWidth, pixelHeight);
      } else if (screenPixelWidth < LOD_FULL) {
        drawNodeBody(
          scene.context,
          scene.colors,
          pixelX,
          pixelY,
          pixelWidth,
          pixelHeight,
          node.color,
        );
      } else if (isExpanded) {
        renderExpandedNode(scene, node, position, pixelX, pixelY, visibleRect);
      } else {
        renderLeafNode(scene, node, position, pixelX, pixelY, visibleRect);
      }
    }

    if (isCompound && screenPixelWidth < LOD_FULL) {
      drawCompactCompoundMarker(
        scene.context,
        pixelX,
        pixelY,
        pixelWidth,
        pixelHeight,
        scene.viewport.scale,
        isExpanded,
      );
    }

    scene.context.globalAlpha = 1.0;

    scene.nodes.push({
      nodeId: node.id,
      x: pixelX,
      y: pixelY,
      width: pixelWidth,
      height: pixelHeight,
    });
  }
}

function renderEdges(
  scene: DrawingFrame,
  routing: ScopeRouting,
  indexes: ScopeRenderIndex,
  hasHighlights: boolean,
  visibleRect: VisibleRect,
): void {
  const visibleEdgeIndices = indexes.edgeIndex
    .query(
      visibleRect.left,
      visibleRect.top,
      visibleRect.right,
      visibleRect.bottom,
    )
    .sort((left, right) => left - right);

  for (const edgeIndex of visibleEdgeIndices) {
    const routedEdge = routing.routedEdges[edgeIndex];
    const points = getRoutePoints(routing, edgeIndex);

    if (!scene.structuralRenderer) {
      if (hasHighlights) {
        scene.context.globalAlpha = scene.highlightedEdges.has(
          routedEdge.edgeIndex,
        )
          ? 1.0
          : DIM_ALPHA;
      }
      drawEdge(scene.context, {
        points,
        color: scene.colors.edgeColor(routedEdge.edgeIndex),
      });
    }

    scene.edges.push({
      edge: routedEdge,
      points,
    });
  }

  if (!scene.structuralRenderer) {
    if (hasHighlights) {
      scene.context.globalAlpha = DIM_ALPHA;
    }
    const visibleCrossingIndices = indexes.crossingIndex
      .query(
        visibleRect.left,
        visibleRect.top,
        visibleRect.right,
        visibleRect.bottom,
      )
      .sort((left, right) => left - right);
    for (const crossingIndex of visibleCrossingIndices) {
      const crossing = routing.crossings[crossingIndex];
      drawCrossingCircle(scene.context, {
        x: crossing.x,
        y: crossing.y,
      });
    }
  }
  scene.context.globalAlpha = 1.0;
}

function renderLeafNode(
  scene: DrawingFrame,
  node: DiagramNode,
  position: NodePosition,
  pixelX: number,
  pixelY: number,
  visibleRect: VisibleRect,
): void {
  const width = position.width * GRID_UNIT;
  const height = position.height * GRID_UNIT;
  if (!scene.structuralRenderer) {
    drawNodeBody(
      scene.context,
      scene.colors,
      pixelX,
      pixelY,
      width,
      height,
      node.color,
    );
  }
  drawLeafNodeDetails(scene.context, scene.colors, {
    x: pixelX,
    y: pixelY,
    width,
    height,
    node,
    visibleRect,
  });
}

function renderExpandedNode(
  scene: DrawingFrame,
  node: DiagramNode,
  position: NodePosition,
  pixelX: number,
  pixelY: number,
  visibleRect: VisibleRect,
): void {
  const context = scene.context;
  const width = position.width * GRID_UNIT;
  const height = position.height * GRID_UNIT;

  if (!scene.structuralRenderer) {
    drawNodeBody(
      context,
      scene.colors,
      pixelX,
      pixelY,
      width,
      height,
      node.color,
    );
  }

  const labelBarCenterY = pixelY + (LABEL_BAR_HEIGHT * GRID_UNIT) / 2;
  outlinedText(context, node.label, pixelX + width / 2, labelBarCenterY, {
    font: NODE_LABEL_FONT,
    fillStyle: "#ffffff",
    strokeStyle: "#000000",
    strokeWidth: NODE_LABEL_OUTLINE_WIDTH,
    textAlign: "center",
    textBaseline: "middle",
  });

  outlinedText(context, String(node.id), pixelX + width + 3, pixelY - 2, {
    font: "9px monospace",
    fillStyle: "#dddddd",
    strokeStyle: "#000000",
    strokeWidth: 1,
    textAlign: "left",
    textBaseline: "bottom",
  });

  outlinedText(context, "[\u2212]", pixelX + 4, pixelY + 4, {
    font: "bold 10px monospace",
    fillStyle: "#eeeeee",
    strokeStyle: "#000000",
    strokeWidth: 1,
    textAlign: "left",
    textBaseline: "top",
  });

  if (node.inputPortCount > 0) {
    drawPorts(context, scene.colors, {
      x: pixelX,
      y: pixelY,
      portCount: node.inputPortCount,
      labelSide: "above",
      color: node.color,
      visibleRect,
    });
  }
  if (node.outputPortCount > 0) {
    drawPorts(context, scene.colors, {
      x: pixelX,
      y: pixelY + height,
      portCount: node.outputPortCount,
      labelSide: "below",
      color: node.color,
      visibleRect,
    });
  }

  context.globalAlpha = 1.0;

  renderChildSubgraphs(scene, node, pixelX, pixelY, visibleRect);
}

function renderChildSubgraphs(
  scene: DrawingFrame,
  node: DiagramNode,
  pixelX: number,
  pixelY: number,
  visibleRect: VisibleRect,
): void {
  const context = scene.context;
  const subgraphAreaY =
    pixelY + (LABEL_BAR_HEIGHT + NODE_INNER_GAP) * GRID_UNIT;
  let currentSubgraphX = pixelX + NODE_INNER_GAP * GRID_UNIT;
  let maxFrameHeight = 0;

  for (
    let subgraphIndex = 0;
    subgraphIndex < node.subgraphs.length;
    subgraphIndex += 1
  ) {
    const subgraph = node.subgraphs[subgraphIndex];
    const childScopeId = subgraphScopeId(subgraph.inId, subgraph.outId);
    const childLayout = scene.layoutMap.get(childScopeId)!;

    const frameWidth = childLayout.gridWidth * GRID_UNIT;
    const frameHeight = childLayout.gridHeight * GRID_UNIT;
    maxFrameHeight = Math.max(maxFrameHeight, frameHeight);

    if (!scene.structuralRenderer) {
      drawSubgraphFrame(context, scene.colors, {
        x: currentSubgraphX,
        y: subgraphAreaY,
        width: frameWidth,
        height: frameHeight,
        parentColor: node.color,
      });
    }
    if (node.subgraphs.length > 1) {
      drawSubgraphLabel(
        context,
        String(subgraphIndex),
        currentSubgraphX,
        subgraphAreaY,
      );
    }

    const entryNode = scene.nodeMap.get(subgraph.inId)!;
    const exitNode = scene.nodeMap.get(subgraph.outId)!;

    if (entryNode.outputPortCount > 0) {
      drawBoundaryPorts(context, scene.colors, {
        x: currentSubgraphX,
        y: subgraphAreaY,
        frameWidthGridUnits: childLayout.gridWidth,
        portCount: entryNode.outputPortCount,
        parentColor: node.color,
      });
    }
    if (exitNode.inputPortCount > 0) {
      drawBoundaryPorts(context, scene.colors, {
        x: currentSubgraphX,
        y: subgraphAreaY + frameHeight,
        frameWidthGridUnits: childLayout.gridWidth,
        portCount: exitNode.inputPortCount,
        parentColor: node.color,
      });
    }

    renderScope(
      scene,
      childScopeId,
      currentSubgraphX,
      subgraphAreaY,
      visibleRect,
    );

    currentSubgraphX += frameWidth + NODE_INNER_GAP * GRID_UNIT;

    if (subgraphIndex < node.subgraphs.length - 1) {
      const dividerX = currentSubgraphX - (NODE_INNER_GAP * GRID_UNIT) / 2;
      context.beginPath();
      context.moveTo(dividerX, subgraphAreaY);
      context.lineTo(dividerX, subgraphAreaY + maxFrameHeight);
      context.strokeStyle = scene.colors.darkenColor(node.color, 0.1);
      context.lineWidth = 0.5;
      context.stroke();
    }
  }
}
