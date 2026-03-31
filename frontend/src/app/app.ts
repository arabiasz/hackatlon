import { CommonModule, DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import {
  DependencyEdge,
  DependencyGraphRequest,
  DependencyGraphResponse,
  DependencyNode,
  DependencyGraphSummary,
  DependencyNodeType
} from './models/dependency-graph';
import { DependencyApiService, ExportFormat } from './services/dependency-api.service';

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

type GraphPoint = {
  node: DependencyNode;
  x: number;
  y: number;
  width: number;
  height: number;
};

type GraphEdgePath = {
  edge: DependencyEdge;
  path: string;
  isAlert: boolean;
};

type GraphLayout = {
  width: number;
  height: number;
  nodes: GraphPoint[];
  edges: GraphEdgePath[];
};

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule, DatePipe],
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
  protected readonly loading = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly exportInProgress = signal<ExportFormat | null>(null);
  protected readonly graphShellRef = viewChild<ElementRef<HTMLDivElement>>('graphShell');
  private readonly graphViewportWidth = signal(0);
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

  constructor() {
    effect((onCleanup) => {
      const graphShell = this.graphShellRef()?.nativeElement;
      if (!graphShell) {
        this.graphViewportWidth.set(0);
        return;
      }

      const syncWidth = () => this.graphViewportWidth.set(graphShell.clientWidth);
      syncWidth();

      if (typeof ResizeObserver === 'undefined') {
        return;
      }

      const resizeObserver = new ResizeObserver(() => syncWidth());
      resizeObserver.observe(graphShell);
      onCleanup(() => resizeObserver.disconnect());
    });
  }

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

    return graph.nodes.find((node) => node.id === selectedNodeId) ?? graph.nodes[0];
  });

  protected readonly relatedEdges = computed(() => {
    const graph = this.filteredGraph();
    const selectedNode = this.selectedNode();

    if (!graph || !selectedNode) {
      return [];
    }

    return graph.edges
      .filter((edge) => edge.sourceId === selectedNode.id || edge.targetId === selectedNode.id)
      .map((edge) => {
        const otherNodeId = edge.sourceId === selectedNode.id ? edge.targetId : edge.sourceId;
        const otherNode = graph.nodes.find((node) => node.id === otherNodeId);

        return {
          edge,
          direction: edge.sourceId === selectedNode.id ? 'out' : 'in',
          otherNode
        };
      });
  });

  protected readonly graphLayout = computed(() => this.buildGraphLayout(this.filteredGraph(), this.graphViewportWidth()));
  protected readonly hasGraph = computed(() => (this.filteredGraph()?.nodes.length ?? 0) > 0);
  protected readonly procedureCount = computed(() => this.parseProcedures(this.proceduresText()).length);

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

  protected trackNode(_: number, point: GraphPoint): string {
    return point.node.id;
  }

  protected trackEdge(_: number, path: GraphEdgePath): string {
    return path.edge.id;
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
    const summary: DependencyGraphSummary = {
      ...graph.summary,
      nodes: nodes.length,
      edges: edges.length,
      permissionHints: nodes.filter((node) => node.requiresPermissionCheck).length,
      maxObservedDepth: nodes.length === 0 ? 0 : Math.max(...nodes.map((node) => node.depth))
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

  private escapeCsv(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
  }

  private buildGraphLayout(graph: DependencyGraphResponse | null, viewportWidth: number): GraphLayout {
    if (!graph?.nodes.length) {
      return { width: 0, height: 0, nodes: [], edges: [] };
    }

    const groupedByDepth = new Map<number, DependencyNode[]>();
    for (const node of graph.nodes) {
      const column = groupedByDepth.get(node.depth) ?? [];
      column.push(node);
      groupedByDepth.set(node.depth, column);
    }

    const columns = [...groupedByDepth.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([depth, nodes]) => ({
        depth,
        nodes: nodes.sort((left, right) => {
          const entryDelta = Number(right.isEntryPoint) - Number(left.isEntryPoint);
          if (entryDelta !== 0) {
            return entryDelta;
          }

          const typeDelta = left.type.localeCompare(right.type);
          return typeDelta !== 0 ? typeDelta : left.fullName.localeCompare(right.fullName);
        })
      }));

    const nodeWidth = 248;
    const nodeHeight = 104;
    const rowGap = 132;
    const padding = viewportWidth > 0 ? this.clamp(Math.round(viewportWidth * 0.06), 32, 76) : 76;
    const defaultColumnStep = 310;
    const minColumnStep = nodeWidth + 44;
    const columnStep =
      columns.length > 1 && viewportWidth > 0
        ? Math.max(
            minColumnStep,
            Math.floor((viewportWidth - padding * 2 - nodeWidth) / (columns.length - 1))
          )
        : defaultColumnStep;
    const positionedNodes: GraphPoint[] = [];

    columns.forEach((column, columnIndex) => {
      column.nodes.forEach((node, rowIndex) => {
        positionedNodes.push({
          node,
          x: padding + columnIndex * columnStep,
          y: padding + rowIndex * rowGap,
          width: nodeWidth,
          height: nodeHeight
        });
      });
    });

    const nodeIndex = new Map(positionedNodes.map((point) => [point.node.id, point]));
    const edgePaths: GraphEdgePath[] = graph.edges.flatMap((edge) => {
      const source = nodeIndex.get(edge.sourceId);
      const target = nodeIndex.get(edge.targetId);

      if (!source || !target) {
        return [];
      }

      const x1 = source.x + source.width;
      const y1 = source.y + source.height / 2;
      const x2 = target.x;
      const y2 = target.y + target.height / 2;
      const midX = (x1 + x2) / 2;

      return [{
        edge,
        path: `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`,
        isAlert: target.node.requiresPermissionCheck
      }];
    });

    const contentWidth = padding + Math.max(...positionedNodes.map((point) => point.x + point.width));
    const contentHeight = padding + Math.max(...positionedNodes.map((point) => point.y + point.height));
    const height = Math.max(300, contentHeight);
    const width = Math.max(viewportWidth, contentWidth);

    return { width, height, nodes: positionedNodes, edges: edgePaths };
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
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
