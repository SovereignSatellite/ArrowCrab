import type { GraphData } from "../engine/graph/index.ts";
import type { LayoutSnapshot } from "../diagram/index.ts";

export interface LayoutRequest {
  json: string;
}

export type LayoutResponse =
  | { type: "progress"; phase: "validating" | "layout" | "routing" }
  | { type: "error"; message: string }
  | { type: "ready"; graphData: GraphData; snapshot: LayoutSnapshot };
