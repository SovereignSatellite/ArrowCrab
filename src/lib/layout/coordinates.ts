import type { Edge } from "../graph/types";
import type { WorkingLayerGraph, WorkingVertex } from "./layer-order";
import { createWorkingLayerGraph } from "./layer-order";

interface CoordinateSegment {
  from: WorkingVertex;
  to: WorkingVertex;
  edgeIndex: number;
  source: WorkingVertex;
  target: WorkingVertex;
}

interface CoordinateOrientation {
  reverseLayers: boolean;
  reverseWithinLayer: boolean;
  useOutgoingNeighbors: boolean;
}

interface CoordinateResult {
  coordinates: Map<WorkingVertex, number>;
  maximum: number;
}

function middlePairAverage(
  first: number,
  second: number,
  third: number,
  fourth: number,
): number {
  const minimum = Math.min(first, second, third, fourth);
  const maximum = Math.max(first, second, third, fourth);
  return Math.round((first + second + third + fourth - minimum - maximum) / 2);
}

function coordinateLayers(
  graph: WorkingLayerGraph,
  orientation: CoordinateOrientation,
): WorkingVertex[][] {
  const layers = orientation.reverseLayers
    ? [...graph.layers].reverse()
    : [...graph.layers];
  return layers.map((layer) =>
    orientation.reverseWithinLayer ? [...layer].reverse() : [...layer],
  );
}

function coordinateNeighborMap(
  graph: WorkingLayerGraph,
  orientation: CoordinateOrientation,
): Map<WorkingVertex, WorkingVertex[]> {
  return orientation.useOutgoingNeighbors ? graph.outgoing : graph.incoming;
}

function coordinateSegments(
  graph: WorkingLayerGraph,
  layers: WorkingVertex[][],
  orientation: CoordinateOrientation,
): CoordinateSegment[] {
  const layerIndex = new Map<WorkingVertex, number>();
  for (let index = 0; index < layers.length; index += 1) {
    for (const vertex of layers[index]) layerIndex.set(vertex, index);
  }
  const segments: CoordinateSegment[] = [];
  for (const segmentList of graph.segmentsByGap) {
    for (const segment of segmentList) {
      const sourceLayer = layerIndex.get(segment.source);
      const targetLayer = layerIndex.get(segment.target);
      if (sourceLayer === undefined || targetLayer === undefined) continue;
      if (targetLayer === sourceLayer + 1) {
        segments.push({
          from: segment.source,
          to: segment.target,
          edgeIndex: segment.edgeIndex,
          source: segment.source,
          target: segment.target,
        });
      } else if (orientation.reverseLayers && sourceLayer === targetLayer + 1) {
        segments.push({
          from: segment.target,
          to: segment.source,
          edgeIndex: segment.edgeIndex,
          source: segment.source,
          target: segment.target,
        });
      }
    }
  }
  return segments;
}

function coordinateSegmentKey(
  source: WorkingVertex,
  target: WorkingVertex,
  edgeIndex: number,
): string {
  return `${source}:${target}:${edgeIndex}`;
}

