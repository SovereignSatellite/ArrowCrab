import type {
  GraphData,
  GraphModel,
  RawSubgraph,
  RawNode,
  RawEdge,
  Node,
  Edge,
  Scope,
} from "./graph-types";

const TOP_LEVEL_SCOPE_ID = "__top__";

function scopeIdFor(subgraph: RawSubgraph): string {
  return `subgraph_${subgraph.inId}_${subgraph.outId}`;
}

function unpackSubgraphs(packed: number[]): RawSubgraph[] {
  const subgraphs: RawSubgraph[] = [];
  for (let i = 0; i < packed.length; i += 3) {
    subgraphs.push({
      nodeId: packed[i],
      inId: packed[i + 1],
      outId: packed[i + 2],
    });
  }
  return subgraphs;
}

function unpackNodes(packed: number[], strings: string[]): RawNode[] {
  const nodes: RawNode[] = [];
  for (let i = 0; i < packed.length; i += 3) {
    nodes.push({
      id: packed[i],
      label: strings[packed[i + 1]],
      color: strings[packed[i + 2]],
    });
  }
  return nodes;
}

function unpackEdges(packed: number[]): RawEdge[] {
  const edges: RawEdge[] = [];
  for (let i = 0; i < packed.length; i += 4) {
    edges.push({
      sourceId: packed[i],
      sourcePort: packed[i + 1],
      targetId: packed[i + 2],
      targetPort: packed[i + 3],
    });
  }
  return edges;
}

// A node or edge belongs to the innermost subgraph scope whose (inId, outId)
// range strictly contains at least one endpoint, with the other endpoint either
// strictly inside or on the boundary.  For node assignment (idA === idB),
// boundary IDs are excluded so the parent node stays in its enclosing scope.
//
// Scopes are sorted by inId. We use binary search to find the last scope with
// inId < minId, then scan backward through candidates. This reduces O(N*S) to
// O(N*log S) during model building.
function findInnermostScope(
  idA: number,
  idB: number,
  scopes: Scope[],
): string | null {
  const minId = Math.min(idA, idB);

  // Binary search: find the rightmost scope with inId <= minId.
  // We use <= because an edge endpoint can sit ON a boundary (inId or outId),
  // so we must include scopes where inId == minId.
  let low = 0;
  let high = scopes.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (scopes[mid].inId! <= minId) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  let bestId: string | null = null;
  let bestRange = Infinity;

  for (let i = low - 1; i >= 0; i -= 1) {
    const scope = scopes[i];
    // Early exit: if scope range is already wider than best, and all remaining
    // scopes have even smaller inId (thus wider or equal range), stop.
    const range = scope.outId! - scope.inId!;
    if (bestId !== null && range >= bestRange) {
      continue;
    }

    const aInside = scope.inId! < idA && idA < scope.outId!;
    const bInside = scope.inId! < idB && idB < scope.outId!;
    const aOnBoundary = idA === scope.inId || idA === scope.outId;
    const bOnBoundary = idB === scope.inId || idB === scope.outId;

    const belongs =
      (aInside && (bInside || bOnBoundary)) || (bInside && aOnBoundary);
    if (!belongs) {
      continue;
    }

    if (range < bestRange) {
      bestRange = range;
      bestId = scope.scopeId;
    }
  }
  return bestId;
}

function appendToList<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  let list = map.get(key);
  if (!list) {
    list = [];
    map.set(key, list);
  }
  list.push(value);
}

// Subgraph boundary IDs that don't coincide with the parent nodeId are virtual
// markers.  Edges in the parent scope referencing a virtual ID actually target
// the parent node.  Edges *inside* the subgraph scope keep the boundary ID.
function rewriteBoundaryReferences(
  scopeMap: Map<string, Scope>,
  boundaryToParent: Map<number, number>,
): void {
  for (const scope of scopeMap.values()) {
    for (let i = 0; i < scope.edges.length; i += 1) {
      const edge = scope.edges[i];
      const sourceIsOwnBoundary =
        edge.sourceId === scope.inId || edge.sourceId === scope.outId;
      const targetIsOwnBoundary =
        edge.targetId === scope.inId || edge.targetId === scope.outId;

      let rewrittenSource: number;
      if (!sourceIsOwnBoundary && boundaryToParent.has(edge.sourceId)) {
        rewrittenSource = boundaryToParent.get(edge.sourceId)!;
      } else {
        rewrittenSource = edge.sourceId;
      }

      let rewrittenTarget: number;
      if (!targetIsOwnBoundary && boundaryToParent.has(edge.targetId)) {
        rewrittenTarget = boundaryToParent.get(edge.targetId)!;
      } else {
        rewrittenTarget = edge.targetId;
      }

      if (
        rewrittenSource !== edge.sourceId ||
        rewrittenTarget !== edge.targetId
      ) {
        scope.edges[i] = {
          sourceId: rewrittenSource,
          sourcePort: edge.sourcePort,
          targetId: rewrittenTarget,
          targetPort: edge.targetPort,
        };
      }
    }
  }
}

