import type { Node } from "../graph/types";
import { TOP_LEVEL_SCOPE_ID, subgraphScopeId } from "../graph/scopes";
import type { NodePosition } from "../layout/types";
import type { ScopeRouting } from "../routing/types";
import type { Point } from "../geometry/types";
import {
  GRID_UNIT,
  LABEL_BAR_HEIGHT,
  NODE_INNER_GAP,
  NODE_STROKE_WIDTH,
  gridAlignedPortOffset,
} from "./constants";
import { roundedRect, outlinedText, resetTextState } from "./canvas-primitives";
import { darkenColor, edgeColor } from "./colors";
import { drawNode, drawPorts } from "./canvas-node";
import { drawSubgraphFrame, drawBoundaryPorts } from "./canvas-subgraph";
import { drawEdge, drawCrossingCircle } from "./canvas-edge";
import type { GraphScene, VisibleRect } from "./scene-types";

function unpackRoutePoints(routing: ScopeRouting, routeIndex: number): Point[] {
  const start = routing.routeOffsets[routeIndex];
  const end = routing.routeOffsets[routeIndex + 1];
  const points: Point[] = [];
  for (let pointIndex = start; pointIndex < end; pointIndex += 1) {
    points.push({
      x: routing.routePoints[pointIndex * 2],
      y: routing.routePoints[pointIndex * 2 + 1],
    });
  }
  return points;
}

const DIM_ALPHA = 0.15;
const EXPANDED_NODE_CORNER_RADIUS = 3;

const portOffsetCache: number[][] = [];

function getPortOffsets(portCount: number): number[] {
  let offsets = portOffsetCache[portCount];
  if (!offsets) {
    offsets = Array.from({ length: portCount }, (_, i) =>
      gridAlignedPortOffset(i),
    );
    portOffsetCache[portCount] = offsets;
  }
  return offsets;
}

const LOD_FULL = 40;
const LOD_SIMPLIFIED = 8;
const LOD_DOT = 2;

