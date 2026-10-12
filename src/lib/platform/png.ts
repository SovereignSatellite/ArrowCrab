import { createCanvas } from "@napi-rs/canvas";
import type { Diagram } from "../diagram/types.ts";
import {
  createDrawing,
  drawDiagram,
  measureDiagram,
} from "../drawing/index.ts";

export async function renderDiagramPng(
  diagram: Diagram,
  options: { scale: number; padding: number; background: string },
): Promise<Uint8Array> {
  if (!Number.isFinite(options.scale) || options.scale <= 0)
    throw new RangeError("Image scale must be finite and positive.");
  if (!Number.isFinite(options.padding) || options.padding < 0)
    throw new RangeError("Image padding must be finite and nonnegative.");
  const canvas = createCanvas(1, 1);
  const colorCanvas = createCanvas(1, 1);
  const surface = createDrawing(
    canvas.getContext("2d"),
    colorCanvas.getContext("2d"),
    null,
  );
  const bounds = measureDiagram(surface, diagram);
  const width = Math.max(
    1,
    Math.ceil(
      (bounds.maxX - bounds.minX) * options.scale + options.padding * 2,
    ),
  );
  const height = Math.max(
    1,
    Math.ceil(
      (bounds.maxY - bounds.minY) * options.scale + options.padding * 2,
    ),
  );
  canvas.width = width;
  canvas.height = height;
  drawDiagram(surface, diagram, {
    width,
    height,
    pixelRatio: 1,
    viewport: {
      offsetX: options.padding - bounds.minX * options.scale,
      offsetY: options.padding - bounds.minY * options.scale,
      scale: options.scale,
    },
    highlightedNodes: new Set(),
    highlightedEdges: new Set(),
    background: options.background,
  });
  return canvas.encode("png");
}
