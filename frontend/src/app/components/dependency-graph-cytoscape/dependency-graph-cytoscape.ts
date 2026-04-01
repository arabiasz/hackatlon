import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  effect,
  input,
  OnDestroy,
  output,
  signal,
  viewChild
} from '@angular/core';
import cytoscape, { BoundingBox, Core, ElementDefinition, Layouts } from 'cytoscape';
import { DependencyGraphResponse } from '../../models/dependency-graph';
import { EMPTY_GRAPH_INDEX, GraphIndex } from '../../utils/graph-index';

type GraphLayoutMode = 'hierarchy' | 'radial' | 'organic';
type ViewportIntent = 'overview' | 'focus';
type ViewportMode = 'overview' | 'fit' | 'focus' | 'static';

type LayoutOption = {
  value: GraphLayoutMode;
  label: string;
  note: string;
};

const CYTOSCAPE_STYLES: cytoscape.StylesheetJson = [
  {
    selector: 'node',
    style: {
      shape: 'round-rectangle',
      width: 'label',
      height: 'label',
      padding: '16px',
      'background-color': '#fff9ef',
      'border-width': 1.5,
      'border-color': '#2f4945',
      'border-opacity': 0.14,
      label: 'data(displayLabel)',
      color: '#132524',
      'font-family': 'var(--font-body)',
      'font-size': 12,
      'font-weight': 600,
      'line-height': 1.24,
      'text-wrap': 'wrap',
      'text-max-width': '176px',
      'text-valign': 'center',
      'text-halign': 'center',
      'text-justification': 'center',
      'overlay-opacity': 0
    }
  },
  {
    selector: 'node[nodeType = "Procedure"]',
    style: {
      'background-color': '#fdf7eb'
    }
  },
  {
    selector: 'node[nodeType = "Table"]',
    style: {
      'background-color': '#ebf7f4'
    }
  },
  {
    selector: 'node[nodeType = "View"]',
    style: {
      'background-color': '#faeee4'
    }
  },
  {
    selector: 'node[nodeType = "Function"], node[nodeType = "Synonym"], node[nodeType = "External"]',
    style: {
      'background-color': '#f1edff'
    }
  },
  {
    selector: 'node[nodeType = "Unknown"]',
    style: {
      'background-color': '#ffefef'
    }
  },
  {
    selector: 'node[requiresPermissionCheck > 0]',
    style: {
      'border-color': '#a44d2b',
      'border-opacity': 0.42,
      'border-width': 2
    }
  },
  {
    selector: 'node[isEntryPoint > 0]',
    style: {
      'border-opacity': 0.34,
      'border-width': 2.4
    }
  },
  {
    selector: 'edge',
    style: {
      width: 2.2,
      'curve-style': 'bezier',
      'line-color': '#496460',
      'line-opacity': 0.26,
      'target-arrow-color': '#496460',
      'target-arrow-shape': 'triangle',
      'arrow-scale': 0.82,
      'overlay-opacity': 0
    }
  },
  {
    selector: 'edge[isTransitive > 0]',
    style: {
      'line-style': 'dashed',
      'line-dash-pattern': [8, 7]
    }
  },
  {
    selector: 'node.is-selected',
    style: {
      'border-color': '#132524',
      'border-opacity': 0.58,
      'border-width': 2.8
    }
  },
  {
    selector: 'node.is-neighbor',
    style: {
      'border-opacity': 0.28
    }
  },
  {
    selector: 'edge.is-neighbor',
    style: {
      width: 2.8,
      'line-opacity': 0.68
    }
  },
  {
    selector: '.is-dim',
    style: {
      opacity: 0.17
    }
  }
];

@Component({
  selector: 'app-dependency-graph-cytoscape',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  templateUrl: './dependency-graph-cytoscape.html',
  styleUrl: './dependency-graph-cytoscape.scss'
})
export class DependencyGraphCytoscapeComponent implements OnDestroy {
  private static readonly MIN_ZOOM = 0.12;
  private static readonly MAX_ZOOM = 2.2;
  private static readonly VIEW_PADDING = 56;
  private static readonly FOCUS_PADDING = 84;
  private static readonly ZOOM_STEP_FACTOR = 1.22;

