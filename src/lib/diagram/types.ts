import type { DiagramNode } from "./graph.ts";
import type { ScopeLayout } from "./positions.ts";
import type { ScopeRouting } from "./routing.ts";
import { subgraphScopeId } from "./geometry.ts";

export interface Diagram {
  readonly nodeMap: ReadonlyMap<number, DiagramNode>;
  readonly layoutMap: ReadonlyMap<string, ScopeLayout>;
  readonly routingMap: ReadonlyMap<string, ScopeRouting>;
}

export function isNodeExpanded(diagram: Diagram, node: DiagramNode): boolean {
  const firstSubgraph = node.subgraphs[0];
  return (
    firstSubgraph !== undefined &&
    diagram.routingMap.has(
      subgraphScopeId(firstSubgraph.inId, firstSubgraph.outId),
    )
  );
}
