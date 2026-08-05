// Each level indexes the same primitives; scale changes lookup granularity,
// not scene semantics.

interface TileEntry<ItemType> {
  item: ItemType;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface TileLevel {
  tileSize: number;
  cells: Map<string, Uint32Array>;
}

function tileKey(tileX: number, tileY: number): string {
  return `${tileX}:${tileY}`;
}

function overlaps(
  entry: TileEntry<unknown>,
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

export class TilePyramid<ItemType> {
  private readonly levels: TileLevel[];

  constructor(entries: readonly TileEntry<ItemType>[], baseTileSize: number) {
    if (!Number.isFinite(baseTileSize) || baseTileSize <= 0) {
      throw new Error("Tile size must be a positive finite number");
    }
    this.entries = entries;

    let minimumX = Infinity;
    let minimumY = Infinity;
    let maximumX = -Infinity;
    let maximumY = -Infinity;
    let maximumExtent = baseTileSize;
    for (const entry of entries) {
      minimumX = Math.min(minimumX, entry.minX);
      minimumY = Math.min(minimumY, entry.minY);
      maximumX = Math.max(maximumX, entry.maxX);
      maximumY = Math.max(maximumY, entry.maxY);
      maximumExtent = Math.max(
        maximumExtent,
        entry.maxX - entry.minX,
        entry.maxY - entry.minY,
      );
    }
    if (entries.length > 0) {
      maximumExtent = Math.max(
        maximumExtent,
        maximumX - minimumX,
        maximumY - minimumY,
      );
    }

    const tileSizes: number[] = [];
    for (let tileSize = baseTileSize; ; tileSize *= 2) {
      tileSizes.push(tileSize);
      if (tileSize >= maximumExtent || !Number.isSafeInteger(tileSize * 2)) {
        break;
      }
    }
    const mutableLevels = tileSizes.map((tileSize) => ({
      tileSize,
      cells: new Map<string, number[]>(),
    }));

    for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
      const entry = entries[entryIndex];
      for (const level of mutableLevels) {
        this.insert(level, entry, entryIndex);
      }
    }

    this.levels = mutableLevels.map((level) => ({
      tileSize: level.tileSize,
      cells: new Map(
        [...level.cells].map(([key, cell]) => [key, Uint32Array.from(cell)]),
      ),
    }));
  }

  query(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    viewportScale: number,
  ): ItemType[] {
    const levelIndex = Math.min(
      this.levels.length - 1,
      Math.max(0, Math.floor(Math.max(0, Math.log2(1 / viewportScale)))),
    );
    const level = this.levels[levelIndex];
    const minTileX = Math.floor(minX / level.tileSize);
    const minTileY = Math.floor(minY / level.tileSize);
    const maxTileX = Math.floor(maxX / level.tileSize);
    const maxTileY = Math.floor(maxY / level.tileSize);
    const seen = new Set<number>();
    const result: ItemType[] = [];

    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
        const entries = level.cells.get(tileKey(tileX, tileY));
        if (!entries) continue;
        for (const entryIndex of entries) {
          const entry = this.entries[entryIndex];
          if (
            seen.has(entryIndex) ||
            !overlaps(entry, minX, minY, maxX, maxY)
          ) {
            continue;
          }
          seen.add(entryIndex);
          result.push(entry.item);
        }
      }
    }
    return result;
  }

  private readonly entries: readonly TileEntry<ItemType>[];

  private insert(
    level: { tileSize: number; cells: Map<string, number[]> },
    entry: TileEntry<ItemType>,
    entryIndex: number,
  ): void {
    const minTileX = Math.floor(entry.minX / level.tileSize);
    const minTileY = Math.floor(entry.minY / level.tileSize);
    const maxTileX = Math.floor(entry.maxX / level.tileSize);
    const maxTileY = Math.floor(entry.maxY / level.tileSize);
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
        const key = tileKey(tileX, tileY);
        let cell = level.cells.get(key);
        if (!cell) {
          cell = [];
          level.cells.set(key, cell);
        }
        cell.push(entryIndex);
      }
    }
  }
}

export function tileEntry<ItemType>(
  item: ItemType,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): TileEntry<ItemType> {
  return { item, minX, minY, maxX, maxY };
}
