import { DependencyEdge, DependencyGraphResponse, DependencyNode } from '../models/dependency-graph';

export type GraphIndex = {
  nodesById: ReadonlyMap<string, DependencyNode>;
  edgesByNodeId: ReadonlyMap<string, readonly DependencyEdge[]>;
  neighborIdsByNodeId: ReadonlyMap<string, readonly string[]>;
};

const EMPTY_EDGE_LIST: readonly DependencyEdge[] = [];
const EMPTY_NEIGHBOR_LIST: readonly string[] = [];

export const EMPTY_GRAPH_INDEX: GraphIndex = {
  nodesById: new Map<string, DependencyNode>(),
  edgesByNodeId: new Map<string, readonly DependencyEdge[]>(),
  neighborIdsByNodeId: new Map<string, readonly string[]>()
};

export function buildGraphIndex(graph: DependencyGraphResponse | null): GraphIndex {
  if (!graph) {
    return EMPTY_GRAPH_INDEX;
  }

  const nodesById = new Map(graph.nodes.map((node) => [node.id, node] as const));
  const edgesByNodeId = new Map<string, DependencyEdge[]>();
  const neighborIdsByNodeId = new Map<string, Set<string>>();

  for (const edge of graph.edges) {
    appendToList(edgesByNodeId, edge.sourceId, edge);
    appendToList(edgesByNodeId, edge.targetId, edge);
    appendToSet(neighborIdsByNodeId, edge.sourceId, edge.targetId);
    appendToSet(neighborIdsByNodeId, edge.targetId, edge.sourceId);
  }

  return {
    nodesById,
    edgesByNodeId,
    neighborIdsByNodeId: new Map(
      [...neighborIdsByNodeId.entries()].map(([nodeId, neighborIds]) => [nodeId, [...neighborIds]] as const)
    )
  };
}

export function edgesForNode(index: GraphIndex, nodeId: string | null | undefined): readonly DependencyEdge[] {
  if (!nodeId) {
    return EMPTY_EDGE_LIST;
  }

  return index.edgesByNodeId.get(nodeId) ?? EMPTY_EDGE_LIST;
}

export function neighborIdsForNode(index: GraphIndex, nodeId: string | null | undefined): readonly string[] {
  if (!nodeId) {
    return EMPTY_NEIGHBOR_LIST;
  }

  return index.neighborIdsByNodeId.get(nodeId) ?? EMPTY_NEIGHBOR_LIST;
}

function appendToList(map: Map<string, DependencyEdge[]>, key: string, edge: DependencyEdge): void {
  const list = map.get(key);
  if (list) {
    list.push(edge);
    return;
  }

  map.set(key, [edge]);
}

function appendToSet(map: Map<string, Set<string>>, key: string, value: string): void {
  const entries = map.get(key);
  if (entries) {
    entries.add(value);
    return;
  }

  map.set(key, new Set([value]));
}
