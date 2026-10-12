import type { GraphModel } from "./graph/types.ts";
import type { Diagram, DiagramNode } from "../diagram/index.ts";
import type { ScopeLayout } from "../diagram/positions.ts";
import type { ScopeRouting } from "../diagram/routing.ts";
import { computeAllLayouts } from "./layout/index.ts";
import { computeAllRouting } from "./routing/index.ts";

export function createDiagram(
  model: GraphModel,
  layouts: ReadonlyMap<string, ScopeLayout>,
  routingMap: ReadonlyMap<string, ScopeRouting>,
): Diagram {
  const nodeMap = new Map<number, DiagramNode>();
  const layoutMap = new Map<string, ScopeLayout>();
  function includeNode(nodeId: number): void {
    const node = model.nodeMap.get(nodeId)!;
    nodeMap.set(nodeId, {
      id: node.id,
      label: node.label,
      color: node.color,
      inputPortCount: node.inputPortCount,
      outputPortCount: node.outputPortCount,
      subgraphs: node.subgraphs,
    });
  }
  for (const scopeId of routingMap.keys()) {
    const scope = model.scopeMap.get(scopeId)!;
    layoutMap.set(scopeId, layouts.get(scopeId)!);
    for (const nodeId of scope.nodeIds) includeNode(nodeId);
    if (scope.inId !== null && !nodeMap.has(scope.inId))
      includeNode(scope.inId);
    if (scope.outId !== null && !nodeMap.has(scope.outId))
      includeNode(scope.outId);
  }
  return { nodeMap, layoutMap, routingMap };
}

export function layoutGraph(
  model: GraphModel,
  expandedNodes: ReadonlySet<number>,
): Diagram {
  const layouts = computeAllLayouts(model, expandedNodes);
  const routes = computeAllRouting(model, layouts, expandedNodes);
  return createDiagram(model, layouts, routes);
}
