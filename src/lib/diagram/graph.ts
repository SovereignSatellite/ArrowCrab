export interface DiagramNode {
  readonly id: number;
  readonly label: string;
  readonly color: string;
  readonly inputPortCount: number;
  readonly outputPortCount: number;
  readonly subgraphs: readonly {
    readonly inId: number;
    readonly outId: number;
  }[];
}

export interface Edge {
  readonly edgeIndex: number;
  readonly sourceId: number;
  readonly sourcePort: number;
  readonly targetId: number;
  readonly targetPort: number;
}