function drawCompactCompoundMarker(
  context: CanvasRenderingContext2D,
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
  const lineWidth = Math.max(1.5 / scale, 1);

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

export function render(scene: GraphScene): void {
  const { context, viewport } = scene;
  const canvas = context.canvas;

  context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  resetTextState();

  context.save();
  context.translate(viewport.offsetX, viewport.offsetY);
  context.scale(viewport.scale, viewport.scale);

  const visibleRect: VisibleRect = {
    left: -viewport.offsetX / viewport.scale,
    top: -viewport.offsetY / viewport.scale,
    right: (-viewport.offsetX + canvas.clientWidth) / viewport.scale,
    bottom: (-viewport.offsetY + canvas.clientHeight) / viewport.scale,
  };

  if (scene.webglRenderer) {
    scene.webglRenderer.render(scene, visibleRect);
  }

  scene.toggleRegions = [];
  scene.leafNodeRegions = [];
  scene.expandedNodeRegions = [];
  scene.edgeRegions = [];
  renderScope(scene, TOP_LEVEL_SCOPE_ID, 0, 0, visibleRect);

  context.restore();
}

function renderScope(
  scene: GraphScene,
  scopeId: string,
  offsetX: number,
  offsetY: number,
  visibleRect: VisibleRect,
): void {
  const layout = scene.layoutMap.get(scopeId)!;
  const routing = scene.routingMap.get(scopeId);
  const hasSelection =
    scene.highlightedNodes.size > 0 || scene.highlightedEdges.size > 0;

  if (routing) {
    renderEdges(scene, routing, hasSelection, visibleRect);
  }

  const visibleGridUnitLeft = (visibleRect.left - offsetX) / GRID_UNIT;
  const visibleGridUnitTop = (visibleRect.top - offsetY) / GRID_UNIT;
  const visibleGridUnitRight = (visibleRect.right - offsetX) / GRID_UNIT;
  const visibleGridUnitBottom = (visibleRect.bottom - offsetY) / GRID_UNIT;
  const visibleNodeIds = layout.nodeTileIndex.query(
    visibleGridUnitLeft,
    visibleGridUnitTop,
    visibleGridUnitRight,
    visibleGridUnitBottom,
    scene.viewport.scale,
  );

  for (const nodeId of visibleNodeIds) {
    const position = layout.nodePositions.get(nodeId)!;

    const pixelX = offsetX + position.x * GRID_UNIT;
    const pixelY = offsetY + position.y * GRID_UNIT;
    const pixelWidth = position.width * GRID_UNIT;
    const pixelHeight = position.height * GRID_UNIT;

    const node = scene.model.nodeMap.get(nodeId)!;
    const isCompound = node.subgraphs.length > 0;
    const isExpanded = scene.expandedNodes.has(nodeId);

    if (hasSelection) {
      if (scene.highlightedNodes.has(nodeId)) {
        scene.context.globalAlpha = 1.0;
      } else {
        scene.context.globalAlpha = DIM_ALPHA;
      }
    }

    const screenPixelWidth = pixelWidth * scene.viewport.scale;
    const shouldDrawCanvasBody =
      (!scene.webglRenderer || screenPixelWidth >= LOD_FULL) &&
      screenPixelWidth >= LOD_DOT;

    if (shouldDrawCanvasBody) {
      if (screenPixelWidth < LOD_SIMPLIFIED) {
        scene.context.fillStyle = node.color;
        scene.context.fillRect(pixelX, pixelY, pixelWidth, pixelHeight);
      } else if (screenPixelWidth < LOD_FULL) {
        roundedRect(scene.context, pixelX, pixelY, pixelWidth, pixelHeight, 3);
        scene.context.fillStyle = node.color;
        scene.context.fill();
        scene.context.strokeStyle = darkenColor(node.color, 0.3);
        scene.context.lineWidth = NODE_STROKE_WIDTH;
        scene.context.stroke();
      } else if (isCompound && isExpanded) {
        renderExpandedNode(scene, node, position, pixelX, pixelY, visibleRect);
      } else {
        renderLeafNode(scene, node, position, pixelX, pixelY, isCompound);
      }
    }

    if (
      isCompound &&
      screenPixelWidth >= LOD_DOT &&
      screenPixelWidth < LOD_FULL
    ) {
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

    registerNodeHitRegion(
      scene,
      node.id,
      pixelX,
      pixelY,
      position,
      isCompound,
      isExpanded,
      screenPixelWidth,
    );
  }
}

function renderEdges(
  scene: GraphScene,
  routing: ScopeRouting,
  hasSelection: boolean,
  visibleRect: VisibleRect,
): void {
  const visibleEdgeIndices = routing.edgeTileIndex
    .query(
      visibleRect.left,
      visibleRect.top,
      visibleRect.right,
      visibleRect.bottom,
      scene.viewport.scale,
    )
    .sort((left, right) => left - right);

  for (const edgeIndex of visibleEdgeIndices) {
    const routedEdge = routing.routedEdges[edgeIndex];
    if (!routedEdge) continue;
    const waypoints = unpackRoutePoints(routing, edgeIndex);

    const edgeIdentifier = routedEdge.key;
    if (hasSelection) {
      if (scene.highlightedEdges.has(edgeIdentifier)) {
        scene.context.globalAlpha = 1.0;
      } else {
        scene.context.globalAlpha = DIM_ALPHA;
      }
    }
    if (!scene.webglRenderer) {
      drawEdge(scene.context, {
        points: waypoints,
        color: edgeColor(routedEdge.colorIndex),
      });
    }

    scene.edgeRegions.push({
      edgeKey: edgeIdentifier,
      edge: routedEdge.edge,
      waypoints,
    });
  }

  if (hasSelection) {
    scene.context.globalAlpha = DIM_ALPHA;
  }
  const visibleCrossingIndices = routing.crossingTileIndex
    .query(
      visibleRect.left,
      visibleRect.top,
      visibleRect.right,
      visibleRect.bottom,
      scene.viewport.scale,
    )
    .sort((left, right) => left - right);
  for (const crossingIndex of visibleCrossingIndices) {
    const crossing = routing.crossings[crossingIndex];
    if (!crossing) continue;
    if (!scene.webglRenderer) {
      drawCrossingCircle(scene.context, {
        x: crossing.x,
        y: crossing.y,
        color: "#ffffff",
      });
    }
  }
  scene.context.globalAlpha = 1.0;
}

function renderLeafNode(
  scene: GraphScene,
  node: Node,
  position: NodePosition,
  pixelX: number,
  pixelY: number,
  isCompound: boolean,
): void {
  drawNode(scene.context, {
    x: pixelX,
    y: pixelY,
    widthGridUnits: position.width,
    heightGridUnits: position.height,
    color: node.color,
    label: node.label,
    nodeId: node.id,
    inputPortCount: node.inputPortCount,
    outputPortCount: node.outputPortCount,
    isCompound,
    isExpanded: false,
    drawBody: !scene.webglRenderer,
    inputPortXOffsetsGridUnits: getPortOffsets(node.inputPortCount),
    outputPortXOffsetsGridUnits: getPortOffsets(node.outputPortCount),
  });
}

function registerNodeHitRegion(
  scene: GraphScene,
  nodeId: number,
  pixelX: number,
  pixelY: number,
  position: NodePosition,
  isCompound: boolean,
  isExpanded: boolean,
  screenPixelWidth: number,
): void {
  const region = {
    nodeId,
    x: pixelX,
    y: pixelY,
    width: position.width * GRID_UNIT,
    height: position.height * GRID_UNIT,
  };

  if (isCompound && isExpanded) {
    scene.expandedNodeRegions.push(region);
  } else {
    scene.leafNodeRegions.push(region);
  }

  if (isCompound) {
    const compact = screenPixelWidth < LOD_FULL;
    const useWholeNodeToggle = compact || !isExpanded;
    scene.toggleRegions.push({
      nodeId,
      x: pixelX,
      y: pixelY,
      width: useWholeNodeToggle ? region.width : 28,
      height: useWholeNodeToggle ? region.height : 18,
    });
  }
}

function renderExpandedNode(
  scene: GraphScene,
  node: Node,
  position: NodePosition,
  pixelX: number,
  pixelY: number,
  visibleRect: VisibleRect,
): void {
  const context = scene.context;
  const width = position.width * GRID_UNIT;
  const height = position.height * GRID_UNIT;

  if (!scene.webglRenderer) {
    roundedRect(
      context,
      pixelX,
      pixelY,
      width,
      height,
      EXPANDED_NODE_CORNER_RADIUS,
    );
    context.fillStyle = node.color;
    context.fill();
    context.strokeStyle = darkenColor(node.color, 0.3);
    context.lineWidth = NODE_STROKE_WIDTH;
    context.stroke();
  }

  const labelBarCenterY = pixelY + (LABEL_BAR_HEIGHT * GRID_UNIT) / 2;
  outlinedText(context, node.label, pixelX + width / 2, labelBarCenterY, {
    font: "bold 11px sans-serif",
    fillStyle: "#ffffff",
    strokeStyle: "#000000",
    strokeWidth: 1.8,
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
    drawPorts(context, {
      x: pixelX,
      y: pixelY,
      containerWidthGridUnits: position.width,
      portCount: node.inputPortCount,
      labelSide: "above",
      color: node.color,
      portXOffsetsGridUnits: getPortOffsets(node.inputPortCount),
    });
  }
  if (node.outputPortCount > 0) {
    drawPorts(context, {
      x: pixelX,
      y: pixelY + height,
      containerWidthGridUnits: position.width,
      portCount: node.outputPortCount,
      labelSide: "below",
      color: node.color,
      portXOffsetsGridUnits: getPortOffsets(node.outputPortCount),
    });
  }

  context.globalAlpha = 1.0;

  renderChildSubgraphs(scene, node, pixelX, pixelY, visibleRect);
}

function renderChildSubgraphs(
  scene: GraphScene,
  node: Node,
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
    const childLayout = scene.layoutMap.get(childScopeId);
    const childScope = scene.model.scopeMap.get(childScopeId);

    if (!childLayout || !childScope) {
      continue;
    }

    const frameWidth = childLayout.gridWidth * GRID_UNIT;
    const frameHeight = childLayout.gridHeight * GRID_UNIT;
    maxFrameHeight = Math.max(maxFrameHeight, frameHeight);

    drawSubgraphFrame(context, {
      x: currentSubgraphX,
      y: subgraphAreaY,
      width: frameWidth,
      height: frameHeight,
      parentColor: node.color,
      label: childScope.label,
      drawBody: !scene.webglRenderer,
    });

    let entryNode: Node | undefined;
    if (childScope.inId !== null) {
      entryNode = scene.model.nodeMap.get(childScope.inId);
    }
    let exitNode: Node | undefined;
    if (childScope.outId !== null) {
      exitNode = scene.model.nodeMap.get(childScope.outId);
    }

    if (entryNode && entryNode.outputPortCount > 0) {
      drawBoundaryPorts(context, {
        x: currentSubgraphX,
        y: subgraphAreaY,
        frameWidthGridUnits: childLayout.gridWidth,
        portCount: entryNode.outputPortCount,
        side: "top",
        parentColor: node.color,
      });
    }
    if (exitNode && exitNode.inputPortCount > 0) {
      drawBoundaryPorts(context, {
        x: currentSubgraphX,
        y: subgraphAreaY + frameHeight,
        frameWidthGridUnits: childLayout.gridWidth,
        portCount: exitNode.inputPortCount,
        side: "bottom",
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
      context.strokeStyle = darkenColor(node.color, 0.1);
      context.lineWidth = 0.5;
      context.stroke();
    }
  }
}
