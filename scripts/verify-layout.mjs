import { createDiagram } from "../src/lib/engine/diagram.ts";
import { isNodeExpanded } from "../src/lib/diagram/types.ts";
import assert from "node:assert/strict";
import { buildGraphModel } from "../src/lib/engine/graph/index.ts";
import { computeAllLayouts } from "../src/lib/engine/layout/index.ts";
import { toggleNodeExpansion } from "../src/lib/engine/layout/scope.ts";
import { computeAllRouting } from "../src/lib/engine/routing/index.ts";
import {
  serializeLayoutSnapshot,
  deserializeLayoutSnapshot,
} from "../src/lib/diagram/index.ts";
import {
  GRID_UNIT,
  NODE_INNER_GAP,
  LABEL_BAR_HEIGHT,
} from "../src/lib/diagram/geometry.ts";

const TOP = "__top__";
const scopeId = (entry, exit) => `subgraph_${entry}_${exit}`;
const records = (array, width) =>
  Array.from({ length: array.length / width }, (_, index) =>
    array.slice(index * width, (index + 1) * width),
  );

function randomSource(seed) {
  let state = Math.imul(seed + 1, 2654435761) >>> 0;
  return (limit) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return Math.floor((state / 0x100000000) * limit);
  };
}

function shuffle(values, random) {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const other = random(index + 1);
    [values[index], values[other]] = [values[other], values[index]];
  }
  return values;
}

function inputOracle(data) {
  if (
    !data ||
    ![data.nodes, data.subgraphs, data.edges, data.strings].every(
      Array.isArray,
    ) ||
    data.strings.some((value) => typeof value !== "string") ||
    data.nodes.length % 3 ||
    data.subgraphs.length % 3 ||
    data.edges.length % 4
  )
    return null;
  const nodes = records(data.nodes, 3);
  const ids = nodes.map(([id]) => id);
  if (
    new Set(ids).size !== ids.length ||
    nodes.some(
      ([id, label, color]) =>
        !Number.isSafeInteger(id) ||
        ![label, color].every(
          (index) =>
            Number.isInteger(index) &&
            index >= 0 &&
            index < data.strings.length,
        ),
    )
  )
    return null;
  const idSet = new Set(ids);
  const scopes = records(data.subgraphs, 3).map(([owner, entry, exit]) => ({
    id: scopeId(entry, exit),
    owner,
    entry,
    exit,
    nodes: [],
    edges: [],
  }));
  const boundaries = new Set(
    scopes.flatMap(({ entry, exit }) => [entry, exit]),
  );
  if (
    new Set(scopes.map(({ id }) => id)).size !== scopes.length ||
    scopes.some(
      ({ owner, entry, exit }) =>
        ![owner, entry, exit].every(
          (id) => Number.isSafeInteger(id) && idSet.has(id),
        ) ||
        entry >= exit ||
        (entry <= owner && owner <= exit) ||
        boundaries.has(owner),
    )
  )
    return null;
  const regions = new Map([
    [
      TOP,
      { id: TOP, owner: null, entry: null, exit: null, nodes: [], edges: [] },
    ],
    ...scopes.map((scope) => [scope.id, scope]),
  ]);
  const membership = new Map();
  for (const id of ids) {
    if (boundaries.has(id)) {
      membership.set(id, null);
      continue;
    }
    const containing = scopes.filter(
      ({ entry, exit }) => entry < id && id < exit,
    );
    containing.sort((left, right) => {
      const difference =
        BigInt(left.exit) -
        BigInt(left.entry) -
        (BigInt(right.exit) - BigInt(right.entry));
      return difference < 0n
        ? -1
        : difference > 0n
          ? 1
          : right.entry - left.entry;
    });
    const region = containing.length ? containing[0].id : TOP;
    membership.set(id, region);
    regions.get(region).nodes.push(id);
  }
  for (const scope of scopes) {
    const ancestors = new Set();
    let current = scope.id;
    while (current !== TOP) {
      if (ancestors.has(current)) return null;
      ancestors.add(current);
      current = membership.get(regions.get(current).owner);
    }
  }
  const ports = new Map(ids.map((id) => [id, { input: 0, output: 0 }]));
  for (const [
    edgeIndex,
    [sourceId, sourcePort, targetId, targetPort],
  ] of records(data.edges, 4).entries()) {
    if (
      ![sourceId, targetId].every(
        (id) => Number.isSafeInteger(id) && idSet.has(id),
      ) ||
      sourceId >= targetId ||
      ![sourcePort, targetPort].every(
        (port) =>
          Number.isSafeInteger(port) && port >= 0 && port < 4_294_967_295,
      )
    )
      return null;
    const eligible = [...regions.values()].filter(
      (region) =>
        (boundaries.has(sourceId)
          ? region.entry === sourceId
          : membership.get(sourceId) === region.id) &&
        (boundaries.has(targetId)
          ? region.exit === targetId
          : membership.get(targetId) === region.id),
    );
    if (eligible.length !== 1) return null;
    eligible[0].edges.push({
      edgeIndex,
      sourceId,
      sourcePort,
      targetId,
      targetPort,
    });
    ports.get(sourceId).output = Math.max(
      ports.get(sourceId).output,
      sourcePort + 1,
    );
    ports.get(targetId).input = Math.max(
      ports.get(targetId).input,
      targetPort + 1,
    );
  }
  return { regions, membership, ports };
}

