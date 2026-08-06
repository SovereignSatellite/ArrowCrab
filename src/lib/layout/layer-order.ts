import type { Edge } from "../graph/types";

export function assignLayers(
  nodeIds: number[],
  successors: Map<number, number[]>,
): { layers: number[][]; layerOf: Map<number, number> } {
  const distanceToSink = new Map<number, number>();

  for (let index = nodeIds.length - 1; index >= 0; index -= 1) {
    const nodeId = nodeIds[index];
    let longestSuccessorDistance = -1;
    for (const successorId of successors.get(nodeId) ?? []) {
      const distance = distanceToSink.get(successorId) ?? 0;
      longestSuccessorDistance = Math.max(longestSuccessorDistance, distance);
    }
    distanceToSink.set(nodeId, longestSuccessorDistance + 1);
  }

  let maximumDepth = 0;
  for (const distance of distanceToSink.values()) {
    maximumDepth = Math.max(maximumDepth, distance);
  }

  const layerOf = new Map<number, number>();
  const layers: number[][] = Array.from({ length: maximumDepth + 1 }, () => []);
  for (const nodeId of nodeIds) {
    const layer = maximumDepth - (distanceToSink.get(nodeId) ?? 0);
    layerOf.set(nodeId, layer);
    layers[layer].push(nodeId);
  }
  return { layers, layerOf };
}

export function buildScopeSuccessors(
  edges: readonly Edge[],
): Map<number, number[]> {
  const successors = new Map<number, number[]>();
  for (const edge of edges) {
    const list = successors.get(edge.sourceId);
    if (list) list.push(edge.targetId);
    else successors.set(edge.sourceId, [edge.targetId]);
  }
  return successors;
}

export type WorkingVertex = string;

interface WorkingSegment {
  source: WorkingVertex;
  target: WorkingVertex;
  edgeIndex: number;
  sourcePort: number;
  targetPort: number;
}

export interface WorkingLayerGraph {
  layers: WorkingVertex[][];
  originalKeyById: Map<number, WorkingVertex>;
  originalIdByKey: Map<WorkingVertex, number>;
  incoming: Map<WorkingVertex, WorkingVertex[]>;
  outgoing: Map<WorkingVertex, WorkingVertex[]>;
  incomingPorts: Map<WorkingVertex, number[]>;
  outgoingPorts: Map<WorkingVertex, number[]>;
  segmentsByGap: WorkingSegment[][];
  stableOrder: Map<WorkingVertex, number>;
}

function makeOriginalKey(nodeId: number): WorkingVertex {
  return `n:${nodeId}`;
}

function makeVirtualKey(
  edgeIndex: number,
  segmentIndex: number,
): WorkingVertex {
  return `v:${edgeIndex}:${segmentIndex}`;
}

function addWorkingNeighbor(
  map: Map<WorkingVertex, WorkingVertex[]>,
  key: WorkingVertex,
  neighbor: WorkingVertex,
): void {
  const neighbors = map.get(key);
  if (neighbors) {
    neighbors.push(neighbor);
  } else {
    map.set(key, [neighbor]);
  }
}

function addWorkingNeighborWithPort(
  map: Map<WorkingVertex, WorkingVertex[]>,
  ports: Map<WorkingVertex, number[]>,
  key: WorkingVertex,
  neighbor: WorkingVertex,
  port: number,
): void {
  addWorkingNeighbor(map, key, neighbor);
  const portList = ports.get(key);
  if (portList) portList.push(port);
  else ports.set(key, [port]);
}

