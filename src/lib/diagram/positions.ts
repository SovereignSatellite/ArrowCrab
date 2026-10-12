export interface NodePosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class NodePositionLookup {
  private readonly nodeIds: Float64Array;
  private readonly coordinates: Float64Array;

  constructor(sortedEntries: readonly [number, NodePosition][]) {
    this.nodeIds = new Float64Array(sortedEntries.length);
    this.coordinates = new Float64Array(sortedEntries.length * 4);
    for (let index = 0; index < sortedEntries.length; index += 1) {
      const [nodeId, position] = sortedEntries[index];
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

  intersectsColumn(column: number, minRow: number, maxRow: number): boolean {
    for (let offset = 0; offset < this.coordinates.length; offset += 4) {
      const left = this.coordinates[offset];
      const top = this.coordinates[offset + 1];
      if (
        column >= left &&
        column < left + this.coordinates[offset + 2] &&
        top <= maxRow &&
        top + this.coordinates[offset + 3] - 1 >= minRow
      ) {
        return true;
      }
    }
    return false;
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
  readonly nodePositions: NodePositionLookup;
  readonly gridWidth: number;
  readonly gridHeight: number;
}