function checkDiagram(expected, diagram, expanded) {
  const regions = activeRegions(expected, expanded);
  assert.deepEqual(
    new Set(diagram.layoutMap.keys()),
    new Set(regions.map(({ id }) => id)),
  );
  assert.deepEqual(
    new Set(diagram.routingMap.keys()),
    new Set(regions.map(({ id }) => id)),
  );
  const visibleIds = new Set();
  for (const region of regions) {
    for (const nodeId of region.nodes) {
      visibleIds.add(nodeId);
      const node = diagram.nodeMap.get(nodeId);
      assert.equal(
        isNodeExpanded(diagram, node),
        node.subgraphs.length > 0 && expanded.has(nodeId),
      );
    }
    if (region.entry !== null) visibleIds.add(region.entry);
    if (region.exit !== null) visibleIds.add(region.exit);
  }
  assert.deepEqual(new Set(diagram.nodeMap.keys()), visibleIds);
  for (const [nodeId, node] of diagram.nodeMap) {
    assert.equal(node.id, nodeId);
    assert.equal(node.inputPortCount, expected.ports.get(nodeId).input);
    assert.equal(node.outputPortCount, expected.ports.get(nodeId).output);
  }
}

function generatedGraph(random, seed, bilayer) {
  const count = random(31);
  const ids = Array.from({ length: count }, (_, index) =>
    seed % 5 === 0
      ? -Number.MAX_SAFE_INTEGER + index
      : seed % 5 === 1
        ? Number.MAX_SAFE_INTEGER - count + index
        : index,
  );
  const subgraphs = [];
  const pairs = new Set();
  const boundaryIds = ids.filter((_, index) => index % 3 !== 0);
  const owners = ids.filter((_, index) => index % 3 === 0);
  const scopeCount = bilayer ? 0 : random(5);
  for (
    let index = 0;
    index < scopeCount && boundaryIds.length >= 2;
    index += 1
  ) {
    const choices = shuffle([...boundaryIds], random)
      .slice(0, 2)
      .sort((left, right) => left - right);
    const [entry, exit] = choices;
    const key = scopeId(entry, exit);
    if (pairs.has(key)) continue;
    pairs.add(key);
    const candidates = owners.filter((owner) => owner < entry || owner > exit);
    subgraphs.push(candidates[random(candidates.length)], entry, exit);
  }
  const data = {
    strings: ["node", "#6aa0ff"],
    nodes: shuffle(
      ids.map((id) => [id, 0, 1]),
      random,
    ).flat(),
    subgraphs: shuffle(records(subgraphs, 3), random).flat(),
    edges: [],
  };
  const expected = inputOracle(data);
  if (expected) {
    for (const region of expected.regions.values()) {
      const endpoints = [...region.nodes];
      if (region.entry !== null) endpoints.push(region.entry, region.exit);
      endpoints.sort((left, right) => left - right);
      const middle = Math.ceil(endpoints.length / 2);
      for (let source = 0; source < endpoints.length; source += 1) {
        for (let target = source + 1; target < endpoints.length; target += 1) {
          if (bilayer && (source >= middle || target < middle)) continue;
          if (random(100) >= 18) continue;
          const portLimit = random(10) === 0 ? 100 : 6;
          const edge = [
            endpoints[source],
            bilayer && random(4) === 0
              ? 4_294_967_294 - random(4)
              : random(portLimit),
            endpoints[target],
            bilayer && random(4) === 0
              ? 4_294_967_294 - random(4)
              : random(portLimit),
          ];
          data.edges.push(...edge);
          if (random(10) === 0) data.edges.push(...edge);
        }
      }
    }
    data.edges = shuffle(records(data.edges, 4), random).flat();
  }
  return data;
}

