/**
 * Grid-hash spatial index for fast AABB queries.
 * Used for viewport culling and hit detection. Items are stored in grid cells;
 * queries return all items whose bounding box overlaps the query rectangle.
 */

interface SpatialEntry<T> {
  item: T;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// Multiplier must exceed the maximum cell-y value to avoid key collisions.
// 94_906_265 is floor(sqrt(MAX_SAFE_INTEGER)), so both cx and cy can reach
// this value without the product exceeding MAX_SAFE_INTEGER.
const CELL_MULTIPLIER = 94_906_265;

function cellKey(cellX: number, cellY: number): number {
  return cellX * CELL_MULTIPLIER + cellY;
}

function overlaps(
  entry: { minX: number; minY: number; maxX: number; maxY: number },
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

export class SpatialIndex<T> {
  private cellSize: number;
  private cells = new Map<number, SpatialEntry<T>[]>();

  constructor(cellSize: number) {
    this.cellSize = cellSize;
  }

  insert(
    item: T,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ): void {
    const entry: SpatialEntry<T> = { item, minX, minY, maxX, maxY };
    const cellMinX = Math.floor(minX / this.cellSize);
    const cellMinY = Math.floor(minY / this.cellSize);
    const cellMaxX = Math.floor(maxX / this.cellSize);
    const cellMaxY = Math.floor(maxY / this.cellSize);

    for (let cellX = cellMinX; cellX <= cellMaxX; cellX += 1) {
      for (let cellY = cellMinY; cellY <= cellMaxY; cellY += 1) {
        const key = cellKey(cellX, cellY);
        let bucket = this.cells.get(key);
        if (!bucket) {
          bucket = [];
          this.cells.set(key, bucket);
        }
        bucket.push(entry);
      }
    }
  }

  /**
   * Query all items whose bounding box overlaps the given rectangle.
   * Returns deduplicated results.
   */
  query(minX: number, minY: number, maxX: number, maxY: number): T[] {
    const cellMinX = Math.floor(minX / this.cellSize);
    const cellMinY = Math.floor(minY / this.cellSize);
    const cellMaxX = Math.floor(maxX / this.cellSize);
    const cellMaxY = Math.floor(maxY / this.cellSize);

    const seen = new Set<SpatialEntry<T>>();
    const results: T[] = [];

    for (let cellX = cellMinX; cellX <= cellMaxX; cellX += 1) {
      for (let cellY = cellMinY; cellY <= cellMaxY; cellY += 1) {
        this.collectFromBucket(
          cellKey(cellX, cellY),
          minX,
          minY,
          maxX,
          maxY,
          seen,
          results,
        );
      }
    }

    return results;
  }

  /** Collect matching entries from a single bucket, deduplicating via `seen`. */
  private collectFromBucket(
    key: number,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    seen: Set<SpatialEntry<T>>,
    results: T[],
  ): void {
    const bucket = this.cells.get(key);
    if (!bucket) {
      return;
    }
    for (const entry of bucket) {
      if (seen.has(entry)) {
        continue;
      }
      seen.add(entry);
      if (overlaps(entry, minX, minY, maxX, maxY)) {
        results.push(entry.item);
      }
    }
  }
}