  readonly graph = input<DependencyGraphResponse | null>(null);
  readonly graphIndex = input<GraphIndex>(EMPTY_GRAPH_INDEX);
  readonly selectedNodeId = input<string | null>(null);
  readonly nodeSelected = output<string>();
  protected readonly zoomLevel = signal(1);
  protected readonly layoutOptions: readonly LayoutOption[] = [
    { value: 'hierarchy', label: 'Hierarchiczny', note: 'warstwy od entry point do zaleznosci' },
    { value: 'radial', label: 'Radialny', note: 'wezel glowny w centrum, zaleznosci na pierscieniach' },
    { value: 'organic', label: 'Organiczny', note: 'uklad swobodny, lepszy przy gestszych grafach' }
  ];
  protected readonly activeLayoutMode = signal<GraphLayoutMode>('hierarchy');
  protected readonly activeLayoutOption = computed(
    () => this.layoutOptions.find((option) => option.value === this.activeLayoutMode()) ?? this.layoutOptions[0]
  );

  private readonly cyStageRef = viewChild<ElementRef<HTMLDivElement>>('cyStage');
  private cy: Core | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private layoutVersion = 0;
  private activeLayout: Layouts | null = null;
  private isLayoutRunning = false;
  private activeViewportIntent: ViewportIntent = 'focus';
  private pendingViewportIntent: ViewportIntent | null = null;
  private pendingOverviewAnchor: cytoscape.Position | null = null;
  private lastRenderedGraphKey: string | null = null;
  private lastRenderedLayoutMode: GraphLayoutMode | null = null;

  constructor() {
    effect(() => {
      const container = this.cyStageRef()?.nativeElement;
      const graph = this.graph();
      const graphIndex = this.graphIndex();
      const layoutMode = this.activeLayoutMode();
      if (!container) {
        return;
      }

      const cy = this.ensureCy(container);
      const graphKey = this.buildGraphRenderKey(graph);
      if (graphKey === this.lastRenderedGraphKey && layoutMode === this.lastRenderedLayoutMode) {
        return;
      }

      this.renderGraph(cy, graph, graphIndex, layoutMode);
      this.lastRenderedGraphKey = graphKey;
      this.lastRenderedLayoutMode = layoutMode;
    });

    effect(() => {
      const selectedNodeId = this.selectedNodeId();
      const cy = this.cy;
      const layoutMode = this.activeLayoutMode();
      const viewportIntent: ViewportIntent = selectedNodeId ? 'focus' : 'overview';
      this.activeViewportIntent = viewportIntent;
      this.pendingViewportIntent = viewportIntent;
      if (!cy) {
        return;
      }

      if (this.isLayoutRunning) {
        return;
      }

      this.syncSelectionState(cy, selectedNodeId, this.resolveViewportMode(layoutMode, viewportIntent, 'selection'));
      this.pendingViewportIntent = null;
    });
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.stopActiveLayout();
    this.cy?.destroy();
    this.cy = null;
  }

  protected zoomIn(): void {
    const cy = this.cy;
    if (!cy) {
      return;
    }

    this.animateZoomTo(cy, cy.zoom() * DependencyGraphCytoscapeComponent.ZOOM_STEP_FACTOR);
  }

  protected zoomOut(): void {
    const cy = this.cy;
    if (!cy) {
      return;
    }

    this.animateZoomTo(cy, cy.zoom() / DependencyGraphCytoscapeComponent.ZOOM_STEP_FACTOR);
  }

  protected resetViewport(): void {
    const cy = this.cy;
    if (!cy || cy.elements().empty()) {
      return;
    }

    this.activeViewportIntent = 'overview';
    this.pendingViewportIntent = 'overview';
    this.stopViewportMotion(cy);
    this.pendingOverviewAnchor = this.resolveSelectedRenderedPosition(cy, this.selectedNodeId());

    if (this.isLayoutRunning) {
      return;
    }

    this.syncSelectionState(cy, this.selectedNodeId(), 'overview');
    this.pendingViewportIntent = null;
  }

  protected setLayoutMode(layoutMode: string): void {
    if (!this.isLayoutMode(layoutMode)) {
      return;
    }

    this.activeLayoutMode.set(layoutMode);
  }

