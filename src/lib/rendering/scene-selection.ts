import type { Edge, GraphModel } from "../graph/types";
import { edgeKey } from "../routing/occupancy";
import { computeAllRouting } from "../routing/scope";
import { toggleNodeExpansion } from "../layout/scope";
import type { Point } from "../geometry/types";
import type { GraphScene, GlobalAdjacency } from "./scene-types";
import { render } from "./canvas-scene";

const EDGE_HIT_TOLERANCE = 8;

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
  for (
    let segmentIndex = 0;
    segmentIndex < segments.length - 1;
    segmentIndex += 1
  ) {
    const segmentStartX = segments[segmentIndex].x;
    const segmentStartY = segments[segmentIndex].y;
    const segmentEndX = segments[segmentIndex + 1].x;
    const segmentEndY = segments[segmentIndex + 1].y;
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
