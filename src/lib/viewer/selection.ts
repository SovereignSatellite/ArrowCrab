import type { RoutePoints } from "../diagram/routing.ts";
import type { Edge, GraphModel } from "../engine/graph/types.ts";
import { computeAllRouting } from "../engine/routing/scope.ts";
import { toggleNodeExpansion } from "../engine/layout/scope.ts";
import type { ViewerState, GlobalAdjacency } from "./types.ts";
import { renderViewer } from "./runtime.ts";
import { createDiagram } from "../engine/diagram.ts";
import { LOD_FULL } from "../drawing/styles.ts";

const EDGE_HIT_TOLERANCE = 8;

function buildGlobalAdjacency(model: GraphModel): GlobalAdjacency {
  const successors = new Map<number, number[]>();
  const predecessors = new Map<number, number[]>();

  for (const scope of model.scopeMap.values()) {
    for (const edge of scope.edges) {
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

  return { successors, predecessors };
}

function collectReachable(
  seeds: Set<number>,
  adjacency: Map<number, number[]>,
): Set<number> {
  const visited = new Set(seeds);
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
  return visited;
}

function getGlobalAdjacency(scene: ViewerState): GlobalAdjacency {
  if (!scene.cachedAdjacency) {
    scene.cachedAdjacency = buildGlobalAdjacency(scene.model);
  }
  return scene.cachedAdjacency;
}

function computeCausalCone(
  scene: ViewerState,
  seedNodes: Set<number>,
): { nodes: Set<number>; edges: Set<number> } {
  const { successors, predecessors } = getGlobalAdjacency(scene);
  const reachable = collectReachable(seedNodes, successors);
  for (const nodeId of collectReachable(seedNodes, predecessors)) {
    reachable.add(nodeId);
  }

  const coneEdges = new Set<number>();
  for (const scope of scene.model.scopeMap.values()) {
    for (const edge of scope.edges) {
      if (reachable.has(edge.sourceId) && reachable.has(edge.targetId)) {
        coneEdges.add(edge.edgeIndex);
      }
    }
  }

  return { nodes: reachable, edges: coneEdges };
}

function updateHighlights(scene: ViewerState): void {
  const hasSelectedNodes = scene.selectedNodes.size > 0;
  let nodes: Set<number>;
  let edges: Set<number>;
  if (hasSelectedNodes) {
    const cone = computeCausalCone(scene, scene.selectedNodes);
    nodes = cone.nodes;
    edges = cone.edges;
  } else {
    nodes = new Set();
    edges = new Set();
  }

  for (const edge of scene.selectedEdges.values()) {
    edges.add(edge.edgeIndex);
    nodes.add(edge.sourceId);
    nodes.add(edge.targetId);
  }

  scene.highlightedNodes = nodes;
  scene.highlightedEdges = edges;
}

function isPointNearPolyline(
  pointX: number,
  pointY: number,
  points: RoutePoints,
  threshold: number,
): boolean {
  const thresholdSquared = threshold * threshold;
  for (let offset = 0; offset < points.length - 2; offset += 2) {
    const segmentStartX = points[offset];
    const segmentStartY = points[offset + 1];
    const segmentEndX = points[offset + 2];
    const segmentEndY = points[offset + 3];
    const deltaX = segmentEndX - segmentStartX;
    const deltaY = segmentEndY - segmentStartY;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;

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

export function handleCanvasClick(
  scene: ViewerState,
  canvasX: number,
  canvasY: number,
  ctrlKey: boolean,
): void {
  const graphX = (canvasX - scene.viewport.offsetX) / scene.viewport.scale;
  const graphY = (canvasY - scene.viewport.offsetY) / scene.viewport.scale;
  for (const region of scene.regions.nodes) {
    const node = scene.model.nodeMap.get(region.nodeId)!;
    if (node.subgraphs.length === 0) continue;
    const useWholeNode =
      !scene.expandedNodes.has(node.id) ||
      region.width * scene.viewport.scale < LOD_FULL;
    const toggle = {
      x: region.x,
      y: region.y,
      width: useWholeNode ? region.width : 28,
      height: useWholeNode ? region.height : 18,
    };
    if (!isPointInRect(graphX, graphY, toggle)) continue;
    toggleNodeExpansion(
      node.id,
      scene.model,
      scene.expandedNodes,
      scene.layoutMap,
    );
    const routing = computeAllRouting(
      scene.model,
      scene.layoutMap,
      scene.expandedNodes,
    );
    scene.diagram = createDiagram(scene.model, scene.layoutMap, routing);
    renderViewer(scene);
    return;
  }
  for (const region of scene.regions.nodes) {
    if (
      !scene.expandedNodes.has(region.nodeId) &&
      isPointInRect(graphX, graphY, region)
    ) {
      applyNodeSelection(scene, region.nodeId, ctrlKey);
      return;
    }
  }
  const edgeHitDistance = EDGE_HIT_TOLERANCE / scene.viewport.scale;
  for (const region of scene.regions.edges) {
    if (isPointNearPolyline(graphX, graphY, region.points, edgeHitDistance)) {
      applyEdgeSelection(scene, region.edge, ctrlKey);
      return;
    }
  }
  for (const region of scene.regions.nodes) {
    if (
      scene.expandedNodes.has(region.nodeId) &&
      isPointInRect(graphX, graphY, region)
    ) {
      applyNodeSelection(scene, region.nodeId, ctrlKey);
      return;
    }
  }
  if (scene.highlightedNodes.size > 0) {
    scene.selectedNodes.clear();
    scene.selectedEdges.clear();
    scene.highlightedNodes = new Set();
    scene.highlightedEdges = new Set();
    renderViewer(scene);
  }
}

function applyNodeSelection(
  scene: ViewerState,
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
  renderViewer(scene);
}

function applyEdgeSelection(
  scene: ViewerState,
  edge: Edge,
  ctrlKey: boolean,
): void {
  if (scene.selectedEdges.has(edge.edgeIndex)) {
    scene.selectedEdges.delete(edge.edgeIndex);
  } else if (ctrlKey) {
    scene.selectedEdges.set(edge.edgeIndex, edge);
  } else {
    scene.selectedNodes.clear();
    scene.selectedEdges.clear();
    scene.selectedEdges.set(edge.edgeIndex, edge);
  }

  updateHighlights(scene);
  renderViewer(scene);
}
