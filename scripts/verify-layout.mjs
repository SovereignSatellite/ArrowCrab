import assert from "node:assert/strict";

const { buildGraphModel } = await import("../src/lib/graph/index.ts");
const { getExampleGraphDefinitions } = await import("../src/lib/examples.ts");
const { computeAllLayouts } = await import("../src/lib/layout/index.ts");
const { computeAllRouting } = await import("../src/lib/routing/index.ts");
const { TrackAllocator } = await import("../src/lib/routing/tracks.ts");
const { serializeLayoutSnapshot, deserializeLayoutSnapshot } =
  await import("../src/lib/scene/index.ts");

const graphData = {
  strings: ["", "input", "middle", "join", "output", "#6aa0ff"],
  subgraphs: [],
  nodes: [1, 1, 5, 2, 2, 5, 3, 2, 5, 4, 3, 5, 5, 4, 5, 6, 4, 5],
  edges: [
    1, 0, 2, 0, 1, 1, 3, 0, 2, 0, 4, 0, 3, 0, 4, 1, 4, 0, 5, 0, 1, 2, 5, 1, 5,
    0, 6, 0, 1, 0, 2, 0,
  ],
};

function build() {
  const model = buildGraphModel(graphData);
  const expandedNodes = new Set();
  const layoutMap = computeAllLayouts(model, expandedNodes);
  const routingMap = computeAllRouting(model, layoutMap, expandedNodes);
  return { model, layoutMap, routingMap };
}

function assertOrthogonal(points) {
  assert.ok(points.length >= 2);
  for (let index = 0; index < points.length - 1; index += 1) {
    const first = points[index];
    const second = points[index + 1];
    assert.ok(
      first.x === second.x || first.y === second.y,
      `segment ${index} is not orthogonal`,
    );
  }
}

function countTurns(points) {
  let previousDirection;
  let turns = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const first = points[index];
    const second = points[index + 1];
    if (first.x === second.x && first.y === second.y) continue;
    const direction = first.x === second.x ? "vertical" : "horizontal";
    if (previousDirection && previousDirection !== direction) turns += 1;
    previousDirection = direction;
  }
  return turns;
}

function routePoints(routing, routeIndex) {
  const points = [];
  for (
    let index = routing.routeOffsets[routeIndex];
    index < routing.routeOffsets[routeIndex + 1];
    index += 1
  ) {
    points.push({
      x: routing.routePoints[index * 2],
      y: routing.routePoints[index * 2 + 1],
    });
  }
  return points;
}

function assertNoNodeIntersection(points, nodePositions) {
  for (let index = 0; index < points.length - 1; index += 1) {
    const first = points[index];
    const second = points[index + 1];
    const minX = Math.min(first.x, second.x);
    const maxX = Math.max(first.x, second.x);
    const minY = Math.min(first.y, second.y);
    const maxY = Math.max(first.y, second.y);
    for (const [, position] of nodePositions) {
      const overlapsInterior =
        maxX > position.x * 12 &&
        minX < (position.x + position.width) * 12 &&
        maxY > position.y * 12 &&
        minY < (position.y + position.height) * 12;
      assert.equal(overlapsInterior, false, "route intersects a node interior");
    }
  }
}

