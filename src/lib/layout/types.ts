import type { LayoutGrid } from "../routing/occupancy";
import type { TilePyramid } from "../scene/tile-pyramid";

export interface NodePosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class NodePositionLookup {
  private readonly nodeIds: Float64Array;
  private readonly coordinates: Float64Array;

  constructor(entries: readonly [number, NodePosition][]) {
    const sorted = [...entries].sort((left, right) => left[0] - right[0]);
    this.nodeIds = new Float64Array(sorted.length);
    this.coordinates = new Float64Array(sorted.length * 4);
    for (let index = 0; index < sorted.length; index += 1) {
      const [nodeId, position] = sorted[index];
      this.nodeIds[index] = nodeId;
      this.coordinates[index * 4] = position.x;
      this.coordinates[index * 4 + 1] = position.y;
      this.coordinates[index * 4 + 2] = position.width;
      this.coordinates[index * 4 + 3] = position.height;
    }
  }

  get(nodeId: number): NodePosition | undefined {
    const index = this.find(nodeId);
    if (index < 0) return undefined;
    return this.read(index);
  }

  *entries(): IterableIterator<[number, NodePosition]> {
    for (let index = 0; index < this.nodeIds.length; index += 1) {
      yield [this.nodeIds[index], this.read(index)];
    }
  }

  [Symbol.iterator](): IterableIterator<[number, NodePosition]> {
    return this.entries();
  }

  private find(nodeId: number): number {
    let low = 0;
    let high = this.nodeIds.length - 1;
    while (low <= high) {
      const middle = low + ((high - low) >> 1);
      if (this.nodeIds[middle] === nodeId) return middle;
      if (this.nodeIds[middle] < nodeId) low = middle + 1;
      else high = middle - 1;
    }
    return -1;
  }

  private read(index: number): NodePosition {
    return {
      x: this.coordinates[index * 4],
      y: this.coordinates[index * 4 + 1],
      width: this.coordinates[index * 4 + 2],
      height: this.coordinates[index * 4 + 3],
    };
  }
}

export interface ScopeLayout {
  nodePositions: NodePositionLookup;
  gridWidth: number;
  gridHeight: number;
  channelY: number[];
  channelLaneCount: number[];
  layerOf: Map<number, number>;
  layers: number[][];
  grid: LayoutGrid;
  nodeTileIndex: TilePyramid<number>;
}
