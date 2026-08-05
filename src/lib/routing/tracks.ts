function positiveOverlapLength(
  firstStart: number,
  firstEnd: number,
  secondStart: number,
  secondEnd: number,
): number {
  return Math.max(
    0,
    Math.min(firstEnd, secondEnd) - Math.max(firstStart, secondStart),
  );
}

type LaneCost = (laneIndex: number, intervalOverlap: number) => number;

export class TrackAllocator {
  private readonly lanes: { start: number; end: number }[][] = [];

  get laneCount(): number {
    return this.lanes.length;
  }

  reserve(
    start: number,
    end: number,
    maximumLaneCount: number,
    laneCost: LaneCost = (_laneIndex, intervalOverlap) => intervalOverlap,
  ): number {
    const min = Math.min(start, end);
    const max = Math.max(start, end);
    let selectedLane = -1;
    let selectedCost = Number.POSITIVE_INFINITY;
    for (let laneIndex = 0; laneIndex < maximumLaneCount; laneIndex += 1) {
      const lane = this.lanes[laneIndex] ?? [];
      let intervalOverlap = 0;
      for (const interval of lane) {
        intervalOverlap += positiveOverlapLength(
          min,
          max,
          interval.start,
          interval.end,
        );
      }
      const cost = laneCost(laneIndex, intervalOverlap);
      if (cost < selectedCost) {
        selectedLane = laneIndex;
        selectedCost = cost;
        if (selectedCost === 0) break;
      }
    }
    if (selectedLane < 0 || !Number.isFinite(selectedCost)) {
      throw new Error("Unable to allocate a routing track within capacity");
    }
    while (this.lanes.length <= selectedLane) this.lanes.push([]);
    this.lanes[selectedLane].push({ start: min, end: max });
    return selectedLane;
  }
}
