import type { GraphModel, Node, Edge } from "./graph-types";
import { TOP_LEVEL_SCOPE_ID } from "./graph-model";
import { edgeKey } from "./grid-types";
import {
  type ScopeLayout,
  type NodePosition,
  type ScopeRouting,
  subgraphScopeId,
  computeAllLayouts,
  computeAllRouting,
  toggleNodeExpansion,
} from "./grid-layout";
import {
  GRID_UNIT,
  LABEL_BAR_HEIGHT,
  NODE_INNER_GAP,
  gridAlignedPortOffset,
} from "./canvas-constants";
import { roundedRect, outlinedText, resetTextState } from "./canvas-primitives";
import { darkenColor, edgeColor } from "./color-utils";
import { drawNode, drawPorts } from "./draw-node";
import { drawSubgraphFrame, drawBoundaryPorts } from "./draw-subgraph";
import { drawEdge, drawCrossingCircle, type Point } from "./draw-edge";

interface HitRegion {
  nodeId: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface EdgeHitRegion {
  edgeKey: string;
  edge: Edge;
  waypoints: readonly Point[];
}

const DIM_ALPHA = 0.15;
const EDGE_HIT_TOLERANCE = 8;
const EXPANDED_NODE_CORNER_RADIUS = 3;

/** Cached port offset arrays keyed by port count, to avoid per-frame allocation. */
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

interface GlobalAdjacency {
  successors: Map<number, number[]>;
  predecessors: Map<number, number[]>;
  allEdges: Edge[];
}

export interface GraphScene {
  context: CanvasRenderingContext2D;
  model: GraphModel;
  layoutMap: Map<string, ScopeLayout>;
  routingMap: Map<string, ScopeRouting>;
  expandedNodes: Set<number>;
  viewport: { offsetX: number; offsetY: number; scale: number };
  toggleRegions: HitRegion[];
  leafNodeRegions: HitRegion[];
  expandedNodeRegions: HitRegion[];
  edgeRegions: EdgeHitRegion[];
  selectedNodes: Set<number>;
  selectedEdges: Set<string>;
  highlightedNodes: Set<number>;
  highlightedEdges: Set<string>;
  /** Cached global adjacency - invalidated on expansion changes. */
  cachedAdjacency: GlobalAdjacency | null;
}

export function createScene(
  context: CanvasRenderingContext2D,
  model: GraphModel,
): GraphScene {
  const expandedNodes = new Set<number>();
  const layoutMap = computeAllLayouts(model, expandedNodes);
  const routingMap = computeAllRouting(model, layoutMap, expandedNodes);
  return {
    context,
    model,
    layoutMap,
    routingMap,
    expandedNodes,
    viewport: { offsetX: 0, offsetY: 0, scale: 1 },
    toggleRegions: [],
    leafNodeRegions: [],
    expandedNodeRegions: [],
    edgeRegions: [],
    selectedNodes: new Set(),
    selectedEdges: new Set(),
    highlightedNodes: new Set(),
    highlightedEdges: new Set(),
    cachedAdjacency: null,
  };
}

export function centerViewport(scene: GraphScene): void {
  const topLayout = scene.layoutMap.get(TOP_LEVEL_SCOPE_ID)!;
  const graphPixelWidth = topLayout.gridWidth * GRID_UNIT;
  const graphPixelHeight = topLayout.gridHeight * GRID_UNIT;
  const canvas = scene.context.canvas;

  const padding = 60;
  const availableWidth = canvas.width - 2 * padding;
  const availableHeight = canvas.height - 2 * padding;

  const scale = Math.min(
    1.5,
    Math.max(
      0.3,
      Math.min(
        availableWidth / graphPixelWidth,
        availableHeight / graphPixelHeight,
      ),
    ),
  );

  scene.viewport.scale = scale;
  scene.viewport.offsetX = (canvas.width - graphPixelWidth * scale) / 2;
  scene.viewport.offsetY = (canvas.height - graphPixelHeight * scale) / 2;
}

/** Visible rectangle in graph pixel coordinates. */
interface VisibleRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** LOD pixel-width thresholds. */
const LOD_FULL = 40;
const LOD_SIMPLIFIED = 8;
const LOD_DOT = 2;

export function render(scene: GraphScene): void {
  const { context, viewport } = scene;
  const canvas = context.canvas;

  context.clearRect(0, 0, canvas.width, canvas.height);
  resetTextState();

  context.save();
  context.translate(viewport.offsetX, viewport.offsetY);
  context.scale(viewport.scale, viewport.scale);

  // Compute visible rect in graph-pixel coordinates for viewport culling.
  const visibleRect: VisibleRect = {
    left: -viewport.offsetX / viewport.scale,
    top: -viewport.offsetY / viewport.scale,
    right: (-viewport.offsetX + canvas.width) / viewport.scale,
    bottom: (-viewport.offsetY + canvas.height) / viewport.scale,
  };

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

  // Use spatial index to find only the nodes whose bounding box overlaps
  // the visible rectangle, converted from pixel coords to grid-unit coords.
  const visGULeft = (visibleRect.left - offsetX) / GRID_UNIT;
  const visGUTop = (visibleRect.top - offsetY) / GRID_UNIT;
  const visGURight = (visibleRect.right - offsetX) / GRID_UNIT;
  const visGUBottom = (visibleRect.bottom - offsetY) / GRID_UNIT;
  const visibleNodeIds = layout.nodeSpatialIndex.query(
    visGULeft,
    visGUTop,
    visGURight,
    visGUBottom,
  );

  for (const nodeId of visibleNodeIds) {
    const position = layout.nodePositions.get(nodeId)!;

    const pixelX = offsetX + position.x * GRID_UNIT;
    const pixelY = offsetY + position.y * GRID_UNIT;
    const pixelW = position.width * GRID_UNIT;
    const pixelH = position.height * GRID_UNIT;

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

    // LOD: determine detail level based on screen-pixel width.
    const screenPixelW = pixelW * scene.viewport.scale;

    if (screenPixelW < LOD_DOT) {
      // Too small to see - skip entirely.
    } else if (screenPixelW < LOD_SIMPLIFIED) {
      // Dot: single small filled rect.
      scene.context.fillStyle = node.color;
      scene.context.fillRect(pixelX, pixelY, pixelW, pixelH);
    } else if (screenPixelW < LOD_FULL) {
      // Simplified: filled rounded rect, no text or ports.
      roundedRect(scene.context, pixelX, pixelY, pixelW, pixelH, 3);
      scene.context.fillStyle = node.color;
      scene.context.fill();
      scene.context.strokeStyle = darkenColor(node.color, 0.3);
      scene.context.lineWidth = 1.5;
      scene.context.stroke();
    } else if (isCompound && isExpanded) {
      renderExpandedNode(scene, node, position, pixelX, pixelY, visibleRect);
    } else {
      renderLeafNode(scene, node, position, pixelX, pixelY, isCompound);
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
    );
  }
}

function edgeBoundsVisible(
  waypoints: readonly Point[],
  visibleRect: VisibleRect,
): boolean {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of waypoints) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return (
    maxX >= visibleRect.left &&
    minX <= visibleRect.right &&
    maxY >= visibleRect.top &&
    minY <= visibleRect.bottom
  );
}

