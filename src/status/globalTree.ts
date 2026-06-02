import * as vscode from 'vscode';
import { ApiQuota } from '../client/types';

type GlobalData = {
  zenKey: string;
  goKey: string;
  zenUsage?: {
    balance?: number;
    used?: number;
    limit?: number;
    remaining?: number;
    quotas?: ApiQuota[];
  };
  goUsage?: {
    balance?: number;
    used?: number;
    limit?: number;
    remaining?: number;
    quotas?: ApiQuota[];
  };
};

export interface GlobalTreeItem extends vscode.TreeItem {
  children?: GlobalTreeItem[];
}

export class GlobalTreeProvider implements vscode.TreeDataProvider<GlobalTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<GlobalTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private data?: GlobalData;
  private lastRefresh = 0;

  update(data: GlobalData): void {
    this.data = data;
    this.lastRefresh = Date.now();
    this._onDidChangeTreeData.fire();
  }

  async refresh(zenProvider: { fetchApiUsage(): Promise<any> }, goProvider: { fetchApiUsage(): Promise<any> }): Promise<void> {
    const [zenUsage, goUsage] = await Promise.all([
      zenProvider.fetchApiUsage(),
      goProvider.fetchApiUsage(),
    ]);
    this.update({ zenKey: this.data?.zenKey ?? '', goKey: this.data?.goKey ?? '', zenUsage, goUsage });
  }

  getTreeItem(element: GlobalTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: GlobalTreeItem): GlobalTreeItem[] {
    if (!this.data) return [];

    if (!element) {
      const items: GlobalTreeItem[] = [];
      const lastStr = this.lastRefresh > 0 ? `Updated ${this.time(this.lastRefresh)}` : 'Not refreshed';

      if (this.data.zenKey) {
        items.push(this.providerNode('zen', '🔵 OpenCode Zen', this.data.zenUsage));
      }
      if (this.data.goKey) {
        items.push(this.providerNode('go', '🟢 OpenCode Go', this.data.goUsage));
      }

      if (items.length === 0) {
        items.push({
          id: 'no-providers',
          label: 'No API keys configured',
          description: 'Use Configure to add keys',
          collapsibleState: vscode.TreeItemCollapsibleState.None,
          contextValue: 'opencodeConfig',
        });
      }

      return items;
    }

    return element.children ?? [];
  }

  private providerNode(id: string, label: string, usage?: { balance?: number; used?: number; limit?: number; remaining?: number; quotas?: ApiQuota[] }): GlobalTreeItem {
    const children: GlobalTreeItem[] = [];

    if (usage) {
      if (usage.balance !== undefined) {
        children.push(this.item(`balance-${id}`, 'Balance', `$${usage.balance.toFixed(4)}`));
      }
      if (usage.used !== undefined) {
        const pct = usage.limit ? ((usage.used / usage.limit) * 100).toFixed(1) + '%' : 'N/A';
        children.push(this.item(`used-${id}`, 'Used', `$${usage.used.toFixed(4)}${usage.limit ? ` / $${usage.limit.toFixed(4)} (${pct})` : ''}`));
      }
      if (usage.remaining !== undefined) {
        children.push(this.item(`remaining-${id}`, 'Remaining', `$${usage.remaining.toFixed(4)}`));
      }
    }

    if (usage?.quotas && usage.quotas.length > 0) {
      children.push(...this.quotaNodes(id, usage.quotas));
    }

    return {
      id: `provider-${id}`,
      label,
      description: usage?.balance !== undefined ? `$${usage.balance.toFixed(4)}` : 'loading…',
      collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
      children,
      contextValue: 'opencodeProvider',
    };
  }

  private quotaNodes(providerId: string, quotas: ApiQuota[]): GlobalTreeItem[] {
    return quotas.map(q => {
      const pct = q.limit > 0 ? (q.used / q.limit) * 100 : 0;
      const pctStr = pct.toFixed(1) + '%';
      const bar = this.progressBar(pct);
      const resetStr = q.reset_at ? ` Resets ${this.time(new Date(q.reset_at).getTime())}` : '';
      return {
        id: `quota-${providerId}-${q.id}`,
        label: `${q.name}`,
        description: `${this.fmtNum(q.used)} / ${this.fmtNum(q.limit)} ${q.unit} (${pctStr}) ${resetStr}`,
        tooltip: `${q.name}\nUsed: ${this.fmtNum(q.used)} ${q.unit}\nLimit: ${this.fmtNum(q.limit)} ${q.unit}\nRemaining: ${this.fmtNum(q.remaining)} ${q.unit}${q.reset_at ? `\nResets: ${q.reset_at}` : ''}`,
        collapsibleState: vscode.TreeItemCollapsibleState.None,
        contextValue: 'opencodeQuota',
        children: [],
      };
    });
  }

  private item(id: string, label: string, desc: string): GlobalTreeItem {
    return { id, label, description: desc, collapsibleState: vscode.TreeItemCollapsibleState.None, contextValue: 'opencodeUsage' };
  }

  private fmtNum(n: number): string {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toFixed(0);
  }

  private time(ts: number): string {
    return new Date(ts).toLocaleString();
  }

  private progressBar(pct: number): string {
    const filled = Math.round(pct / 10);
    return '█'.repeat(filled) + '░'.repeat(10 - filled);
  }
}