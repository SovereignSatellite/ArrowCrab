import { buildGraphModel, type GraphData } from "../engine/graph/index.ts";
import { computeAllLayouts } from "../engine/layout/index.ts";
import { computeAllRouting } from "../engine/routing/index.ts";
import { serializeLayoutSnapshot } from "../diagram/index.ts";
import type { LayoutRequest, LayoutResponse } from "./types.ts";

function respond(response: LayoutResponse): void {
  self.postMessage(response);
}

self.addEventListener("message", (event: MessageEvent<LayoutRequest>) => {
  try {
    respond({ type: "progress", phase: "validating" });
    const graphData = JSON.parse(event.data.json) as GraphData;
    const model = buildGraphModel(graphData);

    respond({ type: "progress", phase: "layout" });
    const expandedNodes = new Set<number>();
    const layoutMap = computeAllLayouts(model, expandedNodes);

    respond({ type: "progress", phase: "routing" });
    const routingMap = computeAllRouting(model, layoutMap, expandedNodes);
    const snapshot = serializeLayoutSnapshot(layoutMap, routingMap);
    const response: LayoutResponse = { type: "ready", graphData, snapshot };
    const transferables = snapshot.routing.flatMap((routing) => [
      routing.routeOffsets.buffer,
      routing.routePoints.buffer,
      routing.routeBounds.buffer,
    ]);
    self.postMessage(response, { transfer: transferables as Transferable[] });
  } catch (error) {
    respond({
      type: "error",
      message: error instanceof Error ? error.message : "Unable to load graph.",
    });
  }
});
