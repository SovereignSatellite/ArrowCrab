import type { Edge } from "../graph/types.ts";

export function assignLayers(
  nodeIds: number[],
  successors: Map<number, number[]>,
): { layers: number[][]; layerOf: Map<number, number> } {
  const distanceToSink = new Map<number, number>();
  let maximumDepth = -1;

  for (let index = nodeIds.length - 1; index >= 0; index -= 1) {
    const nodeId = nodeIds[index];
    let longestSuccessorDistance = -1;
    for (const successorId of successors.get(nodeId) ?? []) {
      const distance = distanceToSink.get(successorId);
      if (distance !== undefined) {
        longestSuccessorDistance = Math.max(longestSuccessorDistance, distance);
      }
    }
    const distance = longestSuccessorDistance + 1;
    distanceToSink.set(nodeId, distance);
    maximumDepth = Math.max(maximumDepth, distance);
  }

  const layerOf = new Map<number, number>();
  const layers: number[][] = Array.from({ length: maximumDepth + 1 }, () => []);
  for (const nodeId of nodeIds) {
    const layer = maximumDepth - distanceToSink.get(nodeId)!;
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

export type WorkingVertex = number | { readonly edgeIndex: number };

interface WorkingSegment {
  source: WorkingVertex;
  target: WorkingVertex;
  sourcePort: number;
  targetPort: number;
}

export interface WorkingLayerGraph {
  layers: WorkingVertex[][];
  segmentsByGap: WorkingSegment[][];
}

function compareStableVertexOrder(
  left: WorkingVertex,
  right: WorkingVertex,
): number {
  if (typeof left === "number")
    return typeof right === "number" ? left - right : -1;
  return typeof right === "number" ? 1 : left.edgeIndex - right.edgeIndex;
}

function createWorkingLayerGraph(
  layers: number[][],
  layerOf: Map<number, number>,
  edges: Edge[],
): WorkingLayerGraph {
  const workingLayers = layers.map((layer) => [...layer] as WorkingVertex[]);
  const segmentsByGap: WorkingSegment[][] = Array.from(
    { length: Math.max(0, layers.length - 1) },
    () => [],
  );

  for (const edge of edges) {
    const sourceLayer = layerOf.get(edge.sourceId);
    const targetLayer = layerOf.get(edge.targetId);
    if (sourceLayer === undefined || targetLayer === undefined) {
      continue;
    }

    let source: WorkingVertex = edge.sourceId;
    let sourcePort = edge.sourcePort;
    for (let layer = sourceLayer + 1; layer < targetLayer; layer += 1) {
      const target = { edgeIndex: edge.edgeIndex };
      workingLayers[layer].push(target);
      segmentsByGap[layer - 1].push({
        source,
        target,
        sourcePort,
        targetPort: -1,
      });
      source = target;
      sourcePort = -1;
    }
    segmentsByGap[targetLayer - 1].push({
      source,
      target: edge.targetId,
      sourcePort,
      targetPort: edge.targetPort,
    });
  }

  return {
    layers: workingLayers,
    segmentsByGap,
  };
}

interface EndpointRank {
  position: number;
  port: number;
}

type FixedEndpoint = "source" | "target";

function compareEndpointRanks(left: EndpointRank, right: EndpointRank): number {
  return left.position - right.position || left.port - right.port;
}

function appendEndpointRank(
  ranksByVertex: Map<WorkingVertex, EndpointRank[]>,
  vertex: WorkingVertex,
  position: number,
  port: number,
): void {
  const ranks = ranksByVertex.get(vertex);
  const rank = { position, port };
  if (ranks) ranks.push(rank);
  else ranksByVertex.set(vertex, [rank]);
}

function endpointRanksByVertex(
  segments: readonly WorkingSegment[],
  fixedPositions: ReadonlyMap<WorkingVertex, number>,
  fixedEndpoint: FixedEndpoint,
): Map<WorkingVertex, EndpointRank[]> {
  const ranksByVertex = new Map<WorkingVertex, EndpointRank[]>();
  for (const segment of segments) {
    switch (fixedEndpoint) {
      case "source":
        appendEndpointRank(
          ranksByVertex,
          segment.target,
          fixedPositions.get(segment.source)!,
          segment.sourcePort,
        );
        break;
      case "target":
        appendEndpointRank(
          ranksByVertex,
          segment.source,
          fixedPositions.get(segment.target)!,
          segment.targetPort,
        );
        break;
    }
  }
  for (const ranks of ranksByVertex.values()) {
    ranks.sort(compareEndpointRanks);
  }
  return ranksByVertex;
}

function medianEndpointRank(
  ranks: readonly EndpointRank[] | undefined,
): EndpointRank | null {
  if (!ranks) return null;
  const middleIndex = Math.floor(ranks.length / 2);
  const precedingIndex = ranks.length % 2 === 0 ? middleIndex - 1 : middleIndex;
  const preceding = ranks[precedingIndex];
  const following = ranks[middleIndex];
  return {
    position: (preceding.position + following.position) / 2,
    port: (preceding.port + following.port) / 2,
  };
}

function compareNeighborMedians(
  left: EndpointRank | null,
  right: EndpointRank | null,
): number {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  return compareEndpointRanks(left, right);
}

function sortLayerByNeighborMedian(
  graph: WorkingLayerGraph,
  layerIndex: number,
  gapIndex: number,
  fixedEndpoint: FixedEndpoint,
): void {
  const fixedLayerIndex = fixedEndpoint === "source" ? gapIndex : gapIndex + 1;
  const fixedPositions = new Map(
    graph.layers[fixedLayerIndex].map((key, index) => [key, index]),
  );
  const ranksByVertex = endpointRanksByVertex(
    graph.segmentsByGap[gapIndex],
    fixedPositions,
    fixedEndpoint,
  );
  const layer = graph.layers[layerIndex];
  const vertices = layer.map((vertex) => ({
    vertex,
    median: medianEndpointRank(ranksByVertex.get(vertex)),
  }));
  vertices.sort(
    (left, right) =>
      compareNeighborMedians(left.median, right.median) ||
      compareStableVertexOrder(left.vertex, right.vertex),
  );
  for (let index = 0; index < layer.length; index += 1) {
    layer[index] = vertices[index].vertex;
  }
}

function adjacentSwapCrossingDelta(
  leftRanks: readonly EndpointRank[],
  rightRanks: readonly EndpointRank[],
): number {
  let leftIndex = 0;
  let rightRanksLessThan = 0;
  let rightRanksLessThanOrEqual = 0;
  let delta = 0;
  while (leftIndex < leftRanks.length) {
    const rank = leftRanks[leftIndex];
    let leftEnd = leftIndex + 1;
    while (
      leftEnd < leftRanks.length &&
      compareEndpointRanks(leftRanks[leftEnd], rank) === 0
    ) {
      leftEnd += 1;
    }
    while (
      rightRanksLessThan < rightRanks.length &&
      compareEndpointRanks(rightRanks[rightRanksLessThan], rank) < 0
    ) {
      rightRanksLessThan += 1;
    }
    while (
      rightRanksLessThanOrEqual < rightRanks.length &&
      compareEndpointRanks(rightRanks[rightRanksLessThanOrEqual], rank) <= 0
    ) {
      rightRanksLessThanOrEqual += 1;
    }
    const leftMultiplicity = leftEnd - leftIndex;
    const rightRanksGreater = rightRanks.length - rightRanksLessThanOrEqual;
    delta += leftMultiplicity * (rightRanksGreater - rightRanksLessThan);
    leftIndex = leftEnd;
  }
  return delta;
}

function improveAdjacentSwitches(graph: WorkingLayerGraph): void {
  const noEndpointRanks: readonly EndpointRank[] = [];
  for (let layerIndex = 0; layerIndex < graph.layers.length; layerIndex += 1) {
    const layer = graph.layers[layerIndex];
    if (layer.length < 2) continue;

    const incomingRanksByVertex =
      layerIndex === 0
        ? new Map<WorkingVertex, EndpointRank[]>()
        : endpointRanksByVertex(
            graph.segmentsByGap[layerIndex - 1],
            new Map(
              graph.layers[layerIndex - 1].map((key, index) => [key, index]),
            ),
            "source",
          );
    const outgoingRanksByVertex =
      layerIndex === graph.layers.length - 1
        ? new Map<WorkingVertex, EndpointRank[]>()
        : endpointRanksByVertex(
            graph.segmentsByGap[layerIndex],
            new Map(
              graph.layers[layerIndex + 1].map((key, index) => [key, index]),
            ),
            "target",
          );

    for (let index = 0; index < layer.length - 1; index += 1) {
      const leftVertex = layer[index];
      const rightVertex = layer[index + 1];
      const crossingDelta =
        adjacentSwapCrossingDelta(
          incomingRanksByVertex.get(leftVertex) ?? noEndpointRanks,
          incomingRanksByVertex.get(rightVertex) ?? noEndpointRanks,
        ) +
        adjacentSwapCrossingDelta(
          outgoingRanksByVertex.get(leftVertex) ?? noEndpointRanks,
          outgoingRanksByVertex.get(rightVertex) ?? noEndpointRanks,
        );
      if (crossingDelta <= 0) {
        layer[index] = rightVertex;
        layer[index + 1] = leftVertex;
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
      sortLayerByNeighborMedian(graph, layerIndex, layerIndex - 1, "source");
    }

    for (
      let layerIndex = graph.layers.length - 2;
      layerIndex >= 0;
      layerIndex -= 1
    ) {
      sortLayerByNeighborMedian(graph, layerIndex, layerIndex, "target");
    }
  }

  improveAdjacentSwitches(graph);

  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    layers[layerIndex].length = 0;
    for (const key of graph.layers[layerIndex]) {
      if (typeof key === "number") {
        layers[layerIndex].push(key);
      }
    }
  }
  return {
    layers: graph.layers,
    segmentsByGap: graph.segmentsByGap,
  };
}