function renderEdges(
  scene: GraphScene,
  routing: ScopeRouting,
  hasSelection: boolean,
  visibleRect: VisibleRect,
): void {
  for (const routedEdge of routing.routedEdges) {
    // Viewport culling for edges.
    if (!edgeBoundsVisible(routedEdge.waypoints, visibleRect)) {
      continue;
    }

    const edgeIdentifier = routedEdge.key;
    if (hasSelection) {
      if (scene.highlightedEdges.has(edgeIdentifier)) {
        scene.context.globalAlpha = 1.0;
      } else {
        scene.context.globalAlpha = DIM_ALPHA;
      }
    }
    drawEdge(scene.context, {
      points: routedEdge.waypoints,
      color: edgeColor(routedEdge.colorIndex),
    });

    scene.edgeRegions.push({
      edgeKey: edgeIdentifier,
      edge: routedEdge.edge,
      waypoints: routedEdge.waypoints,
    });
  }

  if (hasSelection) {
    scene.context.globalAlpha = DIM_ALPHA;
  }
  for (const crossing of routing.crossings) {
    // Cull crossing circles outside viewport.
    if (
      crossing.x < visibleRect.left ||
      crossing.x > visibleRect.right ||
      crossing.y < visibleRect.top ||
      crossing.y > visibleRect.bottom
    ) {
      continue;
    }
    drawCrossingCircle(scene.context, {
      x: crossing.x,
      y: crossing.y,
      color: "#ffffff",
    });
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
    widthGU: position.width,
    heightGU: position.height,
    color: node.color,
    label: node.label,
    nodeId: node.id,
    portCountIn: node.portCountIn,
    portCountOut: node.portCountOut,
    isCompound,
    isExpanded: false,
    portInXOffsetsGU: getPortOffsets(node.portCountIn),
    portOutXOffsetsGU: getPortOffsets(node.portCountOut),
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
): void {
  const region = {
    nodeId,
    x: pixelX,
    y: pixelY,
    width: position.width * GRID_UNIT,
    height: position.height * GRID_UNIT,
  };

  // Expanded nodes use a separate list so edges inside them remain clickable.
  if (isCompound && isExpanded) {
    scene.expandedNodeRegions.push(region);
  } else {
    scene.leafNodeRegions.push(region);
  }

  if (isCompound) {
    scene.toggleRegions.push({
      nodeId,
      x: pixelX,
      y: pixelY,
      width: 28,
      height: 18,
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
  context.lineWidth = 1.5;
  context.stroke();

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

  if (node.portCountIn > 0) {
    drawPorts(context, {
      x: pixelX,
      y: pixelY,
      containerWidthGU: position.width,
      portCount: node.portCountIn,
      labelSide: "above",
      color: node.color,
      portXOffsetsGU: getPortOffsets(node.portCountIn),
    });
  }
  if (node.portCountOut > 0) {
    drawPorts(context, {
      x: pixelX,
      y: pixelY + height,
      containerWidthGU: position.width,
      portCount: node.portCountOut,
      labelSide: "below",
      color: node.color,
      portXOffsetsGU: getPortOffsets(node.portCountOut),
    });
  }

  // Child scopes handle their own dimming independently.
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

  for (let i = 0; i < node.subgraphs.length; i += 1) {
    const subgraph = node.subgraphs[i];
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
    });

    let entryNode: Node | undefined;
    if (childScope.inId !== null) {
      entryNode = scene.model.nodeMap.get(childScope.inId);
    }
    let exitNode: Node | undefined;
    if (childScope.outId !== null) {
      exitNode = scene.model.nodeMap.get(childScope.outId);
    }

    if (entryNode && entryNode.portCountOut > 0) {
      drawBoundaryPorts(context, {
        x: currentSubgraphX,
        y: subgraphAreaY,
        frameWidthGU: childLayout.gridWidth,
        portCount: entryNode.portCountOut,
        side: "top",
        parentColor: node.color,
      });
    }
    if (exitNode && exitNode.portCountIn > 0) {
      drawBoundaryPorts(context, {
        x: currentSubgraphX,
        y: subgraphAreaY + frameHeight,
        frameWidthGU: childLayout.gridWidth,
        portCount: exitNode.portCountIn,
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

    if (i < node.subgraphs.length - 1) {
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

function buildGlobalAdjacency(model: GraphModel): {
  successors: Map<number, number[]>;
  predecessors: Map<number, number[]>;
  allEdges: Edge[];
} {
  const successors = new Map<number, number[]>();
  const predecessors = new Map<number, number[]>();
  const allEdges: Edge[] = [];

  for (const scope of model.scopeMap.values()) {
    for (const edge of scope.edges) {
      allEdges.push(edge);

      let successorList = successors.get(edge.sourceId);
      if (!successorList) {
        successorList = [];
        successors.set(edge.sourceId, successorList);
      }
      successorList.push(edge.targetId);

      let predecessorList = predecessors.get(edge.targetId);
      if (!predecessorList) {
        predecessorList = [];
        predecessors.set(edge.targetId, predecessorList);
      }
      predecessorList.push(edge.sourceId);
    }
  }

  return { successors, predecessors, allEdges };
}

/** BFS from seed nodes through an adjacency map, collecting all reachable nodes. */
function bfsCollect(
  seeds: Set<number>,
  adjacency: Map<number, number[]>,
  visited: Set<number>,
): void {
  const queue: number[] = [...seeds];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    for (const neighbor of adjacency.get(current) ?? []) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
}

function getGlobalAdjacency(scene: GraphScene): GlobalAdjacency {
  if (!scene.cachedAdjacency) {
    scene.cachedAdjacency = buildGlobalAdjacency(scene.model);
  }
  return scene.cachedAdjacency;
}

function computeCausalCone(
  scene: GraphScene,
  seedNodes: Set<number>,
): { nodes: Set<number>; edges: Set<string> } {
  const { successors, predecessors, allEdges } = getGlobalAdjacency(scene);

  const reachable = new Set<number>(seedNodes);
  bfsCollect(seedNodes, successors, reachable);
  bfsCollect(seedNodes, predecessors, reachable);

  const coneEdges = new Set<string>();
  for (const edge of allEdges) {
    if (reachable.has(edge.sourceId) && reachable.has(edge.targetId)) {
      coneEdges.add(edgeKey(edge));
    }
  }

  return { nodes: reachable, edges: coneEdges };
}

function updateHighlights(scene: GraphScene): void {
  const hasSelectedNodes = scene.selectedNodes.size > 0;
  const hasSelectedEdges = scene.selectedEdges.size > 0;

  if (!hasSelectedNodes && !hasSelectedEdges) {
    scene.highlightedNodes = new Set();
    scene.highlightedEdges = new Set();
    return;
  }

  let nodes: Set<number>;
  let edges: Set<string>;
  if (hasSelectedNodes) {
    const cone = computeCausalCone(scene, scene.selectedNodes);
    nodes = cone.nodes;
    edges = cone.edges;
  } else {
    nodes = new Set();
    edges = new Set();
  }

  // Merge in explicitly selected edges and their endpoints.
  for (const selectedEdgeKey of scene.selectedEdges) {
    edges.add(selectedEdgeKey);
    const parts = selectedEdgeKey.split(":");
    nodes.add(Number(parts[0]));
    nodes.add(Number(parts[2]));
  }

  scene.highlightedNodes = nodes;
  scene.highlightedEdges = edges;
}

function isPointNearPolyline(
  pointX: number,
  pointY: number,
  segments: readonly Point[],
  threshold: number,
): boolean {
  const thresholdSquared = threshold * threshold;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segmentStartX = segments[i].x;
    const segmentStartY = segments[i].y;
    const segmentEndX = segments[i + 1].x;
    const segmentEndY = segments[i + 1].y;
    const deltaX = segmentEndX - segmentStartX;
    const deltaY = segmentEndY - segmentStartY;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;

    // Project point onto segment, clamped to [0, 1].
    let parameter = 0;
    if (lengthSquared > 0) {
      parameter =
        ((pointX - segmentStartX) * deltaX +
          (pointY - segmentStartY) * deltaY) /
        lengthSquared;
      parameter = Math.max(0, Math.min(1, parameter));
    }

    const closestX = segmentStartX + parameter * deltaX;
    const closestY = segmentStartY + parameter * deltaY;
    const distanceSquared =
      (pointX - closestX) * (pointX - closestX) +
      (pointY - closestY) * (pointY - closestY);
    if (distanceSquared <= thresholdSquared) {
      return true;
    }
  }
  return false;
}

function isPointInRect(
  pointX: number,
  pointY: number,
  region: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    pointX >= region.x &&
    pointX <= region.x + region.width &&
    pointY >= region.y &&
    pointY <= region.y + region.height
  );
}

/**
 * Handle a canvas click. Priority order:
 * toggle buttons > leaf nodes > edges > expanded nodes > empty space.
 */
export function handleCanvasClick(
  scene: GraphScene,
  canvasX: number,
  canvasY: number,
  ctrlKey: boolean = false,
): boolean {
  const graphX = (canvasX - scene.viewport.offsetX) / scene.viewport.scale;
  const graphY = (canvasY - scene.viewport.offsetY) / scene.viewport.scale;

  for (const region of scene.toggleRegions) {
    if (isPointInRect(graphX, graphY, region)) {
      toggleNodeExpansion(
        region.nodeId,
        scene.model,
        scene.expandedNodes,
        scene.layoutMap,
      );
      scene.routingMap = computeAllRouting(
        scene.model,
        scene.layoutMap,
        scene.expandedNodes,
      );
      scene.cachedAdjacency = null; // Invalidate on expansion change.
      render(scene);
      return true;
    }
  }

  for (const region of scene.leafNodeRegions) {
    if (isPointInRect(graphX, graphY, region)) {
      applyNodeSelection(scene, region.nodeId, ctrlKey);
      return true;
    }
  }

  const edgeHitDistance = EDGE_HIT_TOLERANCE / scene.viewport.scale;
  for (const region of scene.edgeRegions) {
    if (
      isPointNearPolyline(graphX, graphY, region.waypoints, edgeHitDistance)
    ) {
      applyEdgeSelection(scene, region.edgeKey, ctrlKey);
      return true;
    }
  }

  for (const region of scene.expandedNodeRegions) {
    if (isPointInRect(graphX, graphY, region)) {
      applyNodeSelection(scene, region.nodeId, ctrlKey);
      return true;
    }
  }

  if (scene.selectedNodes.size > 0 || scene.selectedEdges.size > 0) {
    scene.selectedNodes.clear();
    scene.selectedEdges.clear();
    scene.highlightedNodes = new Set();
    scene.highlightedEdges = new Set();
    render(scene);
    return true;
  }

  return false;
}

function applyNodeSelection(
  scene: GraphScene,
  nodeId: number,
  ctrlKey: boolean,
): void {
  if (scene.selectedNodes.has(nodeId)) {
    scene.selectedNodes.delete(nodeId);
  } else if (ctrlKey) {
    scene.selectedNodes.add(nodeId);
  } else {
    scene.selectedNodes.clear();
    scene.selectedEdges.clear();
    scene.selectedNodes.add(nodeId);
  }

  updateHighlights(scene);
  render(scene);
}

function applyEdgeSelection(
  scene: GraphScene,
  selectedEdgeKey: string,
  ctrlKey: boolean,
): void {
  if (scene.selectedEdges.has(selectedEdgeKey)) {
    scene.selectedEdges.delete(selectedEdgeKey);
  } else if (ctrlKey) {
    scene.selectedEdges.add(selectedEdgeKey);
  } else {
    scene.selectedNodes.clear();
    scene.selectedEdges.clear();
    scene.selectedEdges.add(selectedEdgeKey);
  }

  updateHighlights(scene);
  render(scene);
}
