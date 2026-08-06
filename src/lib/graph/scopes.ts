import type { Node, RawSubgraph, Scope } from "./types";

export const TOP_LEVEL_SCOPE_ID = "__top__";
export const EMPTY_SUBGRAPHS: { inId: number; outId: number }[] = [];

export function scopeIdFor(subgraph: RawSubgraph): string {
  return `subgraph_${subgraph.inId}_${subgraph.outId}`;
}

export function subgraphScopeId(inId: number, outId: number): string {
  return `subgraph_${inId}_${outId}`;
}

export function findInnermostScope(
  firstId: number,
  secondId: number,
  scopes: readonly Scope[],
): string | null {
  const minId = Math.min(firstId, secondId);

  // Include inId == minId because boundary endpoints are valid candidates.
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

  for (let scopeIndex = low - 1; scopeIndex >= 0; scopeIndex -= 1) {
    const scope = scopes[scopeIndex];
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

export function appendToList<KeyType, ValueType>(
  map: Map<KeyType, ValueType[]>,
  key: KeyType,
  value: ValueType,
): void {
  let list = map.get(key);
  if (!list) {
    list = [];
    map.set(key, list);
  }
  list.push(value);
}

export function computePortCounts(
  scopeMap: Map<string, Scope>,
  nodeMap: Map<number, Node>,
): void {
  for (const scope of scopeMap.values()) {
    for (const edge of scope.edges) {
      const sourceNode = nodeMap.get(edge.sourceId);
      if (sourceNode) {
        sourceNode.outputPortCount = Math.max(
          sourceNode.outputPortCount,
          edge.sourcePort + 1,
        );
      }

      const targetNode = nodeMap.get(edge.targetId);
      if (targetNode) {
        targetNode.inputPortCount = Math.max(
          targetNode.inputPortCount,
          edge.targetPort + 1,
        );
      }
    }
  }
}

export function createScope(
  scopeId: string,
  options: Partial<
    Pick<Scope, "inId" | "outId" | "label" | "parentNodeId">
  > = {},
): Scope {
  return {
    scopeId,
    nodeIds: [],
    edges: [],
    inId: options.inId ?? null,
    outId: options.outId ?? null,
    label: options.label ?? null,
    parentNodeId: options.parentNodeId ?? null,
  };
}