function mutateGraph(data, random, bilayer) {
  const mutated = structuredClone(data);
  const ids = records(data.nodes, 3)
    .map(([id]) => id)
    .sort((left, right) => left - right);
  switch (random(10)) {
    case 0:
      mutated.nodes.pop();
      break;
    case 1:
      mutated.nodes.push(...mutated.nodes.slice(0, 3));
      break;
    case 2:
      mutated.strings[random(mutated.strings.length)] = null;
      break;
    case 3:
      mutated.edges.push(ids[0], -1, ids.at(-1), 0);
      break;
    case 4:
      mutated.edges.push(ids.at(-1), 0, ids[0], 0);
      break;
    case 5:
      mutated.subgraphs.push(ids[0], ids[1], ids.at(-1) + 2);
      break;
    case 6:
      mutated.edges.push(ids[0], 4_294_967_295, ids.at(-1), 0);
      break;
    case 7:
      mutated.nodes[random(mutated.nodes.length / 3) * 3 + 1] =
        mutated.strings.length;
      break;
    case 8:
      if (mutated.subgraphs.length) {
        mutated.subgraphs[0] = mutated.subgraphs[mutated.subgraphs.length - 1];
      } else {
        mutated.subgraphs.push(ids[0], ids[0], ids.at(-1));
      }
      break;
    case 9: {
      let pair;
      if (bilayer && data.edges.length) {
        const offset = random(data.edges.length / 4) * 4;
        pair = [data.edges[offset], data.edges[offset + 2]];
      } else {
        pair = shuffle([...ids], random)
          .slice(0, 2)
          .sort((left, right) => left - right);
      }
      mutated.edges.push(pair[0], random(6), pair[1], random(6));
      break;
    }
  }
  return mutated;
}

function activeRegions(expected, expanded) {
  const active = [expected.regions.get(TOP)];
  for (let index = 0; index < active.length; index += 1) {
    for (const child of expected.regions.values()) {
      if (
        child.owner !== null &&
        active[index].nodes.includes(child.owner) &&
        expanded.has(child.owner)
      )
        active.push(child);
    }
  }
  return active;
}

function routePoints(routing, index) {
  return Array.from(
    { length: routing.routeOffsets[index + 1] - routing.routeOffsets[index] },
    (_, point) => ({
      x: routing.routePoints[(routing.routeOffsets[index] + point) * 2],
      y: routing.routePoints[(routing.routeOffsets[index] + point) * 2 + 1],
    }),
  );
}

