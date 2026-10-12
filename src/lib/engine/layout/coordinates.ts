import type { WorkingLayerGraph, WorkingVertex } from "./layer-order.ts";

type WorkingSegment = WorkingLayerGraph["segmentsByGap"][number][number];

interface CoordinateResult {
  originalCoordinates: Map<WorkingVertex, number>;
  minimum: number;
  maximum: number;
}

type VerticalDirection = "down" | "up";
type HorizontalDirection = "left" | "right";

interface CoordinateAssignment extends CoordinateResult {
  horizontalDirection: HorizontalDirection;
}

const ORIENTATIONS = [
  { verticalDirection: "down", horizontalDirection: "left" },
  { verticalDirection: "down", horizontalDirection: "right" },
  { verticalDirection: "up", horizontalDirection: "left" },
  { verticalDirection: "up", horizontalDirection: "right" },
] as const;

function isVirtual(vertex: WorkingVertex): boolean {
  return typeof vertex !== "number";
}

function orientedSource(
  segment: WorkingSegment,
  direction: VerticalDirection,
): WorkingVertex {
  switch (direction) {
    case "down":
      return segment.source;
    case "up":
      return segment.target;
  }
}

function orientedTarget(
  segment: WorkingSegment,
  direction: VerticalDirection,
): WorkingVertex {
  switch (direction) {
    case "down":
      return segment.target;
    case "up":
      return segment.source;
  }
}

function middlePairAverage(
  first: number,
  second: number,
  third: number,
  fourth: number,
): number {
  const minimum = Math.min(first, second, third, fourth);
  const maximum = Math.max(first, second, third, fourth);
  return (first + second + third + fourth - minimum - maximum) / 2;
}

function buildSegmentsByTarget(
  graph: WorkingLayerGraph,
  direction: VerticalDirection,
): Map<WorkingVertex, WorkingSegment[]> {
  const segmentsByTarget = new Map<WorkingVertex, WorkingSegment[]>();
  for (const gap of graph.segmentsByGap) {
    for (const segment of gap) {
      const target = orientedTarget(segment, direction);
      const segments = segmentsByTarget.get(target);
      if (segments) segments.push(segment);
      else segmentsByTarget.set(target, [segment]);
    }
  }
  return segmentsByTarget;
}

function markCoordinateConflicts(
  graph: WorkingLayerGraph,
  layers: WorkingVertex[][],
  segmentsByTarget: Map<WorkingVertex, WorkingSegment[]>,
  positions: Map<WorkingVertex, number>,
  direction: VerticalDirection,
): Set<WorkingSegment> {
  const conflicts = new Set<WorkingSegment>();

  for (let gapIndex = 0; gapIndex < layers.length - 1; gapIndex += 1) {
    const originalGap =
      direction === "up" ? graph.segmentsByGap.length - gapIndex - 1 : gapIndex;
    const innerSegments = graph.segmentsByGap[originalGap]
      .filter(
        (segment) =>
          isVirtual(orientedSource(segment, direction)) &&
          isVirtual(orientedTarget(segment, direction)),
      )
      .sort(
        (left, right) =>
          positions.get(orientedSource(left, direction))! -
            positions.get(orientedSource(right, direction))! ||
          positions.get(orientedTarget(left, direction))! -
            positions.get(orientedTarget(right, direction))!,
      );

    let highestTarget = -1;
    let highestTargetSegment!: WorkingSegment;
    for (const segment of innerSegments) {
      const targetPosition = positions.get(orientedTarget(segment, direction))!;
      if (targetPosition < highestTarget) {
        conflicts.add(segment);
        conflicts.add(highestTargetSegment);
      }
      if (targetPosition > highestTarget) {
        highestTarget = targetPosition;
        highestTargetSegment = segment;
      }
    }
  }

  for (let layerIndex = 1; layerIndex < layers.length - 1; layerIndex += 1) {
    const currentLayer = layers[layerIndex];
    const previousLayer = layers[layerIndex - 1];
    let lowerBound = 0;
    let cursor = 0;
    while (cursor < currentLayer.length) {
      let end = cursor;
      while (end < currentLayer.length) {
        const incoming = segmentsByTarget.get(currentLayer[end]) ?? [];
        if (
          incoming.some(
            (segment) =>
              isVirtual(orientedSource(segment, direction)) &&
              isVirtual(orientedTarget(segment, direction)),
          )
        ) {
          break;
        }
        end += 1;
      }

      let boundary = previousLayer.length - 1;
      if (end < currentLayer.length) {
        boundary = Number.POSITIVE_INFINITY;
        for (const segment of segmentsByTarget.get(currentLayer[end]) ?? []) {
          if (
            isVirtual(orientedSource(segment, direction)) &&
            isVirtual(orientedTarget(segment, direction))
          ) {
            boundary = Math.min(
              boundary,
              positions.get(orientedSource(segment, direction))!,
            );
          }
        }
      }

      for (
        let index = cursor;
        index <= end && index < currentLayer.length;
        index += 1
      ) {
        for (const segment of segmentsByTarget.get(currentLayer[index]) ?? []) {
          const source = orientedSource(segment, direction);
          const target = orientedTarget(segment, direction);
          if (isVirtual(source) && isVirtual(target)) continue;
          const sourcePosition = positions.get(source)!;
          if (sourcePosition < lowerBound || sourcePosition > boundary) {
            conflicts.add(segment);
          }
        }
      }
      lowerBound = boundary;
      cursor = end + 1;
    }
  }

  return conflicts;
}