function assertNoUnintendedOverlap(routing) {
  const segments = [];
  for (
    let edgeIndex = 0;
    edgeIndex < routing.routedEdges.length;
    edgeIndex += 1
  ) {
    const points = routePoints(routing, edgeIndex);
    for (let pointIndex = 0; pointIndex < points.length - 1; pointIndex += 1) {
      const first = points[pointIndex];
      const second = points[pointIndex + 1];
      const endpointKey =
        pointIndex === 0 && first.x === second.x
          ? `source:${routing.routedEdges[edgeIndex].edge.sourceId}:${routing.routedEdges[edgeIndex].edge.sourcePort}`
          : pointIndex === points.length - 2 && first.x === second.x
            ? `target:${routing.routedEdges[edgeIndex].edge.targetId}:${routing.routedEdges[edgeIndex].edge.targetPort}`
            : undefined;
      segments.push({
        edgeIndex,
        key: routing.routedEdges[edgeIndex].key,
        endpointKey,
        first,
        second,
        horizontal: first.y === second.y,
        fixed: first.y === second.y ? first.y : first.x,
        start:
          first.y === second.y
            ? Math.min(first.x, second.x)
            : Math.min(first.y, second.y),
        end:
          first.y === second.y
            ? Math.max(first.x, second.x)
            : Math.max(first.y, second.y),
      });
    }
  }
  for (let left = 0; left < segments.length; left += 1) {
    for (let right = left + 1; right < segments.length; right += 1) {
      const first = segments[left];
      const second = segments[right];
      if (
        first.edgeIndex !== second.edgeIndex &&
        first.horizontal === second.horizontal &&
        first.fixed === second.fixed &&
        Math.min(first.end, second.end) > Math.max(first.start, second.start) &&
        first.endpointKey !== second.endpointKey &&
        !(
          (first.first.x === second.first.x &&
            first.first.y === second.first.y) ||
          (first.first.x === second.second.x &&
            first.first.y === second.second.y) ||
          (first.second.x === second.first.x &&
            first.second.y === second.first.y) ||
          (first.second.x === second.second.x &&
            first.second.y === second.second.y)
        )
      ) {
        assert.fail(
          `distinct routes share a positive-length segment: ${JSON.stringify({ first, second })}`,
        );
      }
    }
  }
}

function assertCrossingMarkers(routing) {
  const segments = [];
  for (
    let edgeIndex = 0;
    edgeIndex < routing.routedEdges.length;
    edgeIndex += 1
  ) {
    const points = routePoints(routing, edgeIndex);
    for (let pointIndex = 0; pointIndex < points.length - 1; pointIndex += 1) {
      const first = points[pointIndex];
      const second = points[pointIndex + 1];
      if (first.y === second.y && first.x !== second.x) {
        segments.push({
          edgeIndex,
          horizontal: true,
          fixed: first.y,
          start: Math.min(first.x, second.x),
          end: Math.max(first.x, second.x),
        });
      } else if (first.x === second.x && first.y !== second.y) {
        segments.push({
          edgeIndex,
          horizontal: false,
          fixed: first.x,
          start: Math.min(first.y, second.y),
          end: Math.max(first.y, second.y),
        });
      }
    }
  }

  const expected = new Set();
  for (const horizontal of segments) {
    if (!horizontal.horizontal) continue;
    for (const vertical of segments) {
      if (
        vertical.horizontal ||
        vertical.edgeIndex === horizontal.edgeIndex ||
        vertical.fixed <= horizontal.start ||
        vertical.fixed >= horizontal.end ||
        horizontal.fixed <= vertical.start ||
        horizontal.fixed >= vertical.end
      ) {
        continue;
      }
      expected.add(`${vertical.fixed}:${horizontal.fixed}`);
    }
  }
  const actual = new Set(
    routing.crossings.map((point) => `${point.x}:${point.y}`),
  );
  assert.deepEqual(
    actual,
    expected,
    "crossing markers do not match route intersections",
  );
}

function countLayerCrossings(layers, edges) {
  const layerOf = new Map();
  const positionOf = new Map();
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    for (
      let position = 0;
      position < layers[layerIndex].length;
      position += 1
    ) {
      const nodeId = layers[layerIndex][position];
      layerOf.set(nodeId, layerIndex);
      positionOf.set(nodeId, position);
    }
  }
  let total = 0;
  for (let layerIndex = 0; layerIndex < layers.length - 1; layerIndex += 1) {
    const segments = edges
      .filter(
        (edge) =>
          layerOf.get(edge[0]) === layerIndex &&
          layerOf.get(edge[2]) === layerIndex + 1,
      )
      .map((edge) => [positionOf.get(edge[0]), positionOf.get(edge[2])])
      .sort((left, right) => left[0] - right[0] || left[1] - right[1]);
    for (let left = 0; left < segments.length; left += 1) {
      for (let right = left + 1; right < segments.length; right += 1) {
        if (segments[left][1] > segments[right][1]) total += 1;
      }
    }
  }
  return total;
}