function markCoordinateConflicts(
  layers: WorkingVertex[][],
  segments: CoordinateSegment[],
  positions: Map<WorkingVertex, number>,
): Set<string> {
  const conflicts = new Set<string>();
  const segmentsByTarget = new Map<WorkingVertex, CoordinateSegment[]>();
  const segmentsByGap = Array.from(
    { length: Math.max(0, layers.length - 1) },
    () => [] as CoordinateSegment[],
  );
  const layerOf = new Map<WorkingVertex, number>();
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    for (const vertex of layers[layerIndex]) layerOf.set(vertex, layerIndex);
  }
  for (const segment of segments) {
    const list = segmentsByTarget.get(segment.to);
    if (list) list.push(segment);
    else segmentsByTarget.set(segment.to, [segment]);
    const fromLayer = layerOf.get(segment.from);
    const toLayer = layerOf.get(segment.to);
    if (
      fromLayer !== undefined &&
      toLayer === fromLayer + 1 &&
      fromLayer < segmentsByGap.length
    ) {
      segmentsByGap[fromLayer].push(segment);
    }
  }

  // Brandes–Köpf excludes both segments of Type-2 crossings from vertical
  // alignment.
  for (const gapSegments of segmentsByGap) {
    const innerSegments = gapSegments
      .filter(
        (segment) =>
          segment.from.startsWith("v:") && segment.to.startsWith("v:"),
      )
      .sort(
        (left, right) =>
          positions.get(left.from)! - positions.get(right.from)! ||
          positions.get(left.to)! - positions.get(right.to)!,
      );
    let highestTarget = -1;
    let highestTargetSegment: CoordinateSegment | null = null;
    for (const segment of innerSegments) {
      const targetPosition = positions.get(segment.to)!;
      if (targetPosition < highestTarget && highestTargetSegment) {
        conflicts.add(
          coordinateSegmentKey(
            segment.source,
            segment.target,
            segment.edgeIndex,
          ),
        );
        conflicts.add(
          coordinateSegmentKey(
            highestTargetSegment.source,
            highestTargetSegment.target,
            highestTargetSegment.edgeIndex,
          ),
        );
      }
      if (targetPosition > highestTarget) {
        highestTarget = targetPosition;
        highestTargetSegment = segment;
      }
    }
  }

  // Scan Type-1 conflicts with the interval preprocessing from Algorithm 1 of
  // Brandes and Köpf.
  for (let layerIndex = 1; layerIndex < layers.length - 1; layerIndex += 1) {
    const currentLayer = layers[layerIndex];
    const previousLayer = layers[layerIndex - 1];
    let lowerBound = 0;
    let cursor = 0;
    while (cursor < currentLayer.length) {
      let end = cursor;
      while (end < currentLayer.length) {
        const incoming = segmentsByTarget.get(currentLayer[end]) ?? [];
        const hasInner = incoming.some(
          (segment) =>
            segment.from.startsWith("v:") && segment.to.startsWith("v:"),
        );
        if (hasInner) break;
        end += 1;
      }
      const boundary =
        end < currentLayer.length
          ? ((segmentsByTarget.get(currentLayer[end]) ?? [])
              .filter(
                (segment) =>
                  segment.from.startsWith("v:") && segment.to.startsWith("v:"),
              )
              .map((segment) => positions.get(segment.from) ?? lowerBound)
              .sort((left, right) => left - right)[0] ??
            previousLayer.length - 1)
          : previousLayer.length - 1;
      for (
        let index = cursor;
        index <= end && index < currentLayer.length;
        index += 1
      ) {
        for (const segment of segmentsByTarget.get(currentLayer[index]) ?? []) {
          if (segment.from.startsWith("v:") && segment.to.startsWith("v:"))
            continue;
          const sourcePosition = positions.get(segment.from);
          if (
            sourcePosition !== undefined &&
            (sourcePosition < lowerBound || sourcePosition > boundary)
          ) {
            conflicts.add(
              coordinateSegmentKey(
                segment.source,
                segment.target,
                segment.edgeIndex,
              ),
            );
          }
        }
      }
      lowerBound = boundary;
      cursor = Math.max(cursor + 1, end + 1);
    }
  }
  return conflicts;
}

