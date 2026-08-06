import { buildGraphModel, type GraphData } from "../graph";
import { computeAllLayouts } from "../layout";
import { computeAllRouting } from "../routing";
import { serializeLayoutSnapshot } from "../scene";

interface LayoutRequest {
  type: "layout";
  requestId: number;
  json: string;
}

let activeRequestId = -1;

self.addEventListener("message", (event: MessageEvent<LayoutRequest>) => {
  const request = event.data;
  if (request.type !== "layout") {
    return;
  }
  activeRequestId = request.requestId;

  try {
    self.postMessage({
      type: "progress",
      requestId: request.requestId,
      phase: "validating",
    });
    const graphData = JSON.parse(request.json) as GraphData;
    const model = buildGraphModel(graphData);
    if (activeRequestId !== request.requestId) {
      return;
    }

    self.postMessage({
      type: "progress",
      requestId: request.requestId,
      phase: "layout",
    });
    const expandedNodes = new Set<number>();
    const layoutMap = computeAllLayouts(model, expandedNodes);
    if (activeRequestId !== request.requestId) {
      return;
    }

    self.postMessage({
      type: "progress",
      requestId: request.requestId,
      phase: "routing",
    });
    const routingMap = computeAllRouting(model, layoutMap, expandedNodes);
    const snapshot = serializeLayoutSnapshot(layoutMap, routingMap);
    const transferables = snapshot.routing.flatMap((routing) => [
      routing.routeOffsets.buffer,
      routing.routePoints.buffer,
      routing.routeBounds.buffer,
    ]);
    self.postMessage(
      {
        type: "ready",
        requestId: request.requestId,
        graphData,
        snapshot,
      },
      { transfer: transferables as Transferable[] },
    );
  } catch (error) {
    self.postMessage({
      type: "error",
      requestId: request.requestId,
      message: error instanceof Error ? error.message : "Unable to load graph.",
    });
  }
});

self.addEventListener(
  "message",
  (event: MessageEvent<{ type: "cancel"; requestId: number }>) => {
    if (
      event.data.type === "cancel" &&
      event.data.requestId === activeRequestId
    ) {
      activeRequestId = -1;
    }
  },
);