function compactCoordinateBlocks(
  layers: WorkingVertex[][],
  segmentsByTarget: Map<WorkingVertex, WorkingSegment[]>,
  positions: Map<WorkingVertex, number>,
  layerOf: Map<WorkingVertex, number>,
  conflicts: ReadonlySet<WorkingSegment>,
  direction: VerticalDirection,
): CoordinateResult {
  const root = new Map<WorkingVertex, WorkingVertex>();
  const align = new Map<WorkingVertex, WorkingVertex>();
  for (const layer of layers) {
    for (const vertex of layer) {
      root.set(vertex, vertex);
      align.set(vertex, vertex);
    }
  }

  const noSegments: WorkingSegment[] = [];
  for (const layer of layers) {
    let lastNeighborPosition = -1;
    for (const vertex of layer) {
      const segments = segmentsByTarget.get(vertex) ?? noSegments;
      segments.sort(
        (left, right) =>
          positions.get(orientedSource(left, direction))! -
          positions.get(orientedSource(right, direction))!,
      );
      const medianLeft = segments[Math.floor((segments.length - 1) / 2)];
      const medianRight = segments[Math.ceil((segments.length - 1) / 2)];
      const candidates: WorkingVertex[] = [];
      if (medianLeft) {
        candidates.push(orientedSource(medianLeft, direction));
      }
      if (
        medianRight &&
        orientedSource(medianRight, direction) !== candidates[0]
      ) {
        candidates.push(orientedSource(medianRight, direction));
      }

      for (const neighbor of candidates) {
        const neighborPosition = positions.get(neighbor)!;
        if (
          align.get(vertex) === vertex &&
          neighborPosition > lastNeighborPosition &&
          segments.some(
            (segment) =>
              orientedSource(segment, direction) === neighbor &&
              !conflicts.has(segment),
          )
        ) {
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
  const coordinates = new Map<WorkingVertex, number>();
  for (const layer of layers) {
    for (const vertex of layer) {
      sink.set(vertex, vertex);
    }
  }

  const placeBlock = (vertex: WorkingVertex): void => {
    if (coordinates.has(vertex)) return;
    coordinates.set(vertex, 0);
    let current = vertex;
    do {
      const currentPosition = positions.get(current)!;
      if (currentPosition > 0) {
        const previous = layers[layerOf.get(current)!][currentPosition - 1];
        const previousRoot = root.get(previous)!;
        placeBlock(previousRoot);
        if (sink.get(vertex) === vertex) {
          sink.set(vertex, sink.get(previousRoot)!);
        }
        if (sink.get(vertex) === sink.get(previousRoot)) {
          coordinates.set(
            vertex,
            Math.max(
              coordinates.get(vertex)!,
              coordinates.get(previousRoot)! + 1,
            ),
          );
        }
      }
      current = align.get(current)!;
    } while (current !== vertex);

    const classSink = sink.get(vertex)!;
    shift.set(classSink, Number.POSITIVE_INFINITY);
    current = align.get(vertex)!;
    while (current !== vertex) {
      coordinates.set(current, coordinates.get(vertex)!);
      sink.set(current, classSink);
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
    () => [] as WorkingVertex[],
  );
  for (const layer of layers) {
    for (let index = 1; index < layer.length; index += 1) {
      const left = layer[index - 1];
      const right = layer[index];
      if (sink.get(left) !== sink.get(right)) {
        neighboringPairs[layerOf.get(sink.get(right)!)!].push(left, right);
      }
    }
  }

  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    const first = layers[layerIndex][0];
    const firstSink = sink.get(first)!;
    if (shift.get(firstSink) === Number.POSITIVE_INFINITY) {
      shift.set(firstSink, 0);
    }

    const pairs = neighboringPairs[layerIndex];
    for (let index = 0; index < pairs.length; index += 2) {
      const left = pairs[index];
      const right = pairs[index + 1];
      const leftSink = sink.get(left)!;
      const rightSink = sink.get(right)!;
      shift.set(
        leftSink,
        Math.min(
          shift.get(leftSink)!,
          shift.get(rightSink)! +
            coordinates.get(right)! -
            (coordinates.get(left)! + 1),
        ),
      );
    }
  }

  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const layer of layers) {
    for (const vertex of layer) {
      const offset = shift.get(sink.get(vertex)!)!;
      const coordinate = coordinates.get(vertex)! + offset;
      if (isVirtual(vertex)) coordinates.delete(vertex);
      else coordinates.set(vertex, coordinate);
      minimum = Math.min(minimum, coordinate);
      maximum = Math.max(maximum, coordinate);
    }
  }
  return { originalCoordinates: coordinates, minimum, maximum };
}

export function computeBrandesKopfCoordinates(
  orderedGraph: WorkingLayerGraph,
): Map<number, number> {
  const layers = orderedGraph.layers.map((layer) => [...layer]);
  const positions = new Map<WorkingVertex, number>();
  const layerOf = new Map<WorkingVertex, number>();
  const assignments: CoordinateAssignment[] = [];
  let previousVerticalDirection: VerticalDirection = "down";
  let previousHorizontalDirection: HorizontalDirection = "left";
  let segmentsByTarget = buildSegmentsByTarget(orderedGraph, "down");

  for (const orientation of ORIENTATIONS) {
    if (orientation.verticalDirection !== previousVerticalDirection) {
      layers.reverse();
      segmentsByTarget = buildSegmentsByTarget(
        orderedGraph,
        orientation.verticalDirection,
      );
      previousVerticalDirection = orientation.verticalDirection;
    }
    if (orientation.horizontalDirection !== previousHorizontalDirection) {
      for (const layer of layers) layer.reverse();
      previousHorizontalDirection = orientation.horizontalDirection;
    }

    positions.clear();
    layerOf.clear();
    for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
      for (
        let position = 0;
        position < layers[layerIndex].length;
        position += 1
      ) {
        const vertex = layers[layerIndex][position];
        positions.set(vertex, position);
        layerOf.set(vertex, layerIndex);
      }
    }

    const conflicts = markCoordinateConflicts(
      orderedGraph,
      layers,
      segmentsByTarget,
      positions,
      orientation.verticalDirection,
    );
    const result = compactCoordinateBlocks(
      layers,
      segmentsByTarget,
      positions,
      layerOf,
      conflicts,
      orientation.verticalDirection,
    );
    if (orientation.horizontalDirection === "right") {
      for (const [vertex, coordinate] of result.originalCoordinates) {
        result.originalCoordinates.set(vertex, -coordinate);
      }
      [result.minimum, result.maximum] = [-result.maximum, -result.minimum];
    }
    assignments.push({
      ...result,
      horizontalDirection: orientation.horizontalDirection,
    });
  }

  let narrowest = assignments[0];
  for (let index = 1; index < assignments.length; index += 1) {
    const assignment = assignments[index]!;
    if (
      assignment.maximum - assignment.minimum <
      narrowest.maximum - narrowest.minimum
    ) {
      narrowest = assignment;
    }
  }

  for (const assignment of assignments) {
    const offset =
      assignment.horizontalDirection === "right"
        ? narrowest.maximum - assignment.maximum
        : narrowest.minimum - assignment.minimum;
    for (const [vertex, coordinate] of assignment.originalCoordinates) {
      assignment.originalCoordinates.set(vertex, coordinate + offset);
    }
  }

  const result = new Map<number, number>();
  for (const key of assignments[0].originalCoordinates.keys()) {
    result.set(
      key as number,
      middlePairAverage(
        assignments[0].originalCoordinates.get(key)!,
        assignments[1].originalCoordinates.get(key)!,
        assignments[2].originalCoordinates.get(key)!,
        assignments[3].originalCoordinates.get(key)!,
      ),
    );
  }
  return result;
}
