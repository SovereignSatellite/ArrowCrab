// Wire format: the JSON structure produced by the compiler.
// Arrays are flat-packed; see `buildGraphModel()` for unpacking.

export interface GraphData {
  subgraphs: number[];
  nodes: number[];
  edges: number[];
  strings: string[];
}

// Unpacked records (still referencing raw IDs, pre-scope-resolution).

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

// Resolved model types (after scope assignment and port count inference).

export interface Node {
  id: number;
  label: string;
  color: string;
  portCountIn: number;
  portCountOut: number;
  scopeId: string;
  subgraphs: { inId: number; outId: number }[];
}

export interface Edge {
  sourceId: number;
  sourcePort: number;
  targetId: number;
  targetPort: number;
}

export interface Scope {
  scopeId: string;
  nodeIds: number[];
  edges: Edge[];
  predecessors: Map<number, number[]>;
  successors: Map<number, number[]>;
  inId: number | null;
  outId: number | null;
  label: string | null;
  parentNodeId: number | null;
}

export interface GraphModel {
  nodeMap: Map<number, Node>;
  scopeMap: Map<string, Scope>;
}