export function createWorkingLayerGraph(
  layers: number[][],
  layerOf: Map<number, number>,
  edges: Edge[],
): WorkingLayerGraph {
  const workingLayers = layers.map((layer) => layer.map(makeOriginalKey));
  const originalKeyById = new Map<number, WorkingVertex>();
  const originalIdByKey = new Map<WorkingVertex, number>();
  const stableOrder = new Map<WorkingVertex, number>();
  const incoming = new Map<WorkingVertex, WorkingVertex[]>();
  const outgoing = new Map<WorkingVertex, WorkingVertex[]>();
  const incomingPorts = new Map<WorkingVertex, number[]>();
  const outgoingPorts = new Map<WorkingVertex, number[]>();

  let originalOrder = 0;
  for (const layer of layers) {
    for (const nodeId of layer) {
      const key = makeOriginalKey(nodeId);
      originalKeyById.set(nodeId, key);
      originalIdByKey.set(key, nodeId);
      stableOrder.set(key, originalOrder);
      originalOrder += 1;
    }
  }

  const segmentsByGap: WorkingSegment[][] = Array.from(
    { length: Math.max(0, layers.length - 1) },
    () => [],
  );

  for (const edge of edges) {
    const sourceLayer = layerOf.get(edge.sourceId);
    const targetLayer = layerOf.get(edge.targetId);
    if (
      sourceLayer === undefined ||
      targetLayer === undefined ||
      targetLayer <= sourceLayer
    ) {
      continue;
    }

    const path: WorkingVertex[] = [originalKeyById.get(edge.sourceId)!];
    for (let layer = sourceLayer + 1; layer < targetLayer; layer += 1) {
      const virtualKey = makeVirtualKey(
        edge.edgeIndex,
        layer - sourceLayer - 1,
      );
      workingLayers[layer].push(virtualKey);
      stableOrder.set(virtualKey, originalOrder + edge.edgeIndex);
      path.push(virtualKey);
    }
    path.push(originalKeyById.get(edge.targetId)!);

    for (let index = 0; index < path.length - 1; index += 1) {
      const source = path[index];
      const target = path[index + 1];
      const sourcePort = index === 0 ? edge.sourcePort : -1;
      const targetPort = index === path.length - 2 ? edge.targetPort : -1;
      addWorkingNeighborWithPort(
        outgoing,
        outgoingPorts,
        source,
        target,
        sourcePort,
      );
      addWorkingNeighborWithPort(
        incoming,
        incomingPorts,
        target,
        source,
        targetPort,
      );
      segmentsByGap[sourceLayer + index].push({
        source,
        target,
        edgeIndex: edge.edgeIndex,
        sourcePort,
        targetPort,
      });
    }
  }

  return {
    layers: workingLayers,
    originalKeyById,
    originalIdByKey,
    incoming,
    outgoing,
    incomingPorts,
    outgoingPorts,
    segmentsByGap,
    stableOrder,
  };
}

function compareFractions(
  leftNumerator: number,
  leftDenominator: number,
  rightNumerator: number,
  rightDenominator: number,
): number {
  const left = leftNumerator * rightDenominator;
  const right = rightNumerator * leftDenominator;
  return left - right;
}

function neighborMedian(
  key: WorkingVertex,
  neighbors: Map<WorkingVertex, WorkingVertex[]>,
  positions: Map<WorkingVertex, number>,
  ports?: Map<WorkingVertex, number[]>,
): {
  numerator: number;
  denominator: number;
  portNumerator: number;
  portDenominator: number;
} | null {
  const portList = ports?.get(key) ?? [];
  const values = (neighbors.get(key) ?? [])
    .map((neighbor, index) => {
      const position = positions.get(neighbor);
      return position === undefined
        ? null
        : { position, port: portList[index] ?? -1 };
    })
    .filter(
      (value): value is { position: number; port: number } => value !== null,
    )
    .sort(
      (left, right) => left.position - right.position || left.port - right.port,
    );
  if (values.length === 0) {
    return null;
  }
  const middle = values.length >> 1;
  if (values.length % 2 === 1) {
    return {
      numerator: values[middle].position,
      denominator: 1,
      portNumerator: values[middle].port,
      portDenominator: 1,
    };
  }
  return {
    numerator: values[middle - 1].position + values[middle].position,
    denominator: 2,
    portNumerator: values[middle - 1].port + values[middle].port,
    portDenominator: 2,
  };
}

function compareNeighborMedians(
  left: NonNullable<ReturnType<typeof neighborMedian>>,
  right: NonNullable<ReturnType<typeof neighborMedian>>,
): number {
  return (
    compareFractions(
      left.numerator,
      left.denominator,
      right.numerator,
      right.denominator,
    ) ||
    compareFractions(
      left.portNumerator,
      left.portDenominator,
      right.portNumerator,
      right.portDenominator,
    )
  );
}

class FenwickTree {
  private readonly values: Uint32Array;

  constructor(size: number) {
    this.values = new Uint32Array(size + 1);
  }

  add(index: number): void {
    for (
      let cursor = index + 1;
      cursor < this.values.length;
      cursor += cursor & -cursor
    ) {
      this.values[cursor] += 1;
    }
  }

  prefixCount(index: number): number {
    let result = 0;
    for (let cursor = index + 1; cursor > 0; cursor -= cursor & -cursor) {
      result += this.values[cursor];
    }
    return result;
  }
}