function computePortCounts(
  scopeMap: Map<string, Scope>,
  nodeMap: Map<number, Node>,
): void {
  for (const scope of scopeMap.values()) {
    for (const edge of scope.edges) {
      if (scope.inId !== null && edge.sourceId === scope.inId) {
        scope.portCountIn = Math.max(scope.portCountIn, edge.sourcePort + 1);
      } else {
        const node = nodeMap.get(edge.sourceId);
        if (node) {
          node.portCountOut = Math.max(node.portCountOut, edge.sourcePort + 1);
        }
      }

      if (scope.outId !== null && edge.targetId === scope.outId) {
        scope.portCountOut = Math.max(scope.portCountOut, edge.targetPort + 1);
      } else {
        const node = nodeMap.get(edge.targetId);
        if (node) {
          node.portCountIn = Math.max(node.portCountIn, edge.targetPort + 1);
        }
      }
    }
  }
}

function buildAdjacency(edges: Edge[]): {
  predecessors: Map<number, number[]>;
  successors: Map<number, number[]>;
} {
  const predecessors = new Map<number, number[]>();
  const successors = new Map<number, number[]>();
  for (const { sourceId, targetId } of edges) {
    appendToList(successors, sourceId, targetId);
    appendToList(predecessors, targetId, sourceId);
  }
  return { predecessors, successors };
}

function createScope(
  scopeId: string,
  options: Partial<
    Pick<Scope, "inId" | "outId" | "label" | "parentNodeId">
  > = {},
): Scope {
  return {
    scopeId,
    nodeIds: [],
    edges: [],
    predecessors: new Map(),
    successors: new Map(),
    inId: options.inId ?? null,
    outId: options.outId ?? null,
    portCountIn: 0,
    portCountOut: 0,
    label: options.label ?? null,
    parentNodeId: options.parentNodeId ?? null,
  };
}

/**
 * Deserialize flat-packed graph data into a fully resolved model with
 * scope assignments, boundary rewrites, port counts, and adjacency lists.
 */
export function buildGraphModel(data: GraphData): GraphModel {
  const rawSubgraphs = unpackSubgraphs(data.subgraphs);
  const rawNodes = unpackNodes(data.nodes, data.strings);
  const rawEdges = unpackEdges(data.edges);

  const subgraphsByNode = new Map<number, RawSubgraph[]>();
  for (const subgraph of rawSubgraphs) {
    appendToList(subgraphsByNode, subgraph.nodeId, subgraph);
  }

  const scopeMap = new Map<string, Scope>();
  scopeMap.set(TOP_LEVEL_SCOPE_ID, createScope(TOP_LEVEL_SCOPE_ID));

  for (const [nodeId, nodeSubgraphs] of subgraphsByNode) {
    for (let i = 0; i < nodeSubgraphs.length; i += 1) {
      const subgraph = nodeSubgraphs[i];
      // Only label subgraphs when a node has multiple, to distinguish them.
      let scopeLabel: string | null;
      if (nodeSubgraphs.length > 1) {
        scopeLabel = String(i);
      } else {
        scopeLabel = null;
      }
      scopeMap.set(
        scopeIdFor(subgraph),
        createScope(scopeIdFor(subgraph), {
          inId: subgraph.inId,
          outId: subgraph.outId,
          label: scopeLabel,
          parentNodeId: nodeId,
        }),
      );
    }
  }

  const subgraphScopes = [...scopeMap.values()]
    .filter((scope) => scope.scopeId !== TOP_LEVEL_SCOPE_ID)
    .sort((a, b) => a.inId! - b.inId!);

  const nodeMap = new Map<number, Node>();
  for (const raw of rawNodes) {
    const scopeId =
      findInnermostScope(raw.id, raw.id, subgraphScopes) ?? TOP_LEVEL_SCOPE_ID;

    const node: Node = {
      id: raw.id,
      label: raw.label,
      color: raw.color,
      portCountIn: 0,
      portCountOut: 0,
      scopeId,
      subgraphs: (subgraphsByNode.get(raw.id) ?? []).map((subgraph) => ({
        inId: subgraph.inId,
        outId: subgraph.outId,
      })),
    };
    nodeMap.set(raw.id, node);
    scopeMap.get(scopeId)!.nodeIds.push(raw.id);
  }

  for (const edge of rawEdges) {
    const scopeId =
      findInnermostScope(edge.sourceId, edge.targetId, subgraphScopes) ??
      TOP_LEVEL_SCOPE_ID;
    scopeMap.get(scopeId)!.edges.push(edge);
  }

  const boundaryToParent = new Map<number, number>();
  for (const [nodeId, nodeSubgraphs] of subgraphsByNode) {
    for (const subgraph of nodeSubgraphs) {
      if (subgraph.inId !== nodeId) {
        boundaryToParent.set(subgraph.inId, nodeId);
      }
      if (subgraph.outId !== nodeId) {
        boundaryToParent.set(subgraph.outId, nodeId);
      }
    }
  }

  rewriteBoundaryReferences(scopeMap, boundaryToParent);
  computePortCounts(scopeMap, nodeMap);

  for (const scope of scopeMap.values()) {
    const adjacency = buildAdjacency(scope.edges);
    scope.predecessors = adjacency.predecessors;
    scope.successors = adjacency.successors;
  }

  return { nodeMap, scopeMap };
}

export { TOP_LEVEL_SCOPE_ID };