function permutations(values) {
  if (values.length <= 1) return [values.slice()];
  const result = [];
  for (let index = 0; index < values.length; index += 1) {
    const remainder = values.slice(0, index).concat(values.slice(index + 1));
    for (const suffix of permutations(remainder)) {
      result.push([values[index], ...suffix]);
    }
  }
  return result;
}

function exactCrossingFixture() {
  const data = {
    strings: ["", "source", "target", "#8ab4f8"],
    subgraphs: [],
    nodes: [1, 1, 3, 2, 1, 3, 3, 1, 3, 4, 2, 3, 5, 2, 3, 6, 2, 3],
    edges: [1, 0, 6, 0, 2, 0, 5, 0, 3, 0, 4, 0],
  };
  const model = buildGraphModel(data);
  const layouts = computeAllLayouts(model, new Set());
  const routing = computeAllRouting(model, layouts, new Set());
  const layout = layouts.get("__top__");
  assert.ok(layout);
  const actual = countLayerCrossings(
    layout.layers,
    data.edges.reduce((result, _value, index) => {
      if (index % 4 === 0) result.push(data.edges.slice(index, index + 4));
      return result;
    }, []),
  );
  const firstLayer = layout.layers[0];
  const secondLayer = layout.layers[1];
  let optimum = Number.POSITIVE_INFINITY;
  for (const firstOrder of permutations(firstLayer)) {
    for (const secondOrder of permutations(secondLayer)) {
      optimum = Math.min(
        optimum,
        countLayerCrossings(
          [firstOrder, secondOrder],
          data.edges.reduce((result, _value, index) => {
            if (index % 4 === 0)
              result.push(data.edges.slice(index, index + 4));
            return result;
          }, []),
        ),
      );
    }
  }
  assert.equal(
    actual,
    optimum,
    "small crossing oracle found an avoidable crossing",
  );
  assert.equal(routing.get("__top__").routedEdges.length, 3);
}

function crossingMarkerFixture() {
  const nodes = [];
  for (let nodeId = 1; nodeId <= 14; nodeId += 1) {
    nodes.push(nodeId, 1, 2);
  }
  const data = {
    strings: ["", "node", "#6aa0ff"],
    subgraphs: [],
    nodes,
    edges: [
      1, 0, 9, 0, 1, 0, 10, 0, 1, 0, 13, 0, 2, 0, 6, 0, 2, 0, 9, 0, 3, 0, 5, 0,
      3, 0, 13, 0, 3, 0, 14, 0, 4, 0, 5, 0, 4, 0, 6, 0, 4, 0, 7, 0, 4, 0, 8, 0,
      5, 0, 11, 0, 5, 0, 12, 0, 5, 0, 13, 0, 6, 0, 7, 0, 6, 0, 11, 0, 7, 0, 9,
      0, 7, 0, 10, 0, 7, 0, 14, 0, 8, 0, 12, 0, 10, 0, 14, 0, 11, 0, 12, 0, 11,
      0, 13, 0, 12, 0, 13, 0,
    ],
  };
  const model = buildGraphModel(data);
  const layouts = computeAllLayouts(model, new Set());
  const routing = computeAllRouting(model, layouts, new Set());
  const topRouting = routing.get("__top__");
  assert.ok(topRouting);
  assert.ok(
    topRouting.crossings.length > 0,
    "fixture must contain visible crossings",
  );
  assertNoUnintendedOverlap(topRouting);
  assertCrossingMarkers(topRouting);
}

