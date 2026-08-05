import type { GraphData } from "./graph/types";

export interface ExampleGraphDefinition {
  slug: string;
  name: string;
  description: string;
  create: () => GraphData;
}

interface ExampleNode {
  id: number;
  label: string;
  color: string;
}

type ExampleEdge = [
  sourceId: number,
  sourcePort: number,
  targetId: number,
  targetPort: number,
];

interface ExampleSubgraph {
  nodeId: number;
  inId: number;
  outId: number;
}

const COLORS = ["#6aa0ff", "#6ad9a0", "#ffb86a", "#d78bff", "#ff7d8a"];

function nextExampleNodeId(nodes: ExampleNode[]): number {
  const lastNode = nodes[nodes.length - 1];
  return lastNode ? lastNode.id + 1 : 1;
}

function createGraph(
  nodes: ExampleNode[],
  edges: ExampleEdge[],
  subgraphs: ExampleSubgraph[] = [],
): GraphData {
  const strings = [""];
  const stringIndex = new Map<string, number>();
  const intern = (value: string): number => {
    const existing = stringIndex.get(value);
    if (existing !== undefined) return existing;
    const index = strings.length;
    strings.push(value);
    stringIndex.set(value, index);
    return index;
  };

  return {
    strings,
    subgraphs: subgraphs.flatMap((subgraph) => [
      subgraph.nodeId,
      subgraph.inId,
      subgraph.outId,
    ]),
    nodes: nodes.flatMap((node) => [
      node.id,
      intern(node.label),
      intern(node.color),
    ]),
    edges: edges.flat(),
  };
}

function appendNestedCompound(
  nodes: ExampleNode[],
  edges: ExampleEdge[],
  subgraphs: ExampleSubgraph[],
  attachSourceId: number,
  label: string,
  attachSourcePort = 0,
): number {
  const parentId = nextExampleNodeId(nodes);
  const outerEntryId = parentId + 1;
  const innerParentId = parentId + 2;
  const innerEntryId = parentId + 3;
  const innerCoreId = parentId + 4;
  const innerExitId = parentId + 5;
  const outerExitId = parentId + 6;

  nodes.push(
    { id: parentId, label, color: COLORS[0] },
    { id: outerEntryId, label: `${label} entry`, color: COLORS[1] },
    { id: innerParentId, label: `${label} nested group`, color: COLORS[2] },
    { id: innerEntryId, label: `${label} nested entry`, color: COLORS[3] },
    { id: innerCoreId, label: `${label} nested core`, color: COLORS[4] },
    { id: innerExitId, label: `${label} nested exit`, color: COLORS[3] },
    { id: outerExitId, label: `${label} exit`, color: COLORS[1] },
  );

  edges.push(
    [attachSourceId, attachSourcePort, parentId, 0],
    [outerEntryId, 0, innerParentId, 0],
    [innerParentId, 0, outerExitId, 0],
    [innerEntryId, 0, innerCoreId, 0],
    [innerCoreId, 0, innerExitId, 0],
  );
  subgraphs.push(
    { nodeId: parentId, inId: outerEntryId, outId: outerExitId },
    { nodeId: innerParentId, inId: innerEntryId, outId: innerExitId },
  );
  return parentId;
}

function createWideFanOut(): GraphData {
  const leafCount = 20;
  const nodes: ExampleNode[] = [{ id: 1, label: "Source", color: COLORS[0] }];
  const edges: ExampleEdge[] = [];
  const subgraphs: ExampleSubgraph[] = [];
  const compoundParentIds: number[] = [];
  for (let groupIndex = 0; groupIndex < 2; groupIndex += 1) {
    compoundParentIds.push(
      appendNestedCompound(
        nodes,
        edges,
        subgraphs,
        1,
        `Wide group ${groupIndex + 1}`,
      ),
    );
  }
  const workerIds: number[] = [];
  for (let leafIndex = 0; leafIndex < leafCount; leafIndex += 1) {
    const nodeId = nextExampleNodeId(nodes);
    workerIds.push(nodeId);
    nodes.push({
      id: nodeId,
      label: `Worker ${String(leafIndex + 1).padStart(2, "0")}`,
      color: COLORS[(leafIndex + 1) % COLORS.length],
    });
    edges.push([1, leafIndex, nodeId, 0]);
  }
  const sinkId = nodes[nodes.length - 1].id + 1;
  nodes.push({ id: sinkId, label: "Collector", color: COLORS[2] });
  for (const workerId of workerIds) {
    edges.push([workerId, 0, sinkId, workerId - workerIds[0]]);
  }
  for (const parentId of compoundParentIds) {
    edges.push([parentId, 0, sinkId, parentId - compoundParentIds[0]]);
  }
  return createGraph(nodes, edges, subgraphs);
}

