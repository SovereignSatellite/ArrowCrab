import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

const { buildGraphModel } = await import("../src/lib/graph/index.ts");
const { computeAllLayouts } = await import("../src/lib/layout/index.ts");
const { computeAllRouting } = await import("../src/lib/routing/index.ts");

function option(name, fallback) {
  const prefix = `--${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument ? Number(argument.slice(prefix.length)) : fallback;
}

const nodeCount = option("nodes", 10_000);
const fanout = option("fanout", 1);
if (!Number.isInteger(nodeCount) || nodeCount < 1) {
  throw new Error("--nodes must be a positive integer");
}
if (!Number.isInteger(fanout) || fanout < 1 || fanout > 8) {
  throw new Error("--fanout must be an integer from 1 through 8");
}

function createChainGraph() {
  const nodes = new Array(nodeCount * 3);
  for (let index = 0; index < nodeCount; index += 1) {
    const offset = index * 3;
    nodes[offset] = index + 1;
    nodes[offset + 1] = 1;
    nodes[offset + 2] = 2;
  }
  const edges = [];
  for (let source = 1; source <= nodeCount; source += 1) {
    for (let delta = 1; delta <= fanout; delta += 1) {
      const target = source + delta;
      if (target > nodeCount) break;
      edges.push(source, delta - 1, target, delta - 1);
    }
  }
  return { strings: ["", "node", "#6aa0ff"], subgraphs: [], nodes, edges };
}

function elapsed(start) {
  return Number((performance.now() - start).toFixed(3));
}

function memoryMiB() {
  const usage = process.memoryUsage();
  return {
    rss: Number((usage.rss / 1024 / 1024).toFixed(2)),
    heapUsed: Number((usage.heapUsed / 1024 / 1024).toFixed(2)),
  };
}

const graphDataStart = performance.now();
const graphData = createChainGraph();
const graphDataMs = elapsed(graphDataStart);

const modelStart = performance.now();
const model = buildGraphModel(graphData);
const modelMs = elapsed(modelStart);
const afterModel = memoryMiB();

const expandedNodes = new Set();
const layoutStart = performance.now();
const layoutMap = computeAllLayouts(model, expandedNodes);
const layoutMs = elapsed(layoutStart);
const afterLayout = memoryMiB();

const routingStart = performance.now();
const routingMap = computeAllRouting(model, layoutMap, expandedNodes);
const routingMs = elapsed(routingStart);
const afterRouting = memoryMiB();

const topLayout = layoutMap.get("__top__");
const topRouting = routingMap.get("__top__");
const reproducibilitySample = JSON.stringify({
  firstPositions: [...topLayout.nodePositions.entries()].slice(0, 8),
  lastPositions: [...topLayout.nodePositions.entries()].slice(-8),
  firstRoutes: topRouting.routedEdges.slice(0, 8).map((edge, index) => [
    edge.key,
    Array.from(
      {
        length:
          topRouting.routeOffsets[index + 1] - topRouting.routeOffsets[index],
      },
      (_, pointIndex) => [
        topRouting.routePoints[
          (topRouting.routeOffsets[index] + pointIndex) * 2
        ],
        topRouting.routePoints[
          (topRouting.routeOffsets[index] + pointIndex) * 2 + 1
        ],
      ],
    ),
  ]),
});

const result = {
  nodeCount,
  edgeCount: graphData.edges.length / 4,
  fanout,
  milliseconds: {
    graphData: graphDataMs,
    model: modelMs,
    layout: layoutMs,
    routing: routingMs,
  },
  memoryMiB: {
    afterModel,
    afterLayout,
    afterRouting,
  },
  topLevel: {
    gridWidth: topLayout.gridWidth,
    gridHeight: topLayout.gridHeight,
    routes: topRouting.routedEdges.length,
    crossings: topRouting.crossings.length,
    packedRoutePoints: topRouting.routePoints.length / 2,
  },
  sampleHash: createHash("sha256").update(reproducibilitySample).digest("hex"),
};

console.log(JSON.stringify(result, null, 2));
