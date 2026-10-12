import {
  LOD_FULL,
  LOD_SIMPLIFIED,
  NODE_STROKE_WIDTH,
  FRAME_STROKE_WIDTH,
} from "./styles.ts";
import { isNodeExpanded } from "../diagram/types.ts";
import { getScopeRenderIndex, type ScopeRenderIndex } from "./scope-index.ts";
import type { DrawingFrame, VisibleRect } from "./types.ts";
import type { DiagramNode } from "../diagram/graph.ts";
import { getRoutePoints, type ScopeRouting } from "../diagram/routing.ts";
import {
  GRID_UNIT,
  LABEL_BAR_HEIGHT,
  NODE_INNER_GAP,
  subgraphScopeId,
  TOP_LEVEL_SCOPE_ID,
} from "../diagram/geometry.ts";
import {
  appendArrowhead,
  appendCircleOutline,
  appendRoundedRectangle,
  appendRoundedRectangleOutline,
  appendSmoothPolyline,
  BACKGROUND,
  clearVertexBuffer,
  createVertexBuffer,
  DIM_ALPHA,
  FRAME_CORNER_RADIUS,
  FRAGMENT_SHADER,
  NODE_CORNER_RADIUS,
  getPackedVertexData,
  VERTEX_SHADER,
  type VertexBuffer,
} from "./webgl-geometry.ts";