function checkGeometry(expected, layouts, routing, expanded) {
  const active = activeRegions(expected, expanded);
  assert.deepEqual(
    new Set(routing.keys()),
    new Set(active.map(({ id }) => id)),
  );
  const origins = new Map([[TOP, { x: 0, y: 0 }]]);
  for (const region of active) {
    const layout = layouts.get(region.id);
    assert.ok(layout);
    assert.deepEqual(
      new Set([...layout.nodePositions].map(([id]) => id)),
      new Set(region.nodes),
    );
    const origin = origins.get(region.id);
    for (const [id, position] of layout.nodePositions) {
      assert.ok(Object.values(position).every(Number.isFinite));
      assert.ok(
        position.x >= 0 &&
          position.y >= 0 &&
          position.width > 0 &&
          position.height > 0 &&
          position.x + position.width <= layout.gridWidth &&
          position.y + position.height <= layout.gridHeight,
      );
      for (const otherId of region.nodes) {
        if (otherId >= id) continue;
        const other = layout.nodePositions.get(otherId);
        assert.ok(
          position.x >= other.x + other.width ||
            other.x >= position.x + position.width ||
            position.y >= other.y + other.height ||
            other.y >= position.y + position.height,
          "node interiors overlap",
        );
      }
      if (!expanded.has(id)) continue;
      let x = origin.x + (position.x + NODE_INNER_GAP) * GRID_UNIT;
      const y =
        origin.y + (position.y + LABEL_BAR_HEIGHT + NODE_INNER_GAP) * GRID_UNIT;
      for (const child of expected.regions.values()) {
        if (child.owner !== id) continue;
        const childLayout = layouts.get(child.id);
        assert.ok(
          x >= origin.x + position.x * GRID_UNIT &&
            y >= origin.y + position.y * GRID_UNIT &&
            x + childLayout.gridWidth * GRID_UNIT <=
              origin.x + (position.x + position.width) * GRID_UNIT &&
            y + childLayout.gridHeight * GRID_UNIT <=
              origin.y + (position.y + position.height) * GRID_UNIT,
          "child frame leaves its owner",
        );
        origins.set(child.id, { x, y });
        x += (childLayout.gridWidth + NODE_INNER_GAP) * GRID_UNIT;
      }
    }
    const routes = routing.get(region.id);
    assert.deepEqual(
      new Set(routes.routedEdges.map(({ edgeIndex }) => edgeIndex)),
      new Set(region.edges.map(({ edgeIndex }) => edgeIndex)),
    );
    assert.equal(routes.routedEdges.length, region.edges.length);
    const segments = [];
    for (const [index, edge] of routes.routedEdges.entries()) {
      assert.deepEqual(
        edge,
        region.edges.find(({ edgeIndex }) => edgeIndex === edge.edgeIndex),
      );
      const points = routePoints(routes, index);
      assert.ok(points.length >= 2);
      const [minX, minY, maxX, maxY] = routes.routeBounds.subarray(
        index * 4,
        index * 4 + 4,
      );
      assert.ok(
        [minX, minY, maxX, maxY].every(Number.isFinite) &&
          minX <= maxX &&
          minY <= maxY &&
          points.every(
            ({ x, y }) => minX <= x && x <= maxX && minY <= y && y <= maxY,
          ),
        "route culling bounds do not enclose its geometry",
      );
      const endpoint = (id, port, side) => {
        const source = side === "output";
        if (id === region.entry || id === region.exit)
          return {
            x:
              origin.x +
              (layout.gridWidth /
                (source
                  ? expected.ports.get(id).output
                  : expected.ports.get(id).input)) *
                (port + 0.5) *
                GRID_UNIT,
            y: origin.y + (source ? 0 : layout.gridHeight * GRID_UNIT),
          };
        const position = layout.nodePositions.get(id);
        return {
          x: origin.x + (position.x + (2 * port + 1)) * GRID_UNIT,
          y:
            origin.y +
            (position.y + (source ? position.height : 0)) * GRID_UNIT,
        };
      };
      assert.deepEqual(
        points[0],
        endpoint(edge.sourceId, edge.sourcePort, "output"),
      );
      assert.deepEqual(
        points.at(-1),
        endpoint(edge.targetId, edge.targetPort, "input"),
      );
      for (
        let pointIndex = 0;
        pointIndex < points.length - 1;
        pointIndex += 1
      ) {
        const first = points[pointIndex];
        const second = points[pointIndex + 1];
        assert.ok(
          [first.x, first.y, second.x, second.y].every(Number.isFinite),
        );
        assert.ok(
          first.x === second.x || first.y === second.y,
          "route is not orthogonal",
        );
        for (const [, position] of layout.nodePositions) {
          assert.ok(
            !(
              Math.max(first.x, second.x) > origin.x + position.x * GRID_UNIT &&
              Math.min(first.x, second.x) <
                origin.x + (position.x + position.width) * GRID_UNIT &&
              Math.max(first.y, second.y) > origin.y + position.y * GRID_UNIT &&
              Math.min(first.y, second.y) <
                origin.y + (position.y + position.height) * GRID_UNIT
            ),
            "route enters a node interior",
          );
        }
        if (first.x === second.x && first.y === second.y) continue;
        segments.push({
          edgeIndex: edge.edgeIndex,
          first,
          second,
          horizontal: first.y === second.y,
        });
      }
    }
    const crossings = new Set();
    for (let left = 0; left < segments.length; left += 1) {
      for (let right = left + 1; right < segments.length; right += 1) {
        const first = segments[left];
        const second = segments[right];
        if (first.edgeIndex === second.edgeIndex) continue;
        if (first.horizontal !== second.horizontal) {
          const horizontal = first.horizontal ? first : second;
          const vertical = first.horizontal ? second : first;
          if (
            vertical.first.x >
              Math.min(horizontal.first.x, horizontal.second.x) &&
            vertical.first.x <
              Math.max(horizontal.first.x, horizontal.second.x) &&
            horizontal.first.y >
              Math.min(vertical.first.y, vertical.second.y) &&
            horizontal.first.y < Math.max(vertical.first.y, vertical.second.y)
          )
            crossings.add(`${vertical.first.x}:${horizontal.first.y}`);
        }
      }
    }
    assert.deepEqual(
      new Set(routes.crossings.map(({ x, y }) => `${x}:${y}`)),
      crossings,
    );
  }
}