function createDeepPipeline(): GraphData {
  const stageCount = 72;
  const nodes: ExampleNode[] = [];
  const edges: ExampleEdge[] = [];
  const subgraphs: ExampleSubgraph[] = [];
  const stageIds: number[] = [];
  let previousId: number | null = null;
  for (let stageIndex = 0; stageIndex < stageCount; stageIndex += 1) {
    const stageId = nextExampleNodeId(nodes);
    nodes.push({
      id: stageId,
      label: `Stage ${String(stageIndex + 1).padStart(2, "0")}`,
      color: COLORS[stageIndex % COLORS.length],
    });
    if (previousId !== null) edges.push([previousId, 0, stageId, 0]);
    stageIds.push(stageId);
    if (stageIndex === 17 || stageIndex === 53) {
      previousId = appendNestedCompound(
        nodes,
        edges,
        subgraphs,
        stageId,
        `Deep stage ${stageIndex + 1} group`,
      );
    } else {
      previousId = stageId;
    }
  }
  for (let stageIndex = 0; stageIndex + 6 < stageCount; stageIndex += 1) {
    if (stageIndex % 4 === 0) {
      edges.push([stageIds[stageIndex], 1, stageIds[stageIndex + 6], 1]);
    }
  }
  return createGraph(nodes, edges, subgraphs);
}

function createCrossingWeave(): GraphData {
  const layerCount = 6;
  const layerWidth = 8;
  const nodes: ExampleNode[] = [];
  const edges: ExampleEdge[] = [];
  const subgraphs: ExampleSubgraph[] = [];
  const layers: number[][] = [];
  const compoundSlots = new Set(["1:1", "4:6"]);

  for (let layer = 0; layer < layerCount; layer += 1) {
    const layerNodes: number[] = [];
    for (let position = 0; position < layerWidth; position += 1) {
      if (compoundSlots.has(`${layer}:${position}`)) {
        const previousLayer = layers[layer - 1];
        const attachSourceId = previousLayer[position] ?? previousLayer[0];
        layerNodes.push(
          appendNestedCompound(
            nodes,
            edges,
            subgraphs,
            attachSourceId,
            `Weave L${layer + 1} position ${position + 1} group`,
          ),
        );
      } else {
        const nodeId = nextExampleNodeId(nodes);
        nodes.push({
          id: nodeId,
          label: `L${layer + 1} / ${position + 1}`,
          color: COLORS[(layer + position) % COLORS.length],
        });
        layerNodes.push(nodeId);
      }
    }
    layers.push(layerNodes);
  }

  for (let layer = 0; layer < layerCount - 1; layer += 1) {
    for (let position = 0; position < layerWidth; position += 1) {
      const sourceId = layers[layer][position];
      const firstTarget = (layerWidth - 1 - position + layer) % layerWidth;
      const secondTarget = (firstTarget + 3) % layerWidth;
      edges.push([sourceId, 0, layers[layer + 1][firstTarget], position]);
      edges.push([
        sourceId,
        1,
        layers[layer + 1][secondTarget],
        position + layerWidth,
      ]);
    }
    if (layer + 2 < layerCount) {
      for (let position = 0; position < layerWidth; position += 2) {
        edges.push([
          layers[layer][position],
          2,
          layers[layer + 2][(position + layer + 2) % layerWidth],
          2,
        ]);
      }
    }
  }
  return createGraph(nodes, edges, subgraphs);
}

function createBalancedCascade(): GraphData {
  const depth = 7;
  const nodes: ExampleNode[] = [];
  const edges: ExampleEdge[] = [];
  const subgraphs: ExampleSubgraph[] = [];
  let currentLevel = [1];
  nodes.push({ id: 1, label: "Root", color: COLORS[0] });

  for (let level = 1; level <= depth; level += 1) {
    const nextLevel: number[] = [];
    for (
      let parentIndex = 0;
      parentIndex < currentLevel.length;
      parentIndex += 1
    ) {
      const parentId = currentLevel[parentIndex];
      for (let branch = 0; branch < 2; branch += 1) {
        const isCompound =
          parentIndex === 0 &&
          ((level === 2 && branch === 0) || (level === 5 && branch === 1));
        const childId = isCompound
          ? appendNestedCompound(
              nodes,
              edges,
              subgraphs,
              parentId,
              `Cascade level ${level} ${branch === 0 ? "A" : "B"} group`,
              branch,
            )
          : nextExampleNodeId(nodes);
        nextLevel.push(childId);
        if (!isCompound) {
          nodes.push({
            id: childId,
            label: `Level ${level} / ${branch === 0 ? "A" : "B"}`,
            color: COLORS[(level + branch) % COLORS.length],
          });
          edges.push([parentId, branch, childId, 0]);
        }
      }
    }
    currentLevel = nextLevel;
  }
  return createGraph(nodes, edges, subgraphs);
}

const EXAMPLE_GRAPHS: readonly ExampleGraphDefinition[] = [
  {
    slug: "wide-fan-out",
    name: "Wide fan-out",
    description: "A broad producer-to-workers pipeline with nested groups.",
    create: createWideFanOut,
  },
  {
    slug: "deep-pipeline",
    name: "Deep pipeline",
    description: "A tall chain with a nested stage group.",
    create: createDeepPipeline,
  },
  {
    slug: "crossing-weave",
    name: "Crossing weave",
    description: "Dense layered crossings with nested compound scopes.",
    create: createCrossingWeave,
  },
  {
    slug: "balanced-cascade",
    name: "Balanced cascade",
    description: "A branching cascade with a nested group.",
    create: createBalancedCascade,
  },
];

export function getExampleGraphDefinitions(): readonly ExampleGraphDefinition[] {
  return EXAMPLE_GRAPHS;
}