function createShader(
  webglContext: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = webglContext.createShader(type);
  if (!shader) throw new Error("Unable to create WebGL shader");
  webglContext.shaderSource(shader, source);
  webglContext.compileShader(shader);
  if (!webglContext.getShaderParameter(shader, webglContext.COMPILE_STATUS)) {
    const message =
      webglContext.getShaderInfoLog(shader) ?? "Unknown WebGL shader error";
    webglContext.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(webglContext: WebGL2RenderingContext): WebGLProgram {
  const vertexShader = createShader(
    webglContext,
    webglContext.VERTEX_SHADER,
    VERTEX_SHADER,
  );
  const fragmentShader = createShader(
    webglContext,
    webglContext.FRAGMENT_SHADER,
    FRAGMENT_SHADER,
  );
  const program = webglContext.createProgram();
  if (!program) throw new Error("Unable to create WebGL program");
  webglContext.attachShader(program, vertexShader);
  webglContext.attachShader(program, fragmentShader);
  webglContext.linkProgram(program);
  webglContext.deleteShader(vertexShader);
  webglContext.deleteShader(fragmentShader);
  if (!webglContext.getProgramParameter(program, webglContext.LINK_STATUS)) {
    const message =
      webglContext.getProgramInfoLog(program) ?? "Unknown WebGL link error";
    webglContext.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}

export class WebGLGraphRenderer {
  private readonly webglContext: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vertexBuffer: WebGLBuffer;
  private readonly positionLocation: number;
  private readonly colorLocation: number;
  private readonly lineWidth: number;
  private readonly fillVertices = createVertexBuffer();
  private readonly lineVertices = createVertexBuffer();
  private readonly edgeVertices = createVertexBuffer();
  private readonly arrowVertices = createVertexBuffer();
  private readonly crossingVertices = createVertexBuffer();

  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const webglContext = canvas.getContext("webgl2", {
      alpha: false,
      antialias: true,
      preserveDrawingBuffer: false,
    });
    if (!webglContext) throw new Error("WebGL2 is unavailable");
    this.webglContext = webglContext;
    this.program = createProgram(webglContext);
    const vertexBuffer = webglContext.createBuffer();
    if (!vertexBuffer) throw new Error("Unable to create WebGL vertex buffer");
    this.vertexBuffer = vertexBuffer;
    this.positionLocation = webglContext.getAttribLocation(
      this.program,
      "a_position",
    );
    this.colorLocation = webglContext.getAttribLocation(
      this.program,
      "a_color",
    );
    const lineRange = webglContext.getParameter(
      webglContext.ALIASED_LINE_WIDTH_RANGE,
    ) as Float32Array;
    this.lineWidth = Math.min(1.5, lineRange[1]);
    webglContext.enable(webglContext.BLEND);
    webglContext.blendFunc(
      webglContext.SRC_ALPHA,
      webglContext.ONE_MINUS_SRC_ALPHA,
    );
  }

  resize(canvasWidth: number, canvasHeight: number, pixelRatio: number): void {
    const width = Math.max(1, Math.round(canvasWidth * pixelRatio));
    const height = Math.max(1, Math.round(canvasHeight * pixelRatio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.webglContext.viewport(0, 0, width, height);
  }

  render(scene: DrawingFrame, visibleRect: VisibleRect): void {
    const canvasWidth = Math.max(1, scene.width);
    const canvasHeight = Math.max(1, scene.height);
    const toClipCoordinates = (x: number, y: number): [number, number] => [
      ((x * scene.viewport.scale + scene.viewport.offsetX) / canvasWidth) * 2 -
        1,
      1 -
        ((y * scene.viewport.scale + scene.viewport.offsetY) / canvasHeight) *
          2,
    ];

    clearVertexBuffer(this.fillVertices);
    clearVertexBuffer(this.lineVertices);
    clearVertexBuffer(this.edgeVertices);
    clearVertexBuffer(this.arrowVertices);
    clearVertexBuffer(this.crossingVertices);
    const webglContext = this.webglContext;
    const background =
      scene.background === null
        ? BACKGROUND
        : scene.colors.normalizedColor(scene.background);
    webglContext.clearColor(background[0], background[1], background[2], 1);
    webglContext.clear(webglContext.COLOR_BUFFER_BIT);
    webglContext.useProgram(this.program);
    webglContext.bindBuffer(webglContext.ARRAY_BUFFER, this.vertexBuffer);
    webglContext.enableVertexAttribArray(this.positionLocation);
    webglContext.enableVertexAttribArray(this.colorLocation);
    webglContext.vertexAttribPointer(
      this.positionLocation,
      2,
      webglContext.FLOAT,
      false,
      24,
      0,
    );
    webglContext.vertexAttribPointer(
      this.colorLocation,
      4,
      webglContext.FLOAT,
      false,
      24,
      8,
    );
    this.renderScope(
      scene,
      TOP_LEVEL_SCOPE_ID,
      0,
      0,
      visibleRect,
      toClipCoordinates,
    );
    webglContext.disableVertexAttribArray(this.positionLocation);
    webglContext.disableVertexAttribArray(this.colorLocation);
  }

  private drawBuffer(buffer: VertexBuffer, mode: number): void {
    if (buffer.length === 0) return;
    const webglContext = this.webglContext;
    webglContext.bufferData(
      webglContext.ARRAY_BUFFER,
      getPackedVertexData(buffer),
      webglContext.STREAM_DRAW,
    );
    webglContext.lineWidth(this.lineWidth);
    webglContext.drawArrays(mode, 0, buffer.length / 6);
  }

  private renderScope(
    scene: DrawingFrame,
    scopeId: string,
    offsetX: number,
    offsetY: number,
    visibleRect: VisibleRect,
    toClipCoordinates: (x: number, y: number) => [number, number],
  ): void {
    const fills = this.fillVertices;
    const lines = this.lineVertices;
    const edges = this.edgeVertices;
    const arrows = this.arrowVertices;
    const crossings = this.crossingVertices;
    const layout = scene.layoutMap.get(scopeId)!;
    const routing = scene.routingMap.get(scopeId)!;
    const indexes = getScopeRenderIndex(scene, scopeId, offsetX, offsetY);
    this.renderEdges(scene, routing, indexes, visibleRect, toClipCoordinates);
    this.drawBuffer(edges, this.webglContext.TRIANGLES);
    this.drawBuffer(arrows, this.webglContext.TRIANGLES);
    this.drawBuffer(crossings, this.webglContext.LINES);
    clearVertexBuffer(edges);
    clearVertexBuffer(arrows);
    clearVertexBuffer(crossings);

    const nodeIds = indexes.nodeIndex.query(
      visibleRect.left - offsetX,
      visibleRect.top - offsetY,
      visibleRect.right - offsetX,
      visibleRect.bottom - offsetY,
    );
    for (const nodeId of nodeIds) {
      const position = layout.nodePositions.get(nodeId)!;
      const node = scene.nodeMap.get(nodeId)!;
      const alpha = this.alphaForNode(scene, nodeId);
      const pixelX = offsetX + position.x * GRID_UNIT;
      const pixelY = offsetY + position.y * GRID_UNIT;
      const pixelWidth = position.width * GRID_UNIT;
      const pixelHeight = position.height * GRID_UNIT;
      const screenPixelWidth = pixelWidth * scene.viewport.scale;
      const parsedColor = scene.colors.parseCssColor(node.color);
      const color: [number, number, number] = [
        parsedColor.red / 255,
        parsedColor.green / 255,
        parsedColor.blue / 255,
      ];
      appendRoundedRectangle(
        fills,
        pixelX,
        pixelY,
        pixelWidth,
        pixelHeight,
        color,
        alpha * parsedColor.alpha,
        toClipCoordinates,
        NODE_CORNER_RADIUS,
      );
      if (screenPixelWidth >= LOD_SIMPLIFIED) {
        appendRoundedRectangleOutline(
          lines,
          pixelX,
          pixelY,
          pixelWidth,
          pixelHeight,
          scene.colors.normalizedColor(
            scene.colors.darkenColor(node.color, 0.3),
          ),
          alpha,
          toClipCoordinates,
          NODE_CORNER_RADIUS,
          NODE_STROKE_WIDTH,
        );
      }

      if (screenPixelWidth >= LOD_FULL && isNodeExpanded(scene, node)) {
        this.drawBuffer(fills, this.webglContext.TRIANGLES);
        this.drawBuffer(lines, this.webglContext.TRIANGLES);
        clearVertexBuffer(fills);
        clearVertexBuffer(lines);
        this.renderChildren(
          scene,
          node,
          pixelX,
          pixelY,
          visibleRect,
          toClipCoordinates,
        );
      }
    }
    this.drawBuffer(fills, this.webglContext.TRIANGLES);
    this.drawBuffer(lines, this.webglContext.TRIANGLES);
    clearVertexBuffer(fills);
    clearVertexBuffer(lines);
  }

  private renderChildren(
    scene: DrawingFrame,
    node: DiagramNode,
    pixelX: number,
    pixelY: number,
    visibleRect: VisibleRect,
    toClipCoordinates: (x: number, y: number) => [number, number],
  ): void {
    const fills = this.fillVertices;
    const lines = this.lineVertices;
    const subgraphAreaY =
      pixelY + (LABEL_BAR_HEIGHT + NODE_INNER_GAP) * GRID_UNIT;
    let currentX = pixelX + NODE_INNER_GAP * GRID_UNIT;
    for (const subgraph of node.subgraphs) {
      const scopeId = subgraphScopeId(subgraph.inId, subgraph.outId);
      const childLayout = scene.layoutMap.get(scopeId)!;
      const frameWidth = childLayout.gridWidth * GRID_UNIT;
      const frameHeight = childLayout.gridHeight * GRID_UNIT;
      appendRoundedRectangle(
        fills,
        currentX,
        subgraphAreaY,
        frameWidth,
        frameHeight,
        scene.colors.normalizedColor("#141414"),
        1,
        toClipCoordinates,
        FRAME_CORNER_RADIUS,
      );
      appendRoundedRectangleOutline(
        lines,
        currentX,
        subgraphAreaY,
        frameWidth,
        frameHeight,
        scene.colors.normalizedColor(scene.colors.darkenColor(node.color, 0.1)),
        1,
        toClipCoordinates,
        FRAME_CORNER_RADIUS,
        FRAME_STROKE_WIDTH,
      );
      this.drawBuffer(fills, this.webglContext.TRIANGLES);
      this.drawBuffer(lines, this.webglContext.TRIANGLES);
      clearVertexBuffer(fills);
      clearVertexBuffer(lines);
      this.renderScope(
        scene,
        scopeId,
        currentX,
        subgraphAreaY,
        visibleRect,
        toClipCoordinates,
      );
      currentX += frameWidth + NODE_INNER_GAP * GRID_UNIT;
    }
  }

  private renderEdges(
    scene: DrawingFrame,
    routing: ScopeRouting,
    indexes: ScopeRenderIndex,
    visibleRect: VisibleRect,
    toClipCoordinates: (x: number, y: number) => [number, number],
  ): void {
    const edges = this.edgeVertices;
    const arrows = this.arrowVertices;
    const crossings = this.crossingVertices;
    const edgeIndices = indexes.edgeIndex
      .query(
        visibleRect.left,
        visibleRect.top,
        visibleRect.right,
        visibleRect.bottom,
      )
      .sort((left, right) => left - right);
    for (const edgeIndex of edgeIndices) {
      const routed = routing.routedEdges[edgeIndex];
      const color = scene.colors.normalizedColor(
        scene.colors.edgeColor(routed.edgeIndex),
      );
      const alpha = this.alphaForEdge(scene, routed.edgeIndex);
      const points = getRoutePoints(routing, edgeIndex);
      appendSmoothPolyline(edges, points, color, alpha, toClipCoordinates);
      appendArrowhead(
        arrows,
        points[points.length - 2],
        points[points.length - 1],
        points[points.length - 4],
        points[points.length - 3],
        color,
        alpha,
        toClipCoordinates,
      );
    }

    const crossingColor: [number, number, number] = [1, 1, 1];
    const crossingAlpha =
      scene.highlightedNodes.size > 0 || scene.highlightedEdges.size > 0
        ? DIM_ALPHA
        : 1;
    for (const crossingIndex of indexes.crossingIndex.query(
      visibleRect.left,
      visibleRect.top,
      visibleRect.right,
      visibleRect.bottom,
    )) {
      const crossing = routing.crossings[crossingIndex];
      appendCircleOutline(
        crossings,
        crossing,
        crossingColor,
        crossingAlpha,
        toClipCoordinates,
      );
    }
  }

  private alphaForNode(scene: DrawingFrame, nodeId: number): number {
    return scene.highlightedNodes.size === 0 &&
      scene.highlightedEdges.size === 0
      ? 1
      : scene.highlightedNodes.has(nodeId)
        ? 1
        : DIM_ALPHA;
  }

  private alphaForEdge(scene: DrawingFrame, edgeIndex: number): number {
    return scene.highlightedNodes.size === 0 &&
      scene.highlightedEdges.size === 0
      ? 1
      : scene.highlightedEdges.has(edgeIndex)
        ? 1
        : DIM_ALPHA;
  }
}

export function createWebGLRenderer(
  canvas: HTMLCanvasElement,
): WebGLGraphRenderer | null {
  try {
    return new WebGLGraphRenderer(canvas);
  } catch {
    return null;
  }
}
