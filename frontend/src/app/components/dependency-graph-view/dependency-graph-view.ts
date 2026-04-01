import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  input,
  output,
  signal,
  viewChild
} from '@angular/core';
import { DependencyEdge, DependencyGraphResponse, DependencyNode, DependencyNodeType } from '../../models/dependency-graph';
import { EMPTY_GRAPH_INDEX, GraphIndex, neighborIdsForNode } from '../../utils/graph-index';

type GraphPoint = {
  node: DependencyNode;
  x: number;
  y: number;
  width: number;
  height: number;
};

type GraphLayout = {
  width: number;
  height: number;
  nodes: GraphPoint[];
  nodeIndex: ReadonlyMap<string, GraphPoint>;
  edges: readonly DependencyEdge[];
};

type RenderGraph = {
  nodes: readonly DependencyNode[];
  edges: readonly DependencyEdge[];
};

type FocusModeSummary = {
  selectedNodeName: string;
  visibleEdges: number;
  hiddenEdges: number;
  totalEdges: number;
  visibleNodes: number;
  hiddenNodes: number;
  totalNodes: number;
};

@Component({
  selector: 'app-dependency-graph-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  templateUrl: './dependency-graph-view.html',
  styleUrl: './dependency-graph-view.scss'
})
export class DependencyGraphViewComponent {
  readonly graph = input<DependencyGraphResponse | null>(null);
  readonly graphIndex = input<GraphIndex>(EMPTY_GRAPH_INDEX);
  readonly selectedNodeId = input<string | null>(null);
  readonly nodeSelected = output<string>();

  private readonly graphShellRef = viewChild<ElementRef<HTMLDivElement>>('graphShell');
  private readonly graphCanvasRef = viewChild<ElementRef<HTMLCanvasElement>>('graphCanvas');
  private readonly viewportWidth = signal(0);
  private readonly focusModeEdgeThreshold = 10;

  protected readonly selectedNode = computed(() => {
    const graph = this.graph();
    if (!graph?.nodes.length) {
      return null;
    }

    const selectedNodeId = this.selectedNodeId();
    return (selectedNodeId ? this.graphIndex().nodesById.get(selectedNodeId) : undefined) ?? graph.nodes[0];
  });

  protected readonly focusModeSummary = computed<FocusModeSummary | null>(() => {
    const graph = this.graph();
    const selectedNode = this.selectedNode();
    const renderGraph = this.renderGraph();

    if (!graph || !selectedNode || graph.edges.length <= this.focusModeEdgeThreshold) {
      return null;
    }

    return {
      selectedNodeName: selectedNode.fullName,
      visibleEdges: renderGraph.edges.length,
      hiddenEdges: graph.edges.length - renderGraph.edges.length,
      totalEdges: graph.edges.length,
      visibleNodes: renderGraph.nodes.length,
      hiddenNodes: graph.nodes.length - renderGraph.nodes.length,
      totalNodes: graph.nodes.length
    };
  });

  protected readonly graphLayout = computed<GraphLayout>(() =>
    this.buildGraphLayout(this.renderGraph(), this.viewportWidth())
  );

  constructor() {
    effect((onCleanup) => {
      const graphShell = this.graphShellRef()?.nativeElement;
      if (!graphShell) {
        this.viewportWidth.set(0);
        return;
      }

      const syncWidth = () => this.viewportWidth.set(graphShell.clientWidth);
      syncWidth();

      if (typeof ResizeObserver === 'undefined') {
        return;
      }

      const resizeObserver = new ResizeObserver(() => syncWidth());
      resizeObserver.observe(graphShell);
      onCleanup(() => resizeObserver.disconnect());
    });

    effect((onCleanup) => {
      const canvas = this.graphCanvasRef()?.nativeElement;
      const layout = this.graphLayout();

      if (!canvas) {
        return;
      }

      if (layout.width === 0 || layout.height === 0) {
        canvas.width = 0;
        canvas.height = 0;
        return;
      }

      const frameId = requestAnimationFrame(() => this.paintEdges(canvas, layout));
      onCleanup(() => cancelAnimationFrame(frameId));
    });

    effect((onCleanup) => {
      const graphShell = this.graphShellRef()?.nativeElement;
      const layout = this.graphLayout();
      const selectedNode = this.selectedNode();

      if (!graphShell || !selectedNode) {
        return;
      }

      const point = layout.nodeIndex.get(selectedNode.id);
      if (!point) {
        return;
      }

      const frameId = requestAnimationFrame(() => {
        const targetLeft = point.x - Math.max(24, (graphShell.clientWidth - point.width) / 2);
        const targetTop = point.y - Math.max(24, (graphShell.clientHeight - point.height) / 2);
        const maxLeft = Math.max(0, graphShell.scrollWidth - graphShell.clientWidth);
        const maxTop = Math.max(0, graphShell.scrollHeight - graphShell.clientHeight);

        graphShell.scrollTo({
          left: this.clamp(targetLeft, 0, maxLeft),
          top: this.clamp(targetTop, 0, maxTop),
          behavior: 'smooth'
        });
      });

      onCleanup(() => cancelAnimationFrame(frameId));
    });
  }