function randomGraph(seed) {
  let state = (seed + 1) >>> 0;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const nodes = [];
  for (let nodeId = 1; nodeId <= 20; nodeId += 1) {
    nodes.push(nodeId, 1, 2);
  }
  const edges = [];
  for (let sourceId = 1; sourceId < 20; sourceId += 1) {
    for (let targetId = sourceId + 1; targetId <= 20; targetId += 1) {
      if (random() >= 0.12) continue;
      edges.push(
        sourceId,
        Math.floor(random() * 3),
        targetId,
        Math.floor(random() * 3),
      );
    }
  }
  if (edges.length === 0) edges.push(1, 0, 20, 0);
  return {
    strings: ["", "node", "#6aa0ff"],
    subgraphs: [],
    nodes,
    edges,
  };
}

function assertRoutedGraph(data, expectedEdgeCount) {
  const model = buildGraphModel(data);
  const expandedNodes = new Set();
  for (const nodeId of model.indexed.nodeIds) {
    const node = model.nodeMap.get(nodeId);
    if (node?.subgraphs.length) expandedNodes.add(nodeId);
  }
  const layouts = computeAllLayouts(model, expandedNodes);
  const routing = computeAllRouting(model, layouts, expandedNodes);
  assert.equal(
    layouts.size,
    model.scopeMap.size,
    "every resolved scope must have a layout when compound nodes are expanded",
  );
  assert.equal(
    routing.size,
    model.scopeMap.size,
    "every resolved scope must have routing when compound nodes are expanded",
  );
  const topRouting = routing.get("__top__");
  assert.ok(topRouting);
  if (expectedEdgeCount !== undefined) {
    assert.equal(topRouting.routedEdges.length, expectedEdgeCount);
  }

  for (const [scopeId, scope] of model.scopeMap) {
    const layout = layouts.get(scopeId);
    const scopeRouting = routing.get(scopeId);
    assert.ok(layout, `missing layout for ${scopeId}`);
    assert.ok(scopeRouting, `missing routing for ${scopeId}`);
    assert.equal(
      scopeRouting.routedEdges.length,
      scope.edges.length,
      `not every edge in ${scopeId} was routed`,
    );
    const layerOf = new Map();
    for (
      let layerIndex = 0;
      layerIndex < layout.layers.length;
      layerIndex += 1
    ) {
      for (const nodeId of layout.layers[layerIndex]) {
        layerOf.set(nodeId, layerIndex);
      }
    }

    const routeLayer = (nodeId) => {
      if (nodeId === scope.inId) return -1;
      if (nodeId === scope.outId) return layout.layers.length;
      const layer = layerOf.get(nodeId);
      assert.notEqual(
        layer,
        undefined,
        `missing layer for node ${nodeId} in ${scopeId}`,
      );
      return layer;
    };

    for (
      let routeIndex = 0;
      routeIndex < scopeRouting.routedEdges.length;
      routeIndex += 1
    ) {
      const points = routePoints(scopeRouting, routeIndex);
      assertOrthogonal(points);
      assertNoNodeIntersection(points, layout.nodePositions);
      const edge = scopeRouting.routedEdges[routeIndex].edge;
      const layerSpan = Math.abs(
        routeLayer(edge.targetId) - routeLayer(edge.sourceId),
      );
      assert.ok(
        countTurns(points) <= (layerSpan <= 1 ? 2 : 4),
        `route exceeds the fixed layered route-family bend bound for ${scopeRouting.routedEdges[routeIndex].key}`,
      );
    }
    assertCrossingMarkers(scopeRouting);
  }
}