function geometrySignature(layouts, routing) {
  return JSON.stringify({
    layouts: [...layouts]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, layout]) => [
        id,
        layout.gridWidth,
        layout.gridHeight,
        [...layout.nodePositions],
      ]),
    routes: [...routing]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, routes]) => [
        id,
        routes.routedEdges.map((edge, index) => [
          edge,
          routePoints(routes, index),
        ]),
        routes.crossings,
      ]),
  });
}

function snapshotCullingBounds(routing) {
  return new Map(
    [...routing].map(([id, routes]) => [id, [...routes.routeBounds]]),
  );
}

let accepted = 0;
let rejected = 0;
let states = 0;
let maximumPort = 0;
for (let seed = 0; seed < 300; seed += 1) {
  const random = randomSource(seed);
  const bilayer = seed % 7 === 0;
  const data = generatedGraph(random, seed, bilayer);
  for (const candidate of [data, mutateGraph(data, random, bilayer)]) {
    try {
      const expected = inputOracle(candidate);
      if (!expected) {
        assert.throws(() => buildGraphModel(candidate));
        rejected += 1;
        continue;
      }
      for (const [, sourcePort, , targetPort] of records(candidate.edges, 4)) {
        maximumPort = Math.max(maximumPort, sourcePort, targetPort);
      }
      const before = JSON.stringify(candidate);
      const model = buildGraphModel(candidate);
      assert.equal(
        JSON.stringify(candidate),
        before,
        "loading mutated input records",
      );
      assert.deepEqual(
        new Set(model.scopeMap.keys()),
        new Set(expected.regions.keys()),
      );
      for (const [id, region] of expected.regions) {
        assert.deepEqual(
          new Set(model.scopeMap.get(id).nodeIds),
          new Set(region.nodes),
        );
        assert.deepEqual(model.scopeMap.get(id).edges, region.edges);
      }
      for (const [id, ports] of expected.ports) {
        const node = model.nodeMap.get(id);
        assert.equal(node.scopeId, expected.membership.get(id));
        assert.equal(node.inputPortCount, ports.input);
        assert.equal(node.outputPortCount, ports.output);
      }
      const owners = [
        ...new Set(
          [...expected.regions.values()]
            .filter(({ owner }) => owner !== null)
            .map(({ owner }) => owner),
        ),
      ];
      for (const initial of [[], owners]) {
        const expanded = new Set(initial);
        const layouts = computeAllLayouts(model, expanded);
        for (let step = 0; step < 3; step += 1) {
          const routing = computeAllRouting(model, layouts, expanded);
          checkGeometry(expected, layouts, routing, expanded);
          checkDiagram(
            expected,
            createDiagram(model, layouts, routing),
            expanded,
          );
          const signature = geometrySignature(layouts, routing);
          const freshLayouts = computeAllLayouts(model, expanded);
          const freshRouting = computeAllRouting(model, freshLayouts, expanded);
          checkGeometry(expected, freshLayouts, freshRouting, expanded);
          assert.equal(
            geometrySignature(
              new Map([...routing.keys()].map((id) => [id, layouts.get(id)])),
              routing,
            ),
            geometrySignature(freshLayouts, freshRouting),
            "fresh computation changed active geometry",
          );
          const cullingBounds = snapshotCullingBounds(routing);
          const snapshot = serializeLayoutSnapshot(layouts, routing);
          const transfer = snapshot.routing.flatMap((route) => [
            route.routeOffsets.buffer,
            route.routePoints.buffer,
            route.routeBounds.buffer,
          ]);
          const restored = deserializeLayoutSnapshot(
            structuredClone(snapshot, { transfer }),
          );
          assert.ok(transfer.every((buffer) => buffer.byteLength === 0));
          assert.deepEqual(
            snapshotCullingBounds(restored.routingMap),
            cullingBounds,
            "transport changed culling bounds",
          );
          assert.equal(
            geometrySignature(restored.layoutMap, restored.routingMap),
            signature,
            "transport changed scene geometry or identities",
          );
          checkGeometry(
            expected,
            restored.layoutMap,
            restored.routingMap,
            expanded,
          );
          checkDiagram(
            expected,
            createDiagram(model, restored.layoutMap, restored.routingMap),
            expanded,
          );
          const rerouted = computeAllRouting(
            model,
            restored.layoutMap,
            expanded,
          );
          checkGeometry(expected, restored.layoutMap, rerouted, expanded);
          assert.equal(
            geometrySignature(restored.layoutMap, rerouted),
            signature,
            "restored layouts changed rerouting",
          );
          states += 1;
          const visibleOwners = activeRegions(expected, expanded).flatMap(
            ({ nodes }) => nodes.filter((id) => owners.includes(id)),
          );
          if (!visibleOwners.length) break;
          toggleNodeExpansion(
            visibleOwners[random(visibleOwners.length)],
            model,
            expanded,
            layouts,
          );
        }
      }
      accepted += 1;
    } catch (error) {
      throw new Error(`Graph fuzz failed at seed ${seed}`, { cause: error });
    }
  }
}
console.log(
  `Graph fuzz passed (${accepted} accepted, ${rejected} rejected, ${states} scene states; maximum port ${maximumPort}).`,
);
