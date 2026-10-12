interface SpatialEntry<ItemType> {
  readonly item: ItemType;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

type CellContents = number | number[];

interface SpatialLevel {
  cellSize: number;
  cells: Map<string, CellContents>;
}

function cellKey(cellX: number, cellY: number): string {
  return `${cellX}:${cellY}`;
}

function overlaps(
  entry: SpatialEntry<unknown>,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): boolean {
  return (
    entry.maxX >= minX &&
    entry.minX <= maxX &&
    entry.maxY >= minY &&
    entry.minY <= maxY
  );
}

function hasValidBounds(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): boolean {
  return (
    Number.isFinite(minX) &&
    Number.isFinite(minY) &&
    Number.isFinite(maxX) &&
    Number.isFinite(maxY) &&
    minX <= maxX &&
    minY <= maxY
  );
}

function canUseOneCellExpansion(
  entry: SpatialEntry<unknown>,
  cellSize: number,
): boolean {
  const minCellX = Math.floor(entry.minX / cellSize);
  const minCellY = Math.floor(entry.minY / cellSize);
  const maxCellX = Math.floor(entry.maxX / cellSize);
  const maxCellY = Math.floor(entry.maxY / cellSize);
  return maxCellX - minCellX <= 1 && maxCellY - minCellY <= 1;
}

function findCellSize(cellSizes: readonly number[], extent: number): number {
  let lowerBound = 0;
  let upperBound = cellSizes.length;
  while (lowerBound < upperBound) {
    const middle = Math.floor((lowerBound + upperBound) / 2);
    if (cellSizes[middle] >= extent) {
      upperBound = middle;
    } else {
      lowerBound = middle + 1;
    }
  }
  return lowerBound;
}

export class SpatialIndex<ItemType> {
  private readonly entries: readonly SpatialEntry<ItemType>[];
  private readonly levels: readonly SpatialLevel[];

  constructor(
    entries: readonly SpatialEntry<ItemType>[],
    baseCellSize: number,
  ) {
    if (!Number.isFinite(baseCellSize) || baseCellSize <= 0) {
      throw new Error("Cell size must be a positive finite number");
    }

    const cellSizes = [baseCellSize];
    const levelsBySize = new Map<number, SpatialLevel>();
    for (const [entryIndex, entry] of entries.entries()) {
      if (!hasValidBounds(entry.minX, entry.minY, entry.maxX, entry.maxY)) {
        throw new Error("Spatial entry bounds must be finite and ordered");
      }
      const extent = Math.max(entry.maxX - entry.minX, entry.maxY - entry.minY);
      while (cellSizes[cellSizes.length - 1] < extent) {
        cellSizes.push(cellSizes[cellSizes.length - 1] * 2);
      }
      let sizeIndex = findCellSize(cellSizes, extent);
      while (!canUseOneCellExpansion(entry, cellSizes[sizeIndex])) {
        if (sizeIndex + 1 === cellSizes.length) {
          cellSizes.push(cellSizes[sizeIndex] * 2);
        }
        sizeIndex += 1;
      }
      const cellSize = cellSizes[sizeIndex];
      let level = levelsBySize.get(cellSize);
      if (!level) {
        level = { cellSize, cells: new Map() };
        levelsBySize.set(cellSize, level);
      }

      const key = cellKey(
        Math.floor(entry.minX / cellSize),
        Math.floor(entry.minY / cellSize),
      );
      const contents = level.cells.get(key);
      if (contents === undefined) {
        level.cells.set(key, entryIndex);
      } else if (typeof contents === "number") {
        level.cells.set(key, [contents, entryIndex]);
      } else {
        contents.push(entryIndex);
      }
    }

    this.entries = entries;
    this.levels = [...levelsBySize.values()].sort((left, right) =>
      left.cellSize < right.cellSize
        ? -1
        : left.cellSize > right.cellSize
          ? 1
          : 0,
    );
  }

  query(minX: number, minY: number, maxX: number, maxY: number): ItemType[] {
    if (!hasValidBounds(minX, minY, maxX, maxY)) {
      throw new Error("Query bounds must be finite and ordered");
    }

    const result: ItemType[] = [];
    for (const level of this.levels) {
      const minCellX = Math.floor(minX / level.cellSize) - 1;
      const minCellY = Math.floor(minY / level.cellSize) - 1;
      const maxCellX = Math.floor(maxX / level.cellSize);
      const maxCellY = Math.floor(maxY / level.cellSize);
      const width = maxCellX - minCellX + 1;
      const height = maxCellY - minCellY + 1;
      const occupiedCellCount = level.cells.size;

      if (
        !Number.isSafeInteger(minCellX) ||
        !Number.isSafeInteger(minCellY) ||
        !Number.isSafeInteger(maxCellX) ||
        !Number.isSafeInteger(maxCellY) ||
        !Number.isSafeInteger(width) ||
        !Number.isSafeInteger(height) ||
        width >= occupiedCellCount / height
      ) {
        for (const contents of level.cells.values()) {
          this.appendOverlapping(contents, minX, minY, maxX, maxY, result);
        }
        continue;
      }

      for (let cellX = minCellX; ; cellX += 1) {
        for (let cellY = minCellY; ; cellY += 1) {
          const contents = level.cells.get(cellKey(cellX, cellY));
          if (contents !== undefined) {
            this.appendOverlapping(contents, minX, minY, maxX, maxY, result);
          }
          if (cellY === maxCellY) break;
        }
        if (cellX === maxCellX) break;
      }
    }
    return result;
  }

  private appendOverlapping(
    contents: CellContents,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    result: ItemType[],
  ): void {
    if (typeof contents === "number") {
      const entry = this.entries[contents];
      if (overlaps(entry, minX, minY, maxX, maxY)) {
        result.push(entry.item);
      }
      return;
    }

    for (const entryIndex of contents) {
      const entry = this.entries[entryIndex];
      if (overlaps(entry, minX, minY, maxX, maxY)) {
        result.push(entry.item);
      }
    }
  }
}

export function spatialEntry<ItemType>(
  item: ItemType,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): SpatialEntry<ItemType> {
  return { item, minX, minY, maxX, maxY };
}
