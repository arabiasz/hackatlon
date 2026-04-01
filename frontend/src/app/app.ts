import { CommonModule, DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import {
  DependencyEdge,
  DependencyGraphRequest,
  DependencyGraphResponse,
  DependencyGraphSummary,
  DependencyNode,
  DependencyNodeType
} from './models/dependency-graph';
import { DependencyGraphCytoscapeComponent } from './components/dependency-graph-cytoscape/dependency-graph-cytoscape';
import { DependencyGraphViewComponent } from './components/dependency-graph-view/dependency-graph-view';
import { DependencyApiService, ExportFormat } from './services/dependency-api.service';
import { buildGraphIndex, edgesForNode } from './utils/graph-index';

type LegendItem = {
  type: DependencyNodeType;
  label: string;
  note: string;
};

type SummaryTile = {
  label: string;
  value: string;
  tone: 'ink' | 'rust' | 'teal' | 'gold';
};

type GraphRenderer = 'atlas' | 'cytoscape';

type RelatedEdgeViewModel = {
  edge: DependencyEdge;
  direction: 'out' | 'in';
  otherNode: DependencyNode | undefined;
};

@Component({
  selector: 'app-root',
  imports: [
    CommonModule,
    FormsModule,
    DatePipe,
    DependencyGraphViewComponent,
    DependencyGraphCytoscapeComponent
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  private readonly api = inject(DependencyApiService);

  protected readonly proceduresText = signal('');
  protected readonly includeTransitive = signal(true);
  protected readonly maxDepth = signal(4);
  protected readonly graph = signal<DependencyGraphResponse | null>(null);
  protected readonly selectedNodeId = signal<string | null>(null);
  protected readonly graphRenderer = signal<GraphRenderer>('cytoscape');
  protected readonly loading = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly exportInProgress = signal<ExportFormat | null>(null);
  protected readonly legendItems: LegendItem[] = [
    { type: 'Procedure', label: 'Procedure', note: 'węzeł wykonywalny, może otwierać kolejne zależności' },
    { type: 'Table', label: 'Table', note: 'docelowy obiekt danych bezpośrednio używany przez procedurę' },
    { type: 'View', label: 'View', note: 'warstwa pośrednia, oznaczana jako potencjalny punkt kontroli' },
    { type: 'Function', label: 'Function', note: 'logika współdzielona, zwykle pomocnicza dla zapytań' },
    { type: 'Synonym', label: 'Synonym', note: 'alias do innego obiektu, może ukrywać faktyczny punkt dostępu' },
    { type: 'External', label: 'External', note: 'obiekt spoza bieżącego kontekstu bazy lub serwera' },
    { type: 'Unknown', label: 'Unknown', note: 'metadane nie rozwiązały obiektu wprost' }
  ];
  private readonly allLegendTypes = this.legendItems.map((item) => item.type);
  protected readonly activeNodeTypes = signal<DependencyNodeType[]>([...this.allLegendTypes]);

  protected readonly summaryTiles = computed<SummaryTile[]>(() => {
    const summary = this.graph()?.summary;

    return [
      { label: 'Procedures', value: `${summary?.requestedProcedures ?? 0}`, tone: 'ink' },
      { label: 'Nodes', value: `${summary?.nodes ?? 0}`, tone: 'teal' },
      { label: 'Edges', value: `${summary?.edges ?? 0}`, tone: 'gold' },
      { label: 'Check Hints', value: `${summary?.permissionHints ?? 0}`, tone: 'rust' }
    ];
  });

  protected readonly filteredGraph = computed<DependencyGraphResponse | null>(() => {
    const graph = this.graph();
    if (!graph) {
      return null;
    }

    return this.filterGraph(graph, this.activeNodeTypes());
  });
  protected readonly graphIndex = computed(() => buildGraphIndex(this.filteredGraph()));

  protected readonly hasGraphResult = computed(() => this.graph() !== null);
  protected readonly hasUnfilteredGraph = computed(() => (this.graph()?.nodes.length ?? 0) > 0);
  protected readonly hasInactiveLegendFilters = computed(
    () => this.activeNodeTypes().length < this.legendItems.length
  );

  protected readonly selectedNode = computed(() => {
    const graph = this.filteredGraph();
    const selectedNodeId = this.selectedNodeId();

    if (!graph?.nodes.length) {
      return null;
    }

    return (selectedNodeId ? this.graphIndex().nodesById.get(selectedNodeId) : undefined) ?? graph.nodes[0];
  });

  protected readonly relatedEdges = computed(() => {
    const selectedNode = this.selectedNode();
    const graphIndex = this.graphIndex();

    if (!selectedNode) {
      return [] as RelatedEdgeViewModel[];
    }

    return edgesForNode(graphIndex, selectedNode.id)
      .map<RelatedEdgeViewModel>((edge) => {
        const otherNodeId = edge.sourceId === selectedNode.id ? edge.targetId : edge.sourceId;
        const otherNode = graphIndex.nodesById.get(otherNodeId);

        return {
          edge,
          direction: edge.sourceId === selectedNode.id ? 'out' : 'in',
          otherNode
        };
      })
      .sort((left, right) => {
        const directionDelta = left.direction.localeCompare(right.direction);
        if (directionDelta !== 0) {
          return directionDelta;
        }

        return (left.otherNode?.fullName ?? left.edge.id).localeCompare(right.otherNode?.fullName ?? right.edge.id);
      });
  });

  protected readonly hasGraph = computed(() => (this.filteredGraph()?.nodes.length ?? 0) > 0);
  protected readonly procedureCount = computed(() => this.parseProcedures(this.proceduresText()).length);
  protected readonly navigableNodes = computed(() => this.buildNavigableNodes(this.filteredGraph()));
  protected readonly selectedNodePosition = computed(() => {
    const selectedNode = this.selectedNode();
    if (!selectedNode) {
      return -1;
    }

    return this.navigableNodes().findIndex((node) => node.id === selectedNode.id);
  });
  protected readonly canSelectPreviousNode = computed(() => this.selectedNodePosition() > 0);
  protected readonly canSelectNextNode = computed(() => {
    const index = this.selectedNodePosition();
    return index >= 0 && index < this.navigableNodes().length - 1;
  });

  protected async analyze(): Promise<void> {
    const request = this.buildRequest();
    if (request.procedures.length === 0) {
      this.errorMessage.set('Podaj co najmniej jedną procedurę, np. dbo.usp_PenaltySummary.');
      this.graph.set(null);
      return;
    }

    this.loading.set(true);
    this.errorMessage.set('');

    try {
      const response = await firstValueFrom(this.api.getDependencies(request));
      this.graph.set(response);
      this.selectedNodeId.set(response.nodes[0]?.id ?? null);
    } catch (error) {
      this.graph.set(null);
      this.selectedNodeId.set(null);
      this.errorMessage.set(this.describeError(error));
    } finally {
      this.loading.set(false);
    }
  }

  protected async exportGraph(format: ExportFormat): Promise<void> {
    const request = this.buildRequest();
    if (!this.graph() && request.procedures.length === 0) {
      this.errorMessage.set('Eksport wymaga listy procedur do analizy.');
      return;
    }

    this.exportInProgress.set(format);
    this.errorMessage.set('');

    try {
      const file = this.graph()
        ? this.createExportBlob(this.filteredGraph() ?? this.graph()!, format)
        : await firstValueFrom(this.api.exportDependencies(request, format));
      const objectUrl = URL.createObjectURL(file);
      const link = document.createElement('a');

      link.href = objectUrl;
      link.download = `dependency-graph.${format}`;
      link.click();

      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      this.errorMessage.set(this.describeError(error));
    } finally {
      this.exportInProgress.set(null);
    }
  }

  protected selectNode(nodeId: string): void {
    this.selectedNodeId.set(nodeId);
  }

  protected selectPreviousNode(): void {
    const index = this.selectedNodePosition();
    if (index <= 0) {
      return;
    }

    this.selectedNodeId.set(this.navigableNodes()[index - 1].id);
  }

  protected selectNextNode(): void {
    const index = this.selectedNodePosition();
    const nodes = this.navigableNodes();
    if (index < 0 || index >= nodes.length - 1) {
      return;
    }

    this.selectedNodeId.set(nodes[index + 1].id);
  }

  protected selectRelatedNode(relation: RelatedEdgeViewModel): void {
    if (!relation.otherNode) {
      return;
    }

    this.selectedNodeId.set(relation.otherNode.id);
  }

  protected setGraphRenderer(renderer: GraphRenderer): void {
    this.graphRenderer.set(renderer);
  }

  protected isGraphRenderer(renderer: GraphRenderer): boolean {
    return this.graphRenderer() === renderer;
  }

  protected toggleLegendType(type: DependencyNodeType): void {
    const activeNodeTypes = this.activeNodeTypes();

    if (activeNodeTypes.includes(type)) {
      this.activeNodeTypes.set(activeNodeTypes.filter((activeType) => activeType !== type));
      return;
    }

    this.activeNodeTypes.set([...activeNodeTypes, type]);
  }

  protected isLegendTypeActive(type: DependencyNodeType): boolean {
    return this.activeNodeTypes().includes(type);
  }

  protected resetLegendFilters(): void {
    this.activeNodeTypes.set([...this.allLegendTypes]);
  }

  protected setMaxDepth(value: number): void {
    this.maxDepth.set(Math.min(10, Math.max(1, value)));
  }

  protected nodeTone(type: DependencyNodeType): string {
    switch (type) {
      case 'Procedure':
        return 'procedure';
      case 'Table':
        return 'table';
      case 'View':
        return 'view';
      case 'Function':
        return 'function';
      case 'Synonym':
      case 'External':
        return 'external';
      default:
        return 'unknown';
    }
  }

  protected nodeTypeLabel(type: DependencyNodeType): string {
    return type.toUpperCase();
  }

  protected isBusy(format: ExportFormat): boolean {
    return this.exportInProgress() === format;
  }

  private buildRequest(): DependencyGraphRequest {
    return {
      procedures: this.parseProcedures(this.proceduresText()),
      includeTransitive: this.includeTransitive(),
      maxDepth: this.maxDepth()
    };
  }

  private parseProcedures(rawValue: string): string[] {
    return rawValue
      .split(/\r?\n|,/)
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
  }

  private filterGraph(
    graph: DependencyGraphResponse,
    activeNodeTypes: readonly DependencyNodeType[]
  ): DependencyGraphResponse {
    const visibleTypes = new Set(activeNodeTypes);
    const nodes = graph.nodes.filter((node) => visibleTypes.has(node.type));
    const visibleNodeIds = new Set(nodes.map((node) => node.id));
    const edges = graph.edges.filter(
      (edge) => visibleNodeIds.has(edge.sourceId) && visibleNodeIds.has(edge.targetId)
    );
    let permissionHints = 0;
    let maxObservedDepth = 0;

    for (const node of nodes) {
      if (node.requiresPermissionCheck) {
        permissionHints += 1;
      }

      if (node.depth > maxObservedDepth) {
        maxObservedDepth = node.depth;
      }
    }

    const summary: DependencyGraphSummary = {
      ...graph.summary,
      nodes: nodes.length,
      edges: edges.length,
      permissionHints,
      maxObservedDepth
    };

    return {
      ...graph,
      nodes,
      edges,
      summary
    };
  }

  private createExportBlob(graph: DependencyGraphResponse, format: ExportFormat): Blob {
    if (format === 'json') {
      return new Blob([JSON.stringify(graph, null, 2)], { type: 'application/json' });
    }

    return new Blob([this.toCsv(graph)], { type: 'text/csv;charset=utf-8' });
  }

  private toCsv(graph: DependencyGraphResponse): string {
    const nodeIndex = new Map(graph.nodes.map((node) => [node.id, node]));
    const lines = [
      'source,target,sourceType,targetType,depth,isTransitive,targetRequiresPermissionCheck,permissionHints'
    ];

    for (const edge of graph.edges) {
      const source = nodeIndex.get(edge.sourceId);
      const target = nodeIndex.get(edge.targetId);
      if (!source || !target) {
        continue;
      }

      lines.push(
        [
          this.escapeCsv(source.fullName),
          this.escapeCsv(target.fullName),
          this.escapeCsv(source.type),
          this.escapeCsv(target.type),
          `${edge.depth}`,
          edge.isTransitive ? 'True' : 'False',
          target.requiresPermissionCheck ? 'True' : 'False',
          this.escapeCsv(target.permissionHints.join(' | '))
        ].join(',')
      );
    }

    return `${lines.join('\n')}\n`;
  }

  private buildNavigableNodes(graph: DependencyGraphResponse | null) {
    if (!graph) {
      return [];
    }

    return [...graph.nodes].sort((left, right) => {
      const depthDelta = left.depth - right.depth;
      if (depthDelta !== 0) {
        return depthDelta;
      }

      const entryDelta = Number(right.isEntryPoint) - Number(left.isEntryPoint);
      if (entryDelta !== 0) {
        return entryDelta;
      }

      const typeDelta = left.type.localeCompare(right.type);
      return typeDelta !== 0 ? typeDelta : left.fullName.localeCompare(right.fullName);
    });
  }

  private escapeCsv(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
  }

  private describeError(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (typeof error.error === 'string' && error.error.trim().length > 0) {
        return error.error;
      }

      return `Backend returned ${error.status || 'an error'} while building the dependency graph.`;
    }

    return 'Nie udało się pobrać zależności. Sprawdź backend i połączenie z SQL Server.';
  }
}
