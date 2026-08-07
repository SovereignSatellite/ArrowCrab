import type {
  GraphData,
  GraphModel,
  RawSubgraph,
  RawNode,
  RawEdge,
  Node,
  Edge,
  Scope,
} from "./types";
import {
  TOP_LEVEL_SCOPE_ID,
  appendToList,
  computePortCounts,
  createScope,
  findInnermostScope,
  scopeIdFor,
} from "./scopes";
import { buildIndexedGraph, createNodeLookup } from "./indexed";
function requireSafeInteger(value: number, description: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${description} must be a safe integer.`);
  }
}

function requirePortIndex(value: number, description: string): void {
  requireSafeInteger(value, description);
  if (value < 0 || value >= 4_294_967_295) {
    throw new Error(`${description} must be a non-negative 32-bit port index.`);
  }
}

function unpackSubgraphs(packed: number[]): RawSubgraph[] {
  if (packed.length % 3 !== 0) {
    throw new Error(
      "The subgraphs array must contain groups of three numbers.",
    );
  }
  const subgraphs: RawSubgraph[] = [];
  for (let packedOffset = 0; packedOffset < packed.length; packedOffset += 3) {
    requireSafeInteger(
      packed[packedOffset],
      `Subgraph node ID at packed offset ${packedOffset}`,
    );
    requireSafeInteger(
      packed[packedOffset + 1],
      `Subgraph entry ID at packed offset ${packedOffset + 1}`,
    );
    requireSafeInteger(
      packed[packedOffset + 2],
      `Subgraph exit ID at packed offset ${packedOffset + 2}`,
    );
    subgraphs.push({
      nodeId: packed[packedOffset],
      inId: packed[packedOffset + 1],
      outId: packed[packedOffset + 2],
    });
  }
  return subgraphs;
}

function unpackNodes(packed: number[], strings: string[]): RawNode[] {
  if (packed.length % 3 !== 0) {
    throw new Error("The nodes array must contain groups of three numbers.");
  }
  const nodes: RawNode[] = [];
  for (let packedOffset = 0; packedOffset < packed.length; packedOffset += 3) {
    requireSafeInteger(
      packed[packedOffset],
      `Node ID at packed offset ${packedOffset}`,
    );
    const labelIndex = packed[packedOffset + 1];
    const colorIndex = packed[packedOffset + 2];
    if (
      !Number.isInteger(labelIndex) ||
      labelIndex < 0 ||
      labelIndex >= strings.length ||
      !Number.isInteger(colorIndex) ||
      colorIndex < 0 ||
      colorIndex >= strings.length
    ) {
      throw new Error(
        `Node at packed offset ${packedOffset} references an invalid string.`,
      );
    }
    nodes.push({
      id: packed[packedOffset],
      label: strings[labelIndex],
      color: strings[colorIndex],
    });
  }
  return nodes;
}

function unpackEdges(packed: number[]): RawEdge[] {
  if (packed.length % 4 !== 0) {
    throw new Error("The edges array must contain groups of four numbers.");
  }
  const edges: RawEdge[] = [];
  for (let packedOffset = 0; packedOffset < packed.length; packedOffset += 4) {
    requireSafeInteger(
      packed[packedOffset],
      `Edge source ID at packed offset ${packedOffset}`,
    );
    requirePortIndex(
      packed[packedOffset + 1],
      `Edge source port at packed offset ${packedOffset + 1}`,
    );
    requireSafeInteger(
      packed[packedOffset + 2],
      `Edge target ID at packed offset ${packedOffset + 2}`,
    );
    requirePortIndex(
      packed[packedOffset + 3],
      `Edge target port at packed offset ${packedOffset + 3}`,
    );
    edges.push({
      sourceId: packed[packedOffset],
      sourcePort: packed[packedOffset + 1],
      targetId: packed[packedOffset + 2],
      targetPort: packed[packedOffset + 3],
    });
  }
  return edges;
}

function validateGraphDataArrays(data: GraphData): void {
  if (!data || !Array.isArray(data.strings)) {
    throw new Error("Graph data must contain a strings array.");
  }
  if (
    !Array.isArray(data.subgraphs) ||
    !Array.isArray(data.nodes) ||
    !Array.isArray(data.edges)
  ) {
    throw new Error(
      "Graph data must contain subgraphs, nodes, and edges arrays.",
    );
  }
}

function validateStringTable(strings: string[]): void {
  for (let stringIndex = 0; stringIndex < strings.length; stringIndex += 1) {
    if (typeof strings[stringIndex] !== "string") {
      throw new Error(`String table entry ${stringIndex} must be a string.`);
    }
  }
}

function validateUniqueNodeIds(nodes: readonly RawNode[]): void {
  for (let nodeIndex = 1; nodeIndex < nodes.length; nodeIndex += 1) {
    if (nodes[nodeIndex - 1].id === nodes[nodeIndex].id) {
      throw new Error("Node IDs must be unique.");
    }
  }
}

function validateGraphReferences(
  subgraphs: readonly RawSubgraph[],
  nodes: readonly RawNode[],
  edges: readonly RawEdge[],
): void {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const scopeKeys = new Set<string>();
  for (const subgraph of subgraphs) {
    if (
      !nodeIds.has(subgraph.nodeId) ||
      !nodeIds.has(subgraph.inId) ||
      !nodeIds.has(subgraph.outId)
    ) {
      throw new Error("Every subgraph ID must be present in nodes.");
    }
    if (
      subgraph.inId >= subgraph.outId ||
      subgraph.nodeId === subgraph.inId ||
      subgraph.nodeId === subgraph.outId ||
      (subgraph.inId < subgraph.nodeId && subgraph.nodeId < subgraph.outId)
    ) {
      throw new Error(
        "Subgraph IDs violate the documented boundary invariant.",
      );
    }
    const scopeKey = `${subgraph.inId}:${subgraph.outId}`;
    if (scopeKeys.has(scopeKey)) {
      throw new Error(`Duplicate subgraph boundary pair ${scopeKey}.`);
    }
    scopeKeys.add(scopeKey);
  }
  for (const edge of edges) {
    if (!nodeIds.has(edge.sourceId) || !nodeIds.has(edge.targetId)) {
      throw new Error("Edge references a node that is not present in nodes.");
    }
    if (edge.sourceId >= edge.targetId) {
      throw new Error("Edges must point from lower to higher topological IDs.");
    }
  }
}

function groupSubgraphsByNode(
  subgraphs: readonly RawSubgraph[],
): Map<number, RawSubgraph[]> {
  const subgraphsByNode = new Map<number, RawSubgraph[]>();
  for (const subgraph of subgraphs) {
    appendToList(subgraphsByNode, subgraph.nodeId, subgraph);
  }
  return subgraphsByNode;
}

function createScopeMap(
  subgraphsByNode: Map<number, RawSubgraph[]>,
): Map<string, Scope> {
  const scopeMap = new Map<string, Scope>();
  scopeMap.set(TOP_LEVEL_SCOPE_ID, createScope(TOP_LEVEL_SCOPE_ID));

  for (const [parentNodeId, nodeSubgraphs] of subgraphsByNode) {
    for (
      let subgraphIndex = 0;
      subgraphIndex < nodeSubgraphs.length;
      subgraphIndex += 1
    ) {
      const subgraph = nodeSubgraphs[subgraphIndex];
      const scopeId = scopeIdFor(subgraph);
      scopeMap.set(
        scopeId,
        createScope(scopeId, {
          inId: subgraph.inId,
          outId: subgraph.outId,
          label: nodeSubgraphs.length > 1 ? String(subgraphIndex) : null,
          parentNodeId,
        }),
      );
    }
  }
  return scopeMap;
}

function getNestedScopes(scopeMap: Map<string, Scope>): Scope[] {
  return [...scopeMap.values()]
    .filter((scope) => scope.scopeId !== TOP_LEVEL_SCOPE_ID)
    .sort((leftScope, rightScope) => leftScope.inId! - rightScope.inId!);
}

function collectBoundaryIds(subgraphs: readonly RawSubgraph[]): Set<number> {
  const boundaryIds = new Set<number>();
  for (const subgraph of subgraphs) {
    boundaryIds.add(subgraph.inId);
    boundaryIds.add(subgraph.outId);
  }
  return boundaryIds;
}

function createNodeMap(
  nodes: readonly RawNode[],
  subgraphsByNode: Map<number, RawSubgraph[]>,
  subgraphScopes: readonly Scope[],
  boundaryIds: Set<number>,
  scopeMap: Map<string, Scope>,
): Map<number, Node> {
  const nodeMap = new Map<number, Node>();
  for (const rawNode of nodes) {
    const scopeId =
      findInnermostScope(rawNode.id, rawNode.id, subgraphScopes) ??
      TOP_LEVEL_SCOPE_ID;
    const node: Node = {
      id: rawNode.id,
      label: rawNode.label,
      color: rawNode.color,
      inputPortCount: 0,
      outputPortCount: 0,
      scopeId,
      subgraphs: (subgraphsByNode.get(rawNode.id) ?? []).map((subgraph) => ({
        inId: subgraph.inId,
        outId: subgraph.outId,
      })),
    };
    nodeMap.set(rawNode.id, node);
    if (!boundaryIds.has(rawNode.id)) {
      scopeMap.get(scopeId)!.nodeIds.push(rawNode.id);
    }
  }
  return nodeMap;
}

function resolveEdges(
  rawEdges: readonly RawEdge[],
  subgraphScopes: readonly Scope[],
  scopeMap: Map<string, Scope>,
): Edge[] {
  const resolvedEdges: Edge[] = [];
  for (let edgeIndex = 0; edgeIndex < rawEdges.length; edgeIndex += 1) {
    const rawEdge = rawEdges[edgeIndex];
    const edge: Edge = { ...rawEdge, edgeIndex };
    const scopeId =
      findInnermostScope(edge.sourceId, edge.targetId, subgraphScopes) ??
      TOP_LEVEL_SCOPE_ID;
    scopeMap.get(scopeId)!.edges.push(edge);
    resolvedEdges.push(edge);
  }
  return resolvedEdges;
}

// Scope assignment uses the innermost boundary interval containing one endpoint
// strictly and the other strictly or on a boundary. Node assignment excludes
// entry, exit, and parent nodes because their IDs are not inside the interval.
export function buildGraphModel(data: GraphData): GraphModel {
  validateGraphDataArrays(data);

  const rawSubgraphs = unpackSubgraphs(data.subgraphs);
  const rawNodes = unpackNodes(data.nodes, data.strings);
  const rawEdges = unpackEdges(data.edges);
  validateStringTable(data.strings);
  rawNodes.sort((leftNode, rightNode) => leftNode.id - rightNode.id);
  validateUniqueNodeIds(rawNodes);
  validateGraphReferences(rawSubgraphs, rawNodes, rawEdges);

  const subgraphsByNode = groupSubgraphsByNode(rawSubgraphs);
  const scopeMap = createScopeMap(subgraphsByNode);
  const subgraphScopes = getNestedScopes(scopeMap);
  const boundaryIds = collectBoundaryIds(rawSubgraphs);
  const nodeMap = createNodeMap(
    rawNodes,
    subgraphsByNode,
    subgraphScopes,
    boundaryIds,
    scopeMap,
  );
  const resolvedEdges = resolveEdges(rawEdges, subgraphScopes, scopeMap);

  computePortCounts(scopeMap, nodeMap);

  const indexed = buildIndexedGraph(rawNodes, resolvedEdges, nodeMap);

  return {
    nodeMap: createNodeLookup(indexed),
    scopeMap,
    indexed,
  };
}