  protected selectNode(nodeId: string): void {
    this.nodeSelected.emit(nodeId);
  }

  protected trackNode(_: number, point: GraphPoint): string {
    return point.node.id;
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

  private readonly renderGraph = computed<RenderGraph>(() => {
    const graph = this.graph();
    if (!graph) {
      return { nodes: [], edges: [] };
    }

    if (graph.edges.length <= this.focusModeEdgeThreshold) {
      return { nodes: graph.nodes, edges: graph.edges };
    }

    const selectedNode = this.selectedNode();
    if (!selectedNode) {
      return { nodes: graph.nodes, edges: graph.edges };
    }

    const visibleNodeIds = new Set([selectedNode.id, ...neighborIdsForNode(this.graphIndex(), selectedNode.id)]);

    return {
      nodes: graph.nodes.filter((node) => visibleNodeIds.has(node.id)),
      edges: graph.edges.filter(
        (edge) => visibleNodeIds.has(edge.sourceId) && visibleNodeIds.has(edge.targetId)
      )
    };
  });

  private buildGraphLayout(renderGraph: RenderGraph, viewportWidth: number): GraphLayout {
    if (renderGraph.nodes.length === 0) {
      return { width: 0, height: 0, nodes: [], nodeIndex: new Map(), edges: [] };
    }

    const groupedByDepth = new Map<number, DependencyNode[]>();
    for (const node of renderGraph.nodes) {
      const column = groupedByDepth.get(node.depth) ?? [];
      column.push(node);
      groupedByDepth.set(node.depth, column);
    }

    const columns = [...groupedByDepth.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([depth, nodes]) => ({
        depth,
        nodes: [...nodes].sort((left, right) => {
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

    const nodeIndex = new Map(positionedNodes.map((point) => [point.node.id, point] as const));
    const contentWidth = padding + Math.max(...positionedNodes.map((point) => point.x + point.width));
    const contentHeight = padding + Math.max(...positionedNodes.map((point) => point.y + point.height));

    return {
      width: Math.max(viewportWidth, contentWidth),
      height: Math.max(300, contentHeight),
      nodes: positionedNodes,
      nodeIndex,
      edges: renderGraph.edges
    };
  }

  private paintEdges(canvas: HTMLCanvasElement, layout: GraphLayout): void {
    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }

    const devicePixelRatio = window.devicePixelRatio || 1;
    const scaledWidth = Math.max(1, Math.round(layout.width * devicePixelRatio));
    const scaledHeight = Math.max(1, Math.round(layout.height * devicePixelRatio));

    if (canvas.width !== scaledWidth || canvas.height !== scaledHeight) {
      canvas.width = scaledWidth;
      canvas.height = scaledHeight;
    }

    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    context.clearRect(0, 0, layout.width, layout.height);
    context.lineWidth = 2.5;
    context.lineCap = 'round';

    for (const edge of layout.edges) {
      const source = layout.nodeIndex.get(edge.sourceId);
      const target = layout.nodeIndex.get(edge.targetId);
      if (!source || !target) {
        continue;
      }

      const x1 = source.x + source.width;
      const y1 = source.y + source.height / 2;
      const x2 = target.x;
      const y2 = target.y + target.height / 2;
      const midX = (x1 + x2) / 2;

      context.beginPath();
      context.setLineDash(edge.isTransitive ? [8, 10] : []);
      context.strokeStyle = target.node.requiresPermissionCheck
        ? 'rgba(164, 77, 43, 0.4)'
        : 'rgba(19, 37, 36, 0.26)';
      context.moveTo(x1, y1);
      context.bezierCurveTo(midX, y1, midX, y2, x2, y2);
      context.stroke();
    }
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }
}