function assertExpansionChangesLayout(data, graphName) {
  const model = buildGraphModel(data);
  const expandedNodes = new Set();
  for (const nodeId of model.indexed.nodeIds) {
    const node = model.nodeMap.get(nodeId);
    if (node?.subgraphs.length) expandedNodes.add(nodeId);
  }

  const collapsedTopLayout = computeAllLayouts(model, new Set()).get("__top__");
  const expandedTopLayout = computeAllLayouts(model, expandedNodes).get(
    "__top__",
  );
  assert.ok(collapsedTopLayout);
  assert.ok(expandedTopLayout);
  assert.ok(
    collapsedTopLayout.gridWidth !== expandedTopLayout.gridWidth ||
      collapsedTopLayout.gridHeight !== expandedTopLayout.gridHeight,
    `${graphName} expansion must change the top-level layout dimensions`,
  );

  const topLevelCompoundIds = model.scopeMap
    .get("__top__")
    .nodeIds.filter((nodeId) => model.nodeMap.get(nodeId)?.subgraphs.length);
  assert.ok(
    topLevelCompoundIds.length >= 2,
    `${graphName} must contain two visible compound nodes`,
  );
  const firstPosition = collapsedTopLayout.nodePositions.get(
    topLevelCompoundIds[0],
  );
  assert.ok(firstPosition);
  assert.ok(
    topLevelCompoundIds.some((nodeId) => {
      const position = collapsedTopLayout.nodePositions.get(nodeId);
      return (
        position &&
        (position.x !== firstPosition.x || position.y !== firstPosition.y)
      );
    }),
    `${graphName} compound nodes must be distributed through the collapsed layout`,
  );
  assert.ok(
    topLevelCompoundIds.some((nodeId) => {
      const collapsedPosition = collapsedTopLayout.nodePositions.get(nodeId);
      const expandedPosition = expandedTopLayout.nodePositions.get(nodeId);
      return (
        collapsedPosition &&
        expandedPosition &&
        (collapsedPosition.x !== expandedPosition.x ||
          collapsedPosition.y !== expandedPosition.y ||
          collapsedPosition.width !== expandedPosition.width ||
          collapsedPosition.height !== expandedPosition.height)
      );
    }),
    `${graphName} expansion must move or resize a visible compound node`,
  );
}

function assertFormerHardOverlapCounterexample() {
  assertRoutedGraph(
    {
      strings: ["", "node", "#6aa0ff"],
      subgraphs: [],
      nodes: [
        1, 1, 2, 2, 1, 2, 3, 1, 2, 4, 1, 2, 5, 1, 2, 6, 1, 2, 7, 1, 2, 8, 1, 2,
      ],
      edges: [
        2, 1, 7, 5, 6, 2, 7, 1, 1, 0, 8, 0, 4, 0, 7, 5, 4, 5, 6, 0, 7, 4, 8, 3,
        5, 5, 7, 2, 4, 1, 5, 4, 2, 5, 5, 1, 7, 2, 8, 1, 7, 2, 8, 3, 1, 0, 3, 0,
      ],
    },
    12,
  );
}

