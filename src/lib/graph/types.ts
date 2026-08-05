// The compiler emits this wire format; `buildGraphModel()` unpacks its
// flat-packed arrays.

export interface GraphData {
  subgraphs: number[];
  nodes: number[];
  edges: number[];
  strings: string[];
}

export interface RawSubgraph {
  nodeId: number;
  inId: number;
  outId: number;
}

export interface RawNode {
  id: number;
  label: string;
  color: string;
}

export interface RawEdge {
  sourceId: number;
  sourcePort: number;
  targetId: number;
  targetPort: number;
}

export interface Node {
  id: number;
  label: string;
  color: string;
  inputPortCount: number;
  outputPortCount: number;
  scopeId: string;
  subgraphs: { inId: number; outId: number }[];
}

export interface Edge {
  edgeIndex: number;
  sourceId: number;
  sourcePort: number;
  targetId: number;
  targetPort: number;
}

export interface Scope {
  scopeId: string;
  nodeIds: number[];
  edges: Edge[];
  inId: number | null;
  outId: number | null;
  label: string | null;
  parentNodeId: number | null;
}

export interface IndexedGraph {
  nodeIds: Float64Array;
  nodeLabels: string[];
  nodeColors: string[];
  nodeScopeIds: string[];
  inputPortCounts: Uint32Array;
  outputPortCounts: Uint32Array;
  nodeSubgraphs: Array<{ inId: number; outId: number }[] | undefined>;
  edgeSourceIndices: Uint32Array;
}

export interface GraphModel {
  nodeMap: NodeLookup;
  scopeMap: Map<string, Scope>;
  indexed: IndexedGraph;
}

export interface NodeLookup {
  get(nodeId: number): Node | undefined;
}