function compactCoordinateBlocks(
  layers: WorkingVertex[][],
  neighborMap: Map<WorkingVertex, WorkingVertex[]>,
  segments: CoordinateSegment[],
  conflicts: Set<string>,
  leftmost: boolean,
): CoordinateResult {
  const positions = new Map<WorkingVertex, number>();
  const predecessor = new Map<WorkingVertex, WorkingVertex>();
  const layerOf = new Map<WorkingVertex, number>();
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    for (let index = 0; index < layers[layerIndex].length; index += 1) {
      const vertex = layers[layerIndex][index];
      positions.set(vertex, index);
      layerOf.set(vertex, layerIndex);
      if (index > 0) predecessor.set(vertex, layers[layerIndex][index - 1]);
    }
  }
  const segmentByEndpoints = new Map<string, CoordinateSegment[]>();
  for (const segment of segments) {
    const key = `${segment.from}:${segment.to}`;
    const list = segmentByEndpoints.get(key);
    if (list) list.push(segment);
    else segmentByEndpoints.set(key, [segment]);
  }

  const root = new Map<WorkingVertex, WorkingVertex>();
  const align = new Map<WorkingVertex, WorkingVertex>();
  for (const layer of layers) {
    for (const vertex of layer) {
      root.set(vertex, vertex);
      align.set(vertex, vertex);
    }
  }

  for (const layer of layers) {
    let lastNeighborPosition = leftmost ? -1 : Number.POSITIVE_INFINITY;
    for (const vertex of layer) {
      const neighbors = (neighborMap.get(vertex) ?? [])
        .filter((neighbor) => positions.has(neighbor))
        .sort((left, right) => positions.get(left)! - positions.get(right)!);
      const medianStart = Math.floor((neighbors.length - 1) / 2);
      const medianEnd = Math.ceil((neighbors.length - 1) / 2);
      const candidates = [neighbors[medianStart], neighbors[medianEnd]].filter(
        (neighbor, index, list): neighbor is WorkingVertex =>
          neighbor !== undefined && list.indexOf(neighbor) === index,
      );
      if (!leftmost) candidates.reverse();
      for (const neighbor of candidates) {
        const source = neighbor;
        const target = vertex;
        const candidateSegments =
          segmentByEndpoints.get(`${source}:${target}`) ??
          segmentByEndpoints.get(`${target}:${source}`) ??
          [];
        const marked =
          candidateSegments.length === 0 ||
          candidateSegments.every((segment) =>
            conflicts.has(
              coordinateSegmentKey(
                segment.source,
                segment.target,
                segment.edgeIndex,
              ),
            ),
          );
        const neighborPosition = positions.get(neighbor)!;
        const canMove = leftmost
          ? lastNeighborPosition < neighborPosition
          : lastNeighborPosition > neighborPosition;
        if (align.get(vertex) === vertex && !marked && canMove) {
          align.set(neighbor, vertex);
          root.set(vertex, root.get(neighbor)!);
          align.set(vertex, root.get(vertex)!);
          lastNeighborPosition = neighborPosition;
          break;
        }
      }
    }
  }

  const sink = new Map<WorkingVertex, WorkingVertex>();
  const shift = new Map<WorkingVertex, number>();
  const horizontalCoordinates = new Map<WorkingVertex, number>();
  for (const layer of layers) {
    for (const vertex of layer) {
      sink.set(vertex, vertex);
      shift.set(vertex, Number.POSITIVE_INFINITY);
    }
  }

  const placeBlock = (vertex: WorkingVertex): void => {
    if (horizontalCoordinates.has(vertex)) return;
    horizontalCoordinates.set(vertex, 0);
    let current = vertex;
    do {
      const previous = predecessor.get(current);
      if (previous) {
        const previousRoot = root.get(previous)!;
        placeBlock(previousRoot);
        if (sink.get(vertex) === vertex)
          sink.set(vertex, sink.get(previousRoot)!);
        if (sink.get(vertex) === sink.get(previousRoot)) {
          horizontalCoordinates.set(
            vertex,
            Math.max(
              horizontalCoordinates.get(vertex)!,
              horizontalCoordinates.get(previousRoot)! + 1,
            ),
          );
        }
      }
      current = align.get(current)!;
    } while (current !== vertex);

    current = align.get(vertex)!;
    while (current !== vertex) {
      horizontalCoordinates.set(current, horizontalCoordinates.get(vertex)!);
      sink.set(current, sink.get(vertex)!);
      current = align.get(current)!;
    }
  };

  for (const layer of layers) {
    for (const vertex of layer) {
      if (root.get(vertex) === vertex) placeBlock(vertex);
    }
  }

  const neighboringPairs = Array.from(
    { length: layers.length },
    () => [] as [WorkingVertex, WorkingVertex][],
  );
  for (const layer of layers) {
    for (let index = 1; index < layer.length; index += 1) {
      const left = layer[index - 1];
      const right = layer[index];
      if (sink.get(left) !== sink.get(right)) {
        const rightSinkLayer = layerOf.get(sink.get(right)!);
        if (rightSinkLayer !== undefined) {
          neighboringPairs[rightSinkLayer].push([left, right]);
        }
      }
    }
  }
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    const first = layers[layerIndex][0];
    if (!first) continue;
    const firstSink = sink.get(first)!;
    if (!Number.isFinite(shift.get(firstSink))) shift.set(firstSink, 0);
    for (const [left, right] of neighboringPairs[layerIndex]) {
      const leftSink = sink.get(left)!;
      const rightSink = sink.get(right)!;
      const rightShift = shift.get(rightSink)!;
      if (Number.isFinite(rightShift)) {
        shift.set(
          leftSink,
          Math.min(
            shift.get(leftSink)!,
            rightShift +
              horizontalCoordinates.get(right)! -
              (horizontalCoordinates.get(left)! + 1),
          ),
        );
      }
    }
  }

  let maximum = 0;
  for (const vertex of layers.flat()) {
    const offset = shift.get(sink.get(vertex)!)!;
    const coordinate =
      horizontalCoordinates.get(vertex)! +
      (Number.isFinite(offset) ? offset : 0);
    horizontalCoordinates.set(vertex, coordinate);
    maximum = Math.max(maximum, coordinate);
  }
  return { coordinates: horizontalCoordinates, maximum };
}

