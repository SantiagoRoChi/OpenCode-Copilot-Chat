import { EventEmitter, ThemeIcon, TreeDataProvider, TreeItem, TreeItemCollapsibleState, ProviderResult } from 'vscode';

export interface KpiSummary {
  totalRequests: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCost: number;
  byServer: Array<{ name: string; requests: number; cost: number; isLocal: boolean }>;
  byModel: Array<{ name: string; requests: number; cost: number; tokens: number }>;
}

type Node = HeaderNode | MetricLeafNode | EmptyNode;

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function costStr(v: number): string {
  if (v === 0) return '$0';
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

export class KpisTreeProvider implements TreeDataProvider<Node> {
  private _onDidChangeTreeData = new EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private kpis?: KpiSummary;

  refresh(kpis: KpiSummary): void {
    this.kpis = kpis;
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: Node): TreeItem {
    return element;
  }

  getChildren(element?: Node): ProviderResult<Node[]> {
    if (!element) return this.getRootNodes();
    if (element instanceof HeaderNode) return element.children;
    return [];
  }

  private getRootNodes(): Node[] {
    if (!this.kpis || this.kpis.totalRequests === 0) {
      return [new EmptyNode('No usage data yet')];
    }

    const { kpis } = this;

    const summaryChildren: Node[] = [
      new MetricLeafNode('Requests', `${kpis.totalRequests}`, 'globe'),
      new MetricLeafNode('Tokens In', `${fmt(kpis.totalTokensIn)}`, 'type-hierarchy-sub'),
      new MetricLeafNode('Tokens Out', `${fmt(kpis.totalTokensOut)}`, 'type-hierarchy-super'),
      new MetricLeafNode('Total Cost', `${costStr(kpis.totalCost)}`, 'currency'),
    ];

    const byServerChildren: Node[] = kpis.byServer.length > 0
      ? kpis.byServer.map(s =>
          new MetricLeafNode(
            s.name,
            `${s.requests} req${s.isLocal ? ' · local' : ` · ${costStr(s.cost)}`}`,
            'server'
          )
        )
      : [new EmptyNode('No per-server data')];

    const byModelChildren: Node[] = kpis.byModel.length > 0
      ? kpis.byModel.map(m =>
          new MetricLeafNode(
            m.name,
            `${m.requests} req · ${fmt(m.tokens)} tok${m.cost > 0 ? ` · ${costStr(m.cost)}` : ' · local'}`,
            'symbol-misc'
          )
        )
      : [new EmptyNode('No per-model data')];

    return [
      new HeaderNode('Summary', summaryChildren, 'graph'),
      new HeaderNode('By Server', byServerChildren, 'server-process'),
      new HeaderNode('By Model', byModelChildren, 'symbol-misc'),
    ];
  }
}

class HeaderNode extends TreeItem {
  constructor(label: string, public readonly children: Node[], icon: string) {
    super(label, TreeItemCollapsibleState.Expanded);
    this.iconPath = new ThemeIcon(icon);
  }
}

class MetricLeafNode extends TreeItem {
  constructor(label: string, desc: string, icon: string) {
    super(label, TreeItemCollapsibleState.None);
    this.description = desc;
    this.iconPath = new ThemeIcon(icon);
  }
}

class EmptyNode extends TreeItem {
  constructor(text: string) {
    super(text, TreeItemCollapsibleState.None);
    this.iconPath = new ThemeIcon('info');
  }
}
