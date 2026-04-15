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
// strict containment excludes entry, exit, and parent nodes from their own
// subgraph scope — they all fall outside the (inId, outId) range.
//
// Scopes are sorted by inId. We use binary search to find the last scope with
// inId < minId, then scan backward through candidates. This reduces O(N*S) to
// O(N*log S) during model building.
function findInnermostScope(
  firstId: number,
  secondId: number,
  scopes: Scope[],
): string | null {
  const minId = Math.min(firstId, secondId);

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

    const isFirstInside = scope.inId! < firstId && firstId < scope.outId!;
    const isSecondInside = scope.inId! < secondId && secondId < scope.outId!;
    const isFirstOnBoundary = firstId === scope.inId || firstId === scope.outId;
    const isSecondOnBoundary =
      secondId === scope.inId || secondId === scope.outId;

    const isContained =
      (isFirstInside && (isSecondInside || isSecondOnBoundary)) ||
      (isSecondInside && isFirstOnBoundary);
    if (!isContained) {
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

function computePortCounts(
  scopeMap: Map<string, Scope>,
  nodeMap: Map<number, Node>,
): void {
  for (const scope of scopeMap.values()) {
    for (const edge of scope.edges) {
      const sourceNode = nodeMap.get(edge.sourceId);
      if (sourceNode) {
        sourceNode.portCountOut = Math.max(
          sourceNode.portCountOut,
          edge.sourcePort + 1,
        );
      }

      const targetNode = nodeMap.get(edge.targetId);
      if (targetNode) {
        targetNode.portCountIn = Math.max(
          targetNode.portCountIn,
          edge.targetPort + 1,
        );
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
    label: options.label ?? null,
    parentNodeId: options.parentNodeId ?? null,
  };
}

/**
 * Deserialize flat-packed graph data into a fully resolved model with
 * scope assignments, port counts, and adjacency lists.
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

  const boundaryIds = new Set<number>();
  for (const subgraph of rawSubgraphs) {
    boundaryIds.add(subgraph.inId);
    boundaryIds.add(subgraph.outId);
  }

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
    if (!boundaryIds.has(raw.id)) {
      scopeMap.get(scopeId)!.nodeIds.push(raw.id);
    }
  }

  for (const edge of rawEdges) {
    const scopeId =
      findInnermostScope(edge.sourceId, edge.targetId, subgraphScopes) ??
      TOP_LEVEL_SCOPE_ID;
    scopeMap.get(scopeId)!.edges.push(edge);
  }

  computePortCounts(scopeMap, nodeMap);

  for (const scope of scopeMap.values()) {
    const adjacency = buildAdjacency(scope.edges);
    scope.predecessors = adjacency.predecessors;
    scope.successors = adjacency.successors;
  }

  return { nodeMap, scopeMap };
}

export { TOP_LEVEL_SCOPE_ID };