  private ensureCy(container: HTMLDivElement): Core {
    if (this.cy) {
      return this.cy;
    }

    this.cy = cytoscape({
      container,
      elements: [],
      style: CYTOSCAPE_STYLES,
      minZoom: DependencyGraphCytoscapeComponent.MIN_ZOOM,
      maxZoom: DependencyGraphCytoscapeComponent.MAX_ZOOM,
      pixelRatio: 'auto',
      wheelSensitivity: 0.16
    });

    this.cy.on('tap', 'node', (event) => {
      const nodeId = event.target.id();
      if (nodeId) {
        this.nodeSelected.emit(nodeId);
      }
    });

    this.cy.on('zoom', () => {
      this.zoomLevel.set(this.cy?.zoom() ?? 1);
    });
    this.zoomLevel.set(this.cy.zoom());

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.cy?.resize();
      });
      this.resizeObserver.observe(container);
    }

    return this.cy;
  }

  private renderGraph(cy: Core, graph: DependencyGraphResponse | null, graphIndex: GraphIndex, layoutMode: GraphLayoutMode): void {
    this.layoutVersion += 1;
    const currentLayoutVersion = this.layoutVersion;
    const elements = graph ? this.toElements(graph) : [];
    const fallbackNodeId = graph?.nodes[0]?.id ?? null;

    this.stopActiveLayout();
    this.stopViewportMotion(cy);
    cy.resize();

    cy.batch(() => {
      cy.elements().remove();
      if (elements.length > 0) {
        cy.add(elements);
      }
    });

    if (!graph?.nodes.length) {
      this.pendingViewportIntent = null;
      this.activeViewportIntent = 'overview';
      this.pendingOverviewAnchor = null;
      cy.fit(undefined, DependencyGraphCytoscapeComponent.VIEW_PADDING);
      return;
    }

    const layout = cy.layout(this.buildLayoutOptions(cy, graph, graphIndex, layoutMode));
    const viewportIntentAfterLayout = this.pendingViewportIntent ?? this.activeViewportIntent;
    this.activeLayout = layout;
    this.isLayoutRunning = true;

    layout.one('layoutstop', () => {
      if (currentLayoutVersion !== this.layoutVersion) {
        return;
      }

      if (this.activeLayout === layout) {
        this.activeLayout = null;
      }
      this.isLayoutRunning = false;

      const selectedNodeId = this.selectedNodeId() ?? fallbackNodeId;
      const viewportMode = this.resolveViewportMode(
        layoutMode,
        this.pendingViewportIntent ?? viewportIntentAfterLayout,
        'layout'
      );
      this.pendingViewportIntent = null;
      this.syncSelectionState(cy, selectedNodeId, viewportMode);
    });

    layout.run();
  }

  private buildLayoutOptions(
    cy: Core,
    graph: DependencyGraphResponse,
    graphIndex: GraphIndex,
    layoutMode: GraphLayoutMode
  ): cytoscape.LayoutOptions {
    switch (layoutMode) {
      case 'radial':
        return {
          name: 'concentric',
          animate: false,
          fit: true,
          padding: 68,
          avoidOverlap: true,
          spacingFactor: graph.nodes.length > 30 ? 1.02 : 1.1,
          minNodeSpacing: graph.nodes.length > 30 ? 20 : 34,
          startAngle: (-Math.PI * 3) / 4,
          sweep: Math.PI * 2,
          concentric: (node) => {
            const indexedNode = graphIndex.nodesById.get(node.id());
            const neighborCount = graphIndex.neighborIdsByNodeId.get(node.id())?.length ?? 0;
            const depth = indexedNode?.depth ?? 0;

            return (indexedNode?.isEntryPoint ? 300 : 0) + Math.max(0, 120 - depth * 18) + neighborCount;
          },
          levelWidth: () => 24
        } as cytoscape.LayoutOptions;
      case 'organic':
        return {
          name: 'cose',
          animate: false,
          fit: true,
          padding: 72,
          nodeDimensionsIncludeLabels: true,
          componentSpacing: 120,
          nodeOverlap: 24,
          idealEdgeLength: graph.nodes.length > 30 ? 110 : 150,
          edgeElasticity: 130,
          nestingFactor: 0.9,
          gravity: 1.05,
          numIter: 900,
          initialTemp: 180,
          coolingFactor: 0.96,
          minTemp: 1
        } as cytoscape.LayoutOptions;
      case 'hierarchy':
      default:
        return {
          name: 'breadthfirst',
          directed: true,
          animate: false,
          fit: true,
          padding: 64,
          spacingFactor: graph.nodes.length > 30 ? 1.04 : 1.18,
          nodeDimensionsIncludeLabels: true,
          roots: cy.nodes('[isEntryPoint > 0]')
        } as cytoscape.LayoutOptions;
    }
  }

  private syncSelectionState(cy: Core, selectedNodeId: string | null, viewportMode: ViewportMode): void {
    this.stopViewportMotion(cy);

    cy.batch(() => {
      cy.elements().removeClass('is-dim is-neighbor is-selected');
    });

    if (!selectedNodeId) {
      if (viewportMode !== 'focus') {
        cy.fit(undefined, DependencyGraphCytoscapeComponent.VIEW_PADDING);
      }
      return;
    }

    const selectedNode = cy.$id(selectedNodeId);
    if (selectedNode.empty()) {
      if (viewportMode !== 'focus') {
        cy.fit(undefined, DependencyGraphCytoscapeComponent.VIEW_PADDING);
      }
      return;
    }

    const neighborhood = selectedNode.closedNeighborhood();

    cy.batch(() => {
      if (viewportMode !== 'overview') {
        cy.elements().difference(neighborhood).addClass('is-dim');
      }
      neighborhood.nodes().difference(selectedNode).addClass('is-neighbor');
      neighborhood.edges().addClass('is-neighbor');
      selectedNode.addClass('is-selected');
    });

    if (viewportMode === 'overview') {
      this.animateOverview(cy, selectedNode);
      return;
    }

    if (viewportMode === 'static') {
      return;
    }

    if (viewportMode === 'fit') {
      cy.animate({
        fit: {
          eles: neighborhood,
          padding: DependencyGraphCytoscapeComponent.FOCUS_PADDING
        },
        duration: 220,
        easing: 'ease-out'
      });
      return;
    }

    cy.animate({
      center: { eles: selectedNode },
      zoom: this.resolveFocusZoom(cy, selectedNode),
      duration: 180,
      easing: 'ease-out'
    });
  }

  private animateZoomTo(cy: Core, targetZoom: number): void {
    const clampedZoom = this.clampZoom(cy, targetZoom);
    const zoomAnchor = this.resolveZoomAnchor(cy);

    this.stopViewportMotion(cy);
    cy.animate({
      zoom: {
        level: clampedZoom,
        renderedPosition: zoomAnchor
      },
      duration: 180,
      easing: 'ease-out'
    });
  }

  private resolveFocusZoom(cy: Core, selectedNode: cytoscape.CollectionReturnValue): number {
    const nodeBounds = selectedNode.boundingBox();
    const containerWidth = cy.container()?.clientWidth ?? cy.width();
    const containerHeight = cy.container()?.clientHeight ?? cy.height();
    const widthDrivenZoom = containerWidth / Math.max(nodeBounds.w + 320, 1);
    const heightDrivenZoom = containerHeight / Math.max(nodeBounds.h + 220, 1);
    const targetZoom = Math.min(widthDrivenZoom, heightDrivenZoom, 1.45);

    return this.clampZoom(cy, Math.max(cy.zoom(), targetZoom));
  }

  private clampZoom(cy: Core, zoom: number): number {
    return Math.min(cy.maxZoom(), Math.max(cy.minZoom(), zoom));
  }

  private animateOverview(cy: Core, selectedNode: cytoscape.CollectionReturnValue): void {
    const viewport = this.resolveOverviewViewport(cy, selectedNode);
    this.pendingOverviewAnchor = null;

    if (!viewport) {
      cy.animate({
        fit: {
          eles: cy.elements(),
          padding: DependencyGraphCytoscapeComponent.VIEW_PADDING
        },
        duration: 220,
        easing: 'ease-out'
      });
      return;
    }

    cy.animate({
      pan: viewport.pan,
      zoom: viewport.zoom,
      duration: 220,
      easing: 'ease-out'
    });
  }

  private resolveOverviewViewport(
    cy: Core,
    selectedNode: cytoscape.CollectionReturnValue
  ): { pan: cytoscape.Position; zoom: number } | null {
    const overviewAnchor = this.pendingOverviewAnchor;
    if (!overviewAnchor || selectedNode.empty()) {
      return null;
    }

    const containerWidth = cy.container()?.clientWidth ?? cy.width();
    const containerHeight = cy.container()?.clientHeight ?? cy.height();
    const availableWidth = Math.max(containerWidth - DependencyGraphCytoscapeComponent.VIEW_PADDING * 2, 1);
    const availableHeight = Math.max(containerHeight - DependencyGraphCytoscapeComponent.VIEW_PADDING * 2, 1);
    const bounds = cy.elements().boundingBox();

    if (bounds.w <= 0 || bounds.h <= 0) {
      return null;
    }

    const zoom = this.clampZoom(cy, Math.min(availableWidth / bounds.w, availableHeight / bounds.h));
    const selectedPosition = selectedNode.position();
    const centeredPan = this.resolveCenteredPan(bounds, zoom, containerWidth, containerHeight);
    const panRangeX = this.resolvePanRange(bounds.x1, bounds.x2, zoom, containerWidth);
    const panRangeY = this.resolvePanRange(bounds.y1, bounds.y2, zoom, containerHeight);

    return {
      zoom,
      pan: {
        x: this.resolveBiasedPan(selectedPosition.x, overviewAnchor.x, zoom, panRangeX, centeredPan.x),
        y: this.resolveBiasedPan(selectedPosition.y, overviewAnchor.y, zoom, panRangeY, centeredPan.y)
      }
    };
  }

  private resolveCenteredPan(
    bounds: BoundingBox,
    zoom: number,
    containerWidth: number,
    containerHeight: number
  ): cytoscape.Position {
    return {
      x: containerWidth / 2 - ((bounds.x1 + bounds.x2) / 2) * zoom,
      y: containerHeight / 2 - ((bounds.y1 + bounds.y2) / 2) * zoom
    };
  }

  private resolvePanRange(minCoord: number, maxCoord: number, zoom: number, containerSize: number): [number, number] {
    return [
      DependencyGraphCytoscapeComponent.VIEW_PADDING - minCoord * zoom,
      containerSize - DependencyGraphCytoscapeComponent.VIEW_PADDING - maxCoord * zoom
    ];
  }

  private resolveBiasedPan(
    nodeCoordinate: number,
    desiredRenderedCoordinate: number,
    zoom: number,
    panRange: [number, number],
    fallbackPan: number
  ): number {
    const [minPan, maxPan] = panRange;
    if (minPan > maxPan) {
      return fallbackPan;
    }

    return this.clamp(desiredRenderedCoordinate - nodeCoordinate * zoom, minPan, maxPan);
  }

  private stopActiveLayout(): void {
    this.activeLayout?.stop();
    this.activeLayout = null;
    this.isLayoutRunning = false;
  }

  private stopViewportMotion(cy: Core): void {
    cy.stop(true, false);
  }

  private resolveViewportMode(
    layoutMode: GraphLayoutMode,
    viewportIntent: ViewportIntent,
    origin: 'layout' | 'selection'
  ): ViewportMode {
    if (viewportIntent === 'overview') {
      return 'overview';
    }

    if (layoutMode === 'organic') {
      return origin === 'layout' ? 'overview' : 'focus';
    }

    return origin === 'layout' ? 'fit' : 'focus';
  }

  private resolveSelectedRenderedPosition(cy: Core, selectedNodeId: string | null): cytoscape.Position | null {
    if (!selectedNodeId) {
      return null;
    }

    const selectedNode = cy.$id(selectedNodeId);
    return selectedNode.empty() ? null : selectedNode.renderedPosition();
  }

  private resolveZoomAnchor(cy: Core) {
    const selectedNodeId = this.selectedNodeId();
    if (selectedNodeId) {
      const selectedNode = cy.$id(selectedNodeId);
      if (!selectedNode.empty()) {
        return selectedNode.renderedPosition();
      }
    }

    return {
      x: (cy.container()?.clientWidth ?? cy.width()) / 2,
      y: (cy.container()?.clientHeight ?? cy.height()) / 2
    };
  }

  private toElements(graph: DependencyGraphResponse): ElementDefinition[] {
    const nodeElements: ElementDefinition[] = graph.nodes.map((node) => ({
      data: {
        id: node.id,
        displayLabel: `${node.type.toUpperCase()}\n${node.fullName}`,
        nodeType: node.type,
        requiresPermissionCheck: node.requiresPermissionCheck ? 1 : 0,
        isEntryPoint: node.isEntryPoint ? 1 : 0
      }
    }));

    const edgeElements: ElementDefinition[] = graph.edges.map((edge) => ({
      data: {
        id: edge.id,
        source: edge.sourceId,
        target: edge.targetId,
        isTransitive: edge.isTransitive ? 1 : 0
      }
    }));

    return [...nodeElements, ...edgeElements];
  }

  private isLayoutMode(value: string): value is GraphLayoutMode {
    return this.layoutOptions.some((option) => option.value === value);
  }

  private buildGraphRenderKey(graph: DependencyGraphResponse | null): string {
    if (!graph) {
      return 'empty';
    }

    const nodeKey = graph.nodes.map((node) => node.id).join('|');
    const edgeKey = graph.edges.map((edge) => edge.id).join('|');

    return `${nodeKey}::${edgeKey}`;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }
}
