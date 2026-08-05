import type { GraphModel, Node } from "../graph/types";
import type { ScopeLayout } from "../layout/types";
import type { ScopeRouting } from "../routing/types";
import {
  GRID_UNIT,
  LABEL_BAR_HEIGHT,
  NODE_INNER_GAP,
  NODE_STROKE_WIDTH,
} from "./constants";
import { darkenColor, edgeColor } from "./colors";
import { subgraphScopeId, TOP_LEVEL_SCOPE_ID } from "../graph/scopes";
import type { Point } from "../geometry/types";
import {
  appendArrowhead,
  appendCircleOutline,
  appendRoundedRectangle,
  appendRoundedRectangleOutline,
  appendSmoothPolyline,
  BACKGROUND,
  clearVertexBuffer,
  cssColor,
  createVertexBuffer,
  DIM_ALPHA,
  FRAME_CORNER_RADIUS,
  FRAGMENT_SHADER,
  LOD_DOT,
  LOD_FULL,
  LOD_SIMPLIFIED,
  NODE_CORNER_RADIUS,
  getPackedVertexData,
  VERTEX_SHADER,
  type VertexBuffer,
} from "./webgl-geometry";

interface WebGLSceneView {
  model: GraphModel;
  layoutMap: Map<string, ScopeLayout>;
  routingMap: Map<string, ScopeRouting>;
  expandedNodes: Set<number>;
  viewport: { offsetX: number; offsetY: number; scale: number };
  highlightedNodes: Set<number>;
  highlightedEdges: Set<string>;
}

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
  private readonly routePoints: Point[] = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
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

  resize(pixelRatio: number): void {
    const width = Math.max(1, Math.round(this.canvas.clientWidth * pixelRatio));
    const height = Math.max(
      1,
      Math.round(this.canvas.clientHeight * pixelRatio),
    );
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.webglContext.viewport(0, 0, width, height);
  }

  render(
    scene: WebGLSceneView,
    visibleRect: { left: number; top: number; right: number; bottom: number },
  ): void {
    const canvasWidth = Math.max(1, this.canvas.clientWidth);
    const canvasHeight = Math.max(1, this.canvas.clientHeight);
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
    this.renderScope(
      scene,
      TOP_LEVEL_SCOPE_ID,
      0,
      0,
      visibleRect,
      toClipCoordinates,
      this.fillVertices,
      this.lineVertices,
      this.edgeVertices,
      this.arrowVertices,
      this.crossingVertices,
    );

    const webglContext = this.webglContext;
    webglContext.clearColor(BACKGROUND[0], BACKGROUND[1], BACKGROUND[2], 1);
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
    this.drawBuffer(this.fillVertices, webglContext.TRIANGLES);
    this.drawBuffer(this.edgeVertices, webglContext.TRIANGLES);
    this.drawBuffer(this.lineVertices, webglContext.TRIANGLES);
    this.drawBuffer(this.arrowVertices, webglContext.TRIANGLES);
    this.drawBuffer(this.crossingVertices, webglContext.LINES);
    webglContext.disableVertexAttribArray(this.positionLocation);
    webglContext.disableVertexAttribArray(this.colorLocation);
  }

  private drawBuffer(buffer: VertexBuffer, mode: number): void {
    if (buffer.vertices.length === 0) return;
    const webglContext = this.webglContext;
    webglContext.bufferData(
      webglContext.ARRAY_BUFFER,
      getPackedVertexData(buffer),
      webglContext.STREAM_DRAW,
    );
    webglContext.lineWidth(this.lineWidth);
    webglContext.drawArrays(mode, 0, buffer.vertices.length / 6);
  }

  private renderScope(
    scene: WebGLSceneView,
    scopeId: string,
    offsetX: number,
    offsetY: number,
    visibleRect: { left: number; top: number; right: number; bottom: number },
    toClipCoordinates: (x: number, y: number) => [number, number],
    fills: VertexBuffer,
    lines: VertexBuffer,
    edges: VertexBuffer,
    arrows: VertexBuffer,
    crossings: VertexBuffer,
  ): void {
    const layout = scene.layoutMap.get(scopeId);
    if (!layout) return;
    const routing = scene.routingMap.get(scopeId);
    if (routing) {
      this.renderEdges(
        scene,
        routing,
        visibleRect,
        toClipCoordinates,
        edges,
        arrows,
        crossings,
      );
    }

    const visibleLeft = (visibleRect.left - offsetX) / GRID_UNIT;
    const visibleTop = (visibleRect.top - offsetY) / GRID_UNIT;
    const visibleRight = (visibleRect.right - offsetX) / GRID_UNIT;
    const visibleBottom = (visibleRect.bottom - offsetY) / GRID_UNIT;
    const nodeIds = layout.nodeTileIndex.query(
      visibleLeft,
      visibleTop,
      visibleRight,
      visibleBottom,
      scene.viewport.scale,
    );
    for (const nodeId of nodeIds) {
      const position = layout.nodePositions.get(nodeId);
      const node = scene.model.nodeMap.get(nodeId);
      if (!position || !node) continue;
      const alpha = this.alphaForNode(scene, nodeId);
      const pixelX = offsetX + position.x * GRID_UNIT;
      const pixelY = offsetY + position.y * GRID_UNIT;
      const pixelWidth = position.width * GRID_UNIT;
      const pixelHeight = position.height * GRID_UNIT;
      const screenPixelWidth = pixelWidth * scene.viewport.scale;
      if (screenPixelWidth < LOD_DOT) continue;
      const color = cssColor(node.color);
      appendRoundedRectangle(
        fills,
        pixelX,
        pixelY,
        pixelWidth,
        pixelHeight,
        color,
        alpha,
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
          cssColor(darkenColor(node.color, 0.3)),
          alpha,
          toClipCoordinates,
          NODE_CORNER_RADIUS,
          NODE_STROKE_WIDTH,
        );
      }

      if (
        screenPixelWidth >= LOD_FULL &&
        scene.expandedNodes.has(nodeId) &&
        node.subgraphs.length > 0
      ) {
        this.renderChildren(
          scene,
          node,
          pixelX,
          pixelY,
          visibleRect,
          toClipCoordinates,
          fills,
          lines,
          edges,
          arrows,
          crossings,
        );
      }
    }
  }

  private renderChildren(
    scene: WebGLSceneView,
    node: Node,
    pixelX: number,
    pixelY: number,
    visibleRect: { left: number; top: number; right: number; bottom: number },
    toClipCoordinates: (x: number, y: number) => [number, number],
    fills: VertexBuffer,
    lines: VertexBuffer,
    edges: VertexBuffer,
    arrows: VertexBuffer,
    crossings: VertexBuffer,
  ): void {
    const subgraphAreaY =
      pixelY + (LABEL_BAR_HEIGHT + NODE_INNER_GAP) * GRID_UNIT;
    let currentX = pixelX + NODE_INNER_GAP * GRID_UNIT;
    for (const subgraph of node.subgraphs) {
      const scopeId = subgraphScopeId(subgraph.inId, subgraph.outId);
      const childLayout = scene.layoutMap.get(scopeId);
      if (!childLayout) continue;
      const frameWidth = childLayout.gridWidth * GRID_UNIT;
      const frameHeight = childLayout.gridHeight * GRID_UNIT;
      appendRoundedRectangle(
        fills,
        currentX,
        subgraphAreaY,
        frameWidth,
        frameHeight,
        cssColor("#141414"),
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
        cssColor(darkenColor(node.color, 0.1)),
        1,
        toClipCoordinates,
        FRAME_CORNER_RADIUS,
      );
      this.renderScope(
        scene,
        scopeId,
        currentX,
        subgraphAreaY,
        visibleRect,
        toClipCoordinates,
        fills,
        lines,
        edges,
        arrows,
        crossings,
      );
      currentX += frameWidth + NODE_INNER_GAP * GRID_UNIT;
    }
  }

  private renderEdges(
    scene: WebGLSceneView,
    routing: ScopeRouting,
    visibleRect: { left: number; top: number; right: number; bottom: number },
    toClipCoordinates: (x: number, y: number) => [number, number],
    edges: VertexBuffer,
    arrows: VertexBuffer,
    crossings: VertexBuffer,
  ): void {
    const edgeIndices = routing.edgeTileIndex
      .query(
        visibleRect.left,
        visibleRect.top,
        visibleRect.right,
        visibleRect.bottom,
        scene.viewport.scale,
      )
      .sort((left, right) => left - right);
    for (const edgeIndex of edgeIndices) {
      const routed = routing.routedEdges[edgeIndex];
      if (!routed) continue;
      const color = cssColor(edgeColor(routed.colorIndex));
      const alpha = this.alphaForEdge(scene, routed.key);
      const start = routing.routeOffsets[edgeIndex];
      const end = routing.routeOffsets[edgeIndex + 1];
      this.routePoints.length = 0;
      for (let pointIndex = start; pointIndex < end; pointIndex += 1) {
        this.routePoints.push({
          x: routing.routePoints[pointIndex * 2],
          y: routing.routePoints[pointIndex * 2 + 1],
        });
      }
      appendSmoothPolyline(
        edges,
        this.routePoints,
        color,
        alpha,
        toClipCoordinates,
      );
      if (this.routePoints.length >= 2) {
        const prior = {
          x: routing.routePoints[(end - 2) * 2],
          y: routing.routePoints[(end - 2) * 2 + 1],
        };
        appendArrowhead(
          arrows,
          this.routePoints[this.routePoints.length - 1],
          prior,
          color,
          alpha,
          toClipCoordinates,
        );
      }
    }

    const crossingColor: [number, number, number] = [1, 1, 1];
    const crossingAlpha =
      scene.highlightedNodes.size > 0 || scene.highlightedEdges.size > 0
        ? DIM_ALPHA
        : 1;
    for (const crossingIndex of routing.crossingTileIndex.query(
      visibleRect.left,
      visibleRect.top,
      visibleRect.right,
      visibleRect.bottom,
      scene.viewport.scale,
    )) {
      const crossing = routing.crossings[crossingIndex];
      if (crossing) {
        appendCircleOutline(
          crossings,
          crossing,
          crossingColor,
          crossingAlpha,
          toClipCoordinates,
        );
      }
    }
  }

  private alphaForNode(scene: WebGLSceneView, nodeId: number): number {
    return scene.highlightedNodes.size === 0
      ? 1
      : scene.highlightedNodes.has(nodeId)
        ? 1
        : DIM_ALPHA;
  }

  private alphaForEdge(scene: WebGLSceneView, edgeKey: string): number {
    return scene.highlightedEdges.size === 0
      ? 1
      : scene.highlightedEdges.has(edgeKey)
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
