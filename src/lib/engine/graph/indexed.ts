import type { IndexedGraph, Node, NodeLookup } from "./types.ts";

export function buildIndexedGraph(
  edgeCount: number,
  nodeMap: Map<number, Node>,
): IndexedGraph {
  const nodeIds = new Float64Array(nodeMap.size);
  const nodeLabels: string[] = new Array(nodeMap.size);
  const nodeColors: string[] = new Array(nodeMap.size);
  const nodeScopeIds: Array<string | null> = new Array(nodeMap.size);
  const inputPortCounts = new Uint32Array(nodeMap.size);
  const outputPortCounts = new Uint32Array(nodeMap.size);
  const nodeSubgraphs = new Array<Node["subgraphs"]>(nodeMap.size);

  let nodeIndex = 0;
  for (const node of nodeMap.values()) {
    nodeIds[nodeIndex] = node.id;
    nodeLabels[nodeIndex] = node.label;
    nodeColors[nodeIndex] = node.color;
    nodeScopeIds[nodeIndex] = node.scopeId;
    inputPortCounts[nodeIndex] = node.inputPortCount;
    outputPortCounts[nodeIndex] = node.outputPortCount;
    nodeSubgraphs[nodeIndex] = node.subgraphs;
    nodeIndex += 1;
  }

  return {
    nodeIds,
    nodeLabels,
    nodeColors,
    nodeScopeIds,
    inputPortCounts,
    outputPortCounts,
    nodeSubgraphs,
    edgeCount,
  };
}

function findIndexedNodeIndex(
  nodeIds: Float64Array,
  nodeId: number,
): number | undefined {
  let low = 0;
  let high = nodeIds.length - 1;
  while (low <= high) {
    const middle = low + ((high - low) >> 1);
    const candidate = nodeIds[middle];
    if (candidate === nodeId) return middle;
    if (candidate < nodeId) low = middle + 1;
    else high = middle - 1;
  }
  return undefined;
}

export class IndexedNodeLookup implements NodeLookup {
  private readonly indexed: IndexedGraph;

  constructor(indexed: IndexedGraph) {
    this.indexed = indexed;
  }

  get(nodeId: number): Node | undefined {
    const nodeIndex = findIndexedNodeIndex(this.indexed.nodeIds, nodeId);
    if (nodeIndex === undefined) return undefined;
    return {
      id: nodeId,
      label: this.indexed.nodeLabels[nodeIndex],
      color: this.indexed.nodeColors[nodeIndex],
      inputPortCount: this.indexed.inputPortCounts[nodeIndex],
      outputPortCount: this.indexed.outputPortCounts[nodeIndex],
      scopeId: this.indexed.nodeScopeIds[nodeIndex],
      subgraphs: this.indexed.nodeSubgraphs[nodeIndex],
    };
  }
}