export function computeBrandesKopfCoordinates(
  layers: number[][],
  layerOf: Map<number, number>,
  edges: Edge[],
  orderedGraph?: WorkingLayerGraph,
): Map<number, number> {
  if (layers.length === 0) return new Map();
  const graph = orderedGraph ?? createWorkingLayerGraph(layers, layerOf, edges);
  const orientations: CoordinateOrientation[] = [
    {
      reverseLayers: false,
      reverseWithinLayer: false,
      useOutgoingNeighbors: false,
    },
    {
      reverseLayers: false,
      reverseWithinLayer: true,
      useOutgoingNeighbors: false,
    },
    {
      reverseLayers: true,
      reverseWithinLayer: false,
      useOutgoingNeighbors: true,
    },
    {
      reverseLayers: true,
      reverseWithinLayer: true,
      useOutgoingNeighbors: true,
    },
  ];
  const assignments: Map<WorkingVertex, number>[] = [];
  for (const orientation of orientations) {
    const coordinateLayersResult = coordinateLayers(graph, orientation);
    const positions = new Map<WorkingVertex, number>();
    for (const layer of coordinateLayersResult) {
      for (let index = 0; index < layer.length; index += 1) {
        positions.set(layer[index], index);
      }
    }
    const segments = coordinateSegments(
      graph,
      coordinateLayersResult,
      orientation,
    );
    const conflicts = markCoordinateConflicts(
      coordinateLayersResult,
      segments,
      positions,
    );
    const result = compactCoordinateBlocks(
      coordinateLayersResult,
      coordinateNeighborMap(graph, orientation),
      segments,
      conflicts,
      !orientation.reverseWithinLayer,
    );
    const normalized = new Map<WorkingVertex, number>();
    const mirror = orientation.reverseWithinLayer ? result.maximum : 0;
    let minimum = Number.POSITIVE_INFINITY;
    for (const [vertex, coordinate] of result.coordinates) {
      const value = mirror - coordinate;
      normalized.set(vertex, value);
      minimum = Math.min(minimum, value);
    }
    for (const [vertex, coordinate] of normalized) {
      normalized.set(vertex, coordinate - minimum);
    }
    assignments.push(normalized);
  }

  const result = new Map<number, number>();
  for (const [nodeId, key] of graph.originalKeyById) {
    result.set(
      nodeId,
      middlePairAverage(
        assignments[0].get(key) ?? 0,
        assignments[1].get(key) ?? 0,
        assignments[2].get(key) ?? 0,
        assignments[3].get(key) ?? 0,
      ),
    );
  }
  return result;
}
