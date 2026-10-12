import type { DiagramNode, Edge } from "../../diagram/graph.ts";
export type { Edge } from "../../diagram/graph.ts";

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

export interface Node extends RawNode {
  inputPortCount: number;
  outputPortCount: number;
  scopeId: string | null;
  subgraphs: DiagramNode["subgraphs"];
}

export interface Scope {
  scopeId: string;
  nodeIds: number[];
  edges: Edge[];
  inId: number | null;
  outId: number | null;
  parentNodeId: number | null;
}

export interface IndexedGraph {
  nodeIds: Float64Array;
  nodeLabels: string[];
  nodeColors: string[];
  nodeScopeIds: Array<string | null>;
  inputPortCounts: Uint32Array;
  outputPortCounts: Uint32Array;
  nodeSubgraphs: Array<Node["subgraphs"]>;
  edgeCount: number;
}

export interface GraphModel {
  nodeMap: NodeLookup;
  scopeMap: Map<string, Scope>;
  indexed: IndexedGraph;
}

export interface NodeLookup {
  get(nodeId: number): Node | undefined;
}
