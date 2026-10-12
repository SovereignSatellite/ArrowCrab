import { TOP_LEVEL_SCOPE_ID } from "../../diagram/geometry.ts";
import type { Scope, Node } from "./types.ts";

export const EMPTY_SUBGRAPHS: Node["subgraphs"] = [];

export function findNodeScope(
  nodeId: number,
  scopes: readonly Scope[],
): string {
  let low = 0;
  let high = scopes.length;
  while (low < high) {
    const middle = low + ((high - low) >> 1);
    if (scopes[middle].inId! < nodeId) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  let bestId = TOP_LEVEL_SCOPE_ID;
  let bestRange: bigint | null = null;

  for (let scopeIndex = low - 1; scopeIndex >= 0; scopeIndex -= 1) {
    const scope = scopes[scopeIndex];
    if (nodeId >= scope.outId!) continue;
    const range = BigInt(scope.outId!) - BigInt(scope.inId!);
    if (bestRange !== null && range >= bestRange) {
      continue;
    }

    bestRange = range;
    bestId = scope.scopeId;
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

export function createScope(
  scopeId: string,
  options: Pick<Scope, "inId" | "outId" | "parentNodeId">,
): Scope {
  return {
    scopeId,
    nodeIds: [],
    edges: [],
    ...options,
  };
}
