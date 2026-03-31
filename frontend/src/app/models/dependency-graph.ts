export type DependencyNodeType =
  | 'Procedure'
  | 'Table'
  | 'View'
  | 'Function'
  | 'Synonym'
  | 'External'
  | 'Unknown';

export interface DependencyGraphRequest {
  procedures: string[];
  includeTransitive: boolean;
  maxDepth: number;
}

export interface DependencyGraphResponse {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
  summary: DependencyGraphSummary;
  generatedAtUtc: string;
}

export interface DependencyGraphSummary {
  requestedProcedures: number;
  resolvedProcedures: number;
  nodes: number;
  edges: number;
  permissionHints: number;
  maxObservedDepth: number;
}

export interface DependencyNode {
  id: string;
  database: string;
  schema: string;
  name: string;
  fullName: string;
  type: DependencyNodeType;
  sourceType: string;
  depth: number;
  isEntryPoint: boolean;
  isUnresolved: boolean;
  requiresPermissionCheck: boolean;
  permissionHints: string[];
}

export interface DependencyEdge {
  id: string;
  sourceId: string;
  targetId: string;
  isTransitive: boolean;
  depth: number;
}