function assertArbitraryPortCorpus() {
  for (let seed = 0; seed < 300; seed += 1) {
    try {
      assertRoutedGraph(randomGraph(seed), undefined);
    } catch (error) {
      assert.fail(
        `arbitrary-port corpus failed at seed ${seed}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

function assertExampleGraphs() {
  const examples = getExampleGraphDefinitions();
  assert.equal(examples.length, 4);
  assert.equal(
    new Set(examples.map((example) => example.slug)).size,
    examples.length,
    "example graph slugs must be unique",
  );
  for (const example of examples) {
    const subgraphs = [];
    const graph = example.create();
    for (let index = 0; index < graph.subgraphs.length; index += 3) {
      subgraphs.push({
        nodeId: graph.subgraphs[index],
        inId: graph.subgraphs[index + 1],
        outId: graph.subgraphs[index + 2],
      });
    }
    assert.ok(
      subgraphs.some(({ nodeId }) =>
        subgraphs.some(({ inId, outId }) => inId < nodeId && nodeId < outId),
      ),
      `${example.name} must contain nested subgraphs`,
    );
    assertExpansionChangesLayout(graph, example.name);
    try {
      assertRoutedGraph(graph);
    } catch (error) {
      assert.fail(
        `${example.name} example failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

function comparable(result) {
  const topLayout = result.layoutMap.get("__top__");
  const topRouting = result.routingMap.get("__top__");
  return JSON.stringify({
    layers: topLayout.layers,
    positions: [...topLayout.nodePositions.entries()],
    routes: topRouting.routedEdges.map((edge, index) => [
      edge.key,
      routePoints(topRouting, index),
    ]),
    crossings: topRouting.crossings,
  });
}

const first = build();
const second = build();
assert.equal(
  comparable(first),
  comparable(second),
  "layout is not reproducible",
);

const pointSharingTracks = new TrackAllocator();
assert.equal(pointSharingTracks.reserve(10, 20, 3), 0);
assert.equal(
  pointSharingTracks.reserve(15, 15, 3),
  0,
  "zero-length track occupancy must not block positive-length geometry",
);
const leastOverlapTracks = new TrackAllocator();
assert.equal(leastOverlapTracks.reserve(0, 10, 3), 0);
assert.equal(
  leastOverlapTracks.reserve(0, 5, 3),
  1,
  "allocator must prefer a zero-overlap lane over first-fit reuse",
);
assert.equal(
  leastOverlapTracks.reserve(4, 6, 3),
  2,
  "allocator must minimize overlap across all materialized lanes",
);
const sparseTracks = new TrackAllocator();
assert.equal(
  sparseTracks.reserve(0, 10, 4, (lane) =>
    lane === 2 ? 0 : Number.POSITIVE_INFINITY,
  ),
  2,
);
assert.equal(
  sparseTracks.reserve(0, 10, 4, (lane) =>
    lane === 3 ? 0 : Number.POSITIVE_INFINITY,
  ),
  3,
  "allocator must search all unmaterialized lanes within capacity",
);

assert.equal(first.model.indexed.edgeSourceIndices.length, 8);

const topLayout = first.layoutMap.get("__top__");
const topRouting = first.routingMap.get("__top__");
assert.ok(topLayout);
assert.ok(topRouting);
assert.equal(topRouting.routedEdges.length, 8);
assert.equal(new Set(topRouting.routedEdges.map((edge) => edge.key)).size, 8);
assert.equal(topRouting.routeOffsets.at(-1), topRouting.routePoints.length / 2);

for (
  let routeIndex = 0;
  routeIndex < topRouting.routedEdges.length;
  routeIndex += 1
) {
  const points = routePoints(topRouting, routeIndex);
  assertOrthogonal(points);
  assertNoNodeIntersection(points, topLayout.nodePositions);
}
assertNoUnintendedOverlap(topRouting);
assertCrossingMarkers(topRouting);

assert.deepEqual(
  new Set(
    topLayout.nodeTileIndex.query(
      0,
      0,
      topLayout.gridWidth,
      topLayout.gridHeight,
      1,
    ),
  ),
  new Set([...topLayout.nodePositions].map(([nodeId]) => nodeId)),
  "tile index changed exact candidate membership",
);

assert.throws(
  () => buildGraphModel({ ...graphData, nodes: [1] }),
  /groups of three/,
);
assert.throws(
  () => buildGraphModel({ ...graphData, edges: [1, 0, 99, 0] }),
  /not present/,
);
assert.throws(
  () => buildGraphModel({ ...graphData, edges: [2, 0, 1, 0] }),
  /lower to higher/,
);
assert.throws(
  () => buildGraphModel({ ...graphData, nodes: [1.5, 1, 5] }),
  /safe integer/,
);
assert.deepEqual(
  Array.from(
    buildGraphModel({
      ...graphData,
      nodes: [...graphData.nodes.slice(3), ...graphData.nodes.slice(0, 3)],
    }).indexed.nodeIds,
  ),
  [1, 2, 3, 4, 5, 6],
);
assert.throws(
  () =>
    buildGraphModel({
      ...graphData,
      nodes: [...graphData.nodes, ...graphData.nodes.slice(0, 3)],
    }),
  /unique/,
);

const snapshot = serializeLayoutSnapshot(first.layoutMap, first.routingMap);
const restored = deserializeLayoutSnapshot(snapshot);
assert.equal(
  JSON.stringify(snapshot),
  JSON.stringify(
    serializeLayoutSnapshot(restored.layoutMap, restored.routingMap),
  ),
  "layout snapshot is not stable after round-trip",
);

exactCrossingFixture();
crossingMarkerFixture();
assertFormerHardOverlapCounterexample();
assertArbitraryPortCorpus();
assertExampleGraphs();

console.log("Layout verification passed.");
