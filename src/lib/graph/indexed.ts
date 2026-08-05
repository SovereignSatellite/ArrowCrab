import type { Edge, IndexedGraph, Node, NodeLookup, RawNode } from "./types";
import { EMPTY_SUBGRAPHS } from "./scopes";

export function buildIndexedGraph(
  rawNodes: RawNode[],
  edges: Edge[],
  nodeMap: Map<number, Node>,
): IndexedGraph {
  const nodeIndexById = new Map<number, number>();
  const nodeIds = new Float64Array(rawNodes.length);
  const nodeLabels: string[] = new Array(rawNodes.length);
  const nodeColors: string[] = new Array(rawNodes.length);
  const nodeScopeIds: string[] = new Array(rawNodes.length);
  const inputPortCounts = new Uint32Array(rawNodes.length);
  const outputPortCounts = new Uint32Array(rawNodes.length);
  const nodeSubgraphs: Array<{ inId: number; outId: number }[] | undefined> =
    new Array(rawNodes.length);

  for (let nodeIndex = 0; nodeIndex < rawNodes.length; nodeIndex += 1) {
    const rawNode = rawNodes[nodeIndex];
    nodeIndexById.set(rawNode.id, nodeIndex);
    nodeIds[nodeIndex] = rawNode.id;
    nodeLabels[nodeIndex] = rawNode.label;
    nodeColors[nodeIndex] = rawNode.color;
    const node = nodeMap.get(rawNode.id)!;
    nodeScopeIds[nodeIndex] = node.scopeId;
    inputPortCounts[nodeIndex] = node.inputPortCount;
    outputPortCounts[nodeIndex] = node.outputPortCount;
    if (node.subgraphs.length > 0) {
      nodeSubgraphs[nodeIndex] = node.subgraphs;
    }
  }

  const edgeSourceIndices = new Uint32Array(edges.length);

  for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 1) {
    const edge = edges[edgeIndex];
    edgeSourceIndices[edgeIndex] = nodeIndexById.get(edge.sourceId)!;
  }

  return {
    nodeIds,
    nodeLabels,
    nodeColors,
    nodeScopeIds,
    inputPortCounts,
    outputPortCounts,
    nodeSubgraphs,
    edgeSourceIndices,
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

class IndexedNodeMap implements NodeLookup {
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
      subgraphs: this.indexed.nodeSubgraphs[nodeIndex] ?? EMPTY_SUBGRAPHS,
    };
  }
}

export function createNodeLookup(indexed: IndexedGraph): NodeLookup {
  return new IndexedNodeMap(indexed);
}