function countGapCrossings(graph: WorkingLayerGraph, gapIndex: number): number {
  const upper = graph.layers[gapIndex];
  const lower = graph.layers[gapIndex + 1];
  const upperPositions = new Map(upper.map((key, index) => [key, index]));
  const lowerPositions = new Map(lower.map((key, index) => [key, index]));
  const segments = graph.segmentsByGap[gapIndex]
    .map((segment) => ({
      sourcePosition: upperPositions.get(segment.source),
      targetPosition: lowerPositions.get(segment.target),
      sourcePort: segment.sourcePort,
      targetPort: segment.targetPort,
      edgeIndex: segment.edgeIndex,
    }))
    .filter(
      (
        segment,
      ): segment is {
        sourcePosition: number;
        targetPosition: number;
        sourcePort: number;
        targetPort: number;
        edgeIndex: number;
      } =>
        segment.sourcePosition !== undefined &&
        segment.targetPosition !== undefined,
    )
    .sort(
      (left, right) =>
        left.sourcePosition - right.sourcePosition ||
        left.sourcePort - right.sourcePort ||
        left.targetPosition - right.targetPosition ||
        left.targetPort - right.targetPort ||
        left.edgeIndex - right.edgeIndex,
    );

  const tree = new FenwickTree(lower.length);
  let crossings = 0;
  let processed = 0;
  let cursor = 0;
  while (cursor < segments.length) {
    const sourcePosition = segments[cursor].sourcePosition;
    let end = cursor;
    while (
      end < segments.length &&
      segments[end].sourcePosition === sourcePosition
    ) {
      end += 1;
    }
    for (let index = cursor; index < end; index += 1) {
      const targetPosition = segments[index].targetPosition;
      crossings += processed - tree.prefixCount(targetPosition);
    }
    for (let index = cursor; index < end; index += 1) {
      tree.add(segments[index].targetPosition);
      processed += 1;
    }
    cursor = end;
  }
  return crossings;
}

function localCrossingScore(
  graph: WorkingLayerGraph,
  layerIndex: number,
): number {
  let score = 0;
  if (layerIndex > 0) {
    score += countGapCrossings(graph, layerIndex - 1);
  }
  if (layerIndex < graph.layers.length - 1) {
    score += countGapCrossings(graph, layerIndex);
  }
  return score;
}

function improveAdjacentSwitches(graph: WorkingLayerGraph): void {
  for (let layerIndex = 0; layerIndex < graph.layers.length; layerIndex += 1) {
    const layer = graph.layers[layerIndex];
    for (let index = 0; index < layer.length - 1; index += 1) {
      const before = localCrossingScore(graph, layerIndex);
      [layer[index], layer[index + 1]] = [layer[index + 1], layer[index]];
      const after = localCrossingScore(graph, layerIndex);
      if (after > before) {
        [layer[index], layer[index + 1]] = [layer[index + 1], layer[index]];
      }
    }
  }
}

export function orderLayers(
  layers: number[][],
  layerOf: Map<number, number>,
  edges: Edge[],
): WorkingLayerGraph {
  const graph = createWorkingLayerGraph(layers, layerOf, edges);

  for (let sweep = 0; sweep < 8; sweep += 1) {
    for (
      let layerIndex = 1;
      layerIndex < graph.layers.length;
      layerIndex += 1
    ) {
      const positions = new Map(
        graph.layers[layerIndex - 1].map((key, index) => [key, index]),
      );
      graph.layers[layerIndex].sort((left, right) => {
        const leftMedian = neighborMedian(
          left,
          graph.incoming,
          positions,
          graph.incomingPorts,
        );
        const rightMedian = neighborMedian(
          right,
          graph.incoming,
          positions,
          graph.incomingPorts,
        );
        if (!leftMedian && !rightMedian) {
          return (
            (graph.stableOrder.get(left) ?? 0) -
            (graph.stableOrder.get(right) ?? 0)
          );
        }
        if (!leftMedian) return 1;
        if (!rightMedian) return -1;
        return (
          compareNeighborMedians(leftMedian, rightMedian) ||
          (graph.stableOrder.get(left) ?? 0) -
            (graph.stableOrder.get(right) ?? 0)
        );
      });
    }

    for (
      let layerIndex = graph.layers.length - 2;
      layerIndex >= 0;
      layerIndex -= 1
    ) {
      const positions = new Map(
        graph.layers[layerIndex + 1].map((key, index) => [key, index]),
      );
      graph.layers[layerIndex].sort((left, right) => {
        const leftMedian = neighborMedian(
          left,
          graph.outgoing,
          positions,
          graph.outgoingPorts,
        );
        const rightMedian = neighborMedian(
          right,
          graph.outgoing,
          positions,
          graph.outgoingPorts,
        );
        if (!leftMedian && !rightMedian) {
          return (
            (graph.stableOrder.get(left) ?? 0) -
            (graph.stableOrder.get(right) ?? 0)
          );
        }
        if (!leftMedian) return 1;
        if (!rightMedian) return -1;
        return (
          compareNeighborMedians(leftMedian, rightMedian) ||
          (graph.stableOrder.get(left) ?? 0) -
            (graph.stableOrder.get(right) ?? 0)
        );
      });
    }
  }

  improveAdjacentSwitches(graph);

  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    layers[layerIndex].length = 0;
    for (const key of graph.layers[layerIndex]) {
      const nodeId = graph.originalIdByKey.get(key);
      if (nodeId !== undefined) {
        layers[layerIndex].push(nodeId);
      }
    }
  }
  return graph;
}
