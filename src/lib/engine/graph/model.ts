import type {
  GraphData,
  GraphModel,
  RawSubgraph,
  RawNode,
  Node,
  Edge,
  Scope,
} from "./types.ts";
import { TOP_LEVEL_SCOPE_ID, subgraphScopeId } from "../../diagram/geometry.ts";
import {
  appendToList,
  createScope,
  findNodeScope,
  EMPTY_SUBGRAPHS,
} from "./scopes.ts";
import { buildIndexedGraph, IndexedNodeLookup } from "./indexed.ts";
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
    const ownerId = packed[packedOffset];
    const entryId = packed[packedOffset + 1];
    const exitId = packed[packedOffset + 2];
    if (entryId >= exitId || (entryId <= ownerId && ownerId <= exitId)) {
      throw new Error(
        "Subgraph IDs violate the documented boundary invariant.",
      );
    }
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

function unpackEdges(packed: number[]): Edge[] {
  if (packed.length % 4 !== 0) {
    throw new Error("The edges array must contain groups of four numbers.");
  }
  const edges: Edge[] = [];
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
    if (packed[packedOffset] >= packed[packedOffset + 2]) {
      throw new Error("Edges must point from lower to higher topological IDs.");
    }
    edges.push({
      edgeIndex: packedOffset / 4,
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

function validateSubgraphReferences(
  subgraphs: readonly RawSubgraph[],
  nodeMap: Map<number, Node>,
): void {
  for (const subgraph of subgraphs) {
    if (
      !nodeMap.has(subgraph.nodeId) ||
      !nodeMap.has(subgraph.inId) ||
      !nodeMap.has(subgraph.outId)
    ) {
      throw new Error("Every subgraph ID must be present in nodes.");
    }
  }
}

function groupSubgraphsByNode(
  subgraphs: readonly RawSubgraph[],
  boundaryIds: ReadonlySet<number>,
): Map<number, RawSubgraph[]> {
  const subgraphsByNode = new Map<number, RawSubgraph[]>();
  for (const subgraph of subgraphs) {
    if (boundaryIds.has(subgraph.nodeId)) {
      throw new Error(
        `Entry or exit node ${subgraph.nodeId} cannot own a subgraph.`,
      );
    }
    appendToList(subgraphsByNode, subgraph.nodeId, subgraph);
  }
  return subgraphsByNode;
}

function createScopeMap(
  subgraphsByNode: Map<number, RawSubgraph[]>,
): Map<string, Scope> {
  const scopeMap = new Map<string, Scope>();
  scopeMap.set(
    TOP_LEVEL_SCOPE_ID,
    createScope(TOP_LEVEL_SCOPE_ID, {
      inId: null,
      outId: null,
      parentNodeId: null,
    }),
  );

  for (const [parentNodeId, nodeSubgraphs] of subgraphsByNode) {
    for (const subgraph of nodeSubgraphs) {
      const scopeId = subgraphScopeId(subgraph.inId, subgraph.outId);
      if (scopeMap.has(scopeId)) {
        throw new Error(
          `Duplicate subgraph boundary pair ${subgraph.inId}:${subgraph.outId}.`,
        );
      }
      scopeMap.set(
        scopeId,
        createScope(scopeId, {
          inId: subgraph.inId,
          outId: subgraph.outId,
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
    const scopeId = boundaryIds.has(rawNode.id)
      ? null
      : findNodeScope(rawNode.id, subgraphScopes);
    const ownedSubgraphs = subgraphsByNode.get(rawNode.id);
    const node: Node = Object.assign(rawNode, {
      inputPortCount: 0,
      outputPortCount: 0,
      scopeId,
      subgraphs: ownedSubgraphs
        ? ownedSubgraphs.map(({ inId, outId }) => ({ inId, outId }))
        : EMPTY_SUBGRAPHS,
    });
    nodeMap.set(rawNode.id, node);
    if (scopeId !== null) {
      scopeMap.get(scopeId)!.nodeIds.push(rawNode.id);
    }
  }
  return nodeMap;
}

function validateScopeHierarchy(
  scopeMap: Map<string, Scope>,
  nodeMap: Map<number, Node>,
): void {
  if (scopeMap.size === 1) return;
  const pendingScopes = [scopeMap.get(TOP_LEVEL_SCOPE_ID)!];
  let reachableScopeCount = 0;
  while (pendingScopes.length > 0) {
    const scope = pendingScopes.pop()!;
    reachableScopeCount += 1;
    for (const nodeId of scope.nodeIds) {
      for (const subgraph of nodeMap.get(nodeId)!.subgraphs) {
        pendingScopes.push(
          scopeMap.get(subgraphScopeId(subgraph.inId, subgraph.outId))!,
        );
      }
    }
  }
  if (reachableScopeCount !== scopeMap.size) {
    throw new Error("Subgraph ownership contains a cycle.");
  }
}

function edgeScope(
  source: Node,
  target: Node,
  scopeMap: Map<string, Scope>,
): Scope | undefined {
  if (source.scopeId !== null) {
    const scope = scopeMap.get(source.scopeId)!;
    if (target.scopeId === null) {
      return target.id === scope.outId ? scope : undefined;
    }
    return target.scopeId === source.scopeId ? scope : undefined;
  }
  if (target.scopeId !== null) {
    const scope = scopeMap.get(target.scopeId)!;
    return source.id === scope.inId ? scope : undefined;
  }
  return scopeMap.get(subgraphScopeId(source.id, target.id));
}

function assignEdges(
  edges: readonly Edge[],
  nodeMap: Map<number, Node>,
  scopeMap: Map<string, Scope>,
): void {
  for (const edge of edges) {
    const source = nodeMap.get(edge.sourceId);
    const target = nodeMap.get(edge.targetId);
    if (!source || !target) {
      throw new Error("Edge references a node that is not present in nodes.");
    }
    const scope = edgeScope(source, target, scopeMap);
    if (!scope) {
      throw new Error(
        `Edge ${edge.sourceId} -> ${edge.targetId} (index ${edge.edgeIndex}) must connect output and input ports within one region.`,
      );
    }
    scope.edges.push(edge);
    source.outputPortCount = Math.max(
      source.outputPortCount,
      edge.sourcePort + 1,
    );
    target.inputPortCount = Math.max(
      target.inputPortCount,
      edge.targetPort + 1,
    );
  }
}

export function buildGraphModel(data: GraphData): GraphModel {
  validateGraphDataArrays(data);

  validateStringTable(data.strings);
  const rawSubgraphs = unpackSubgraphs(data.subgraphs);
  const rawNodes = unpackNodes(data.nodes, data.strings);
  const rawEdges = unpackEdges(data.edges);
  rawNodes.sort((leftNode, rightNode) => leftNode.id - rightNode.id);
  validateUniqueNodeIds(rawNodes);

  const boundaryIds = collectBoundaryIds(rawSubgraphs);
  const subgraphsByNode = groupSubgraphsByNode(rawSubgraphs, boundaryIds);
  const scopeMap = createScopeMap(subgraphsByNode);
  const subgraphScopes = getNestedScopes(scopeMap);
  const nodeMap = createNodeMap(
    rawNodes,
    subgraphsByNode,
    subgraphScopes,
    boundaryIds,
    scopeMap,
  );
  validateSubgraphReferences(rawSubgraphs, nodeMap);
  validateScopeHierarchy(scopeMap, nodeMap);
  assignEdges(rawEdges, nodeMap, scopeMap);

  const indexed = buildIndexedGraph(rawEdges.length, nodeMap);

  return {
    nodeMap: new IndexedNodeLookup(indexed),
    scopeMap,
    indexed,
  };
}
