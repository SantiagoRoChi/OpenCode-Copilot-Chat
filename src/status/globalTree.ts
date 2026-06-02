import * as vscode from 'vscode';
import { ApiQuota } from '../client/types';

export interface ModelFamily {
  name: string;
  count: number;
  models: string[];
}

export interface GlobalData {
  zenKey: string;
  goKey: string;
  zenStatus: 'pending' | 'error' | 'ok' | 'no-endpoint';
  goStatus: 'pending' | 'error' | 'ok' | 'no-endpoint';
  zenFamilies: ModelFamily[];
  goFamilies: ModelFamily[];
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
}

export class GlobalTreeProvider implements vscode.TreeDataProvider<GlobalTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<GlobalTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private data?: GlobalData;

  update(data: GlobalData): void {
    this.data = data;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: GlobalTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: GlobalTreeItem): GlobalTreeItem[] {
    if (!this.data) {
      return [{
        id: 'loading',
        label: '⏳ Loading…',
        description: 'Fetching provider data',
        collapsibleState: vscode.TreeItemCollapsibleState.None,
      }];
    }

    if (!element) {
      const items: GlobalTreeItem[] = [];

      if (this.data.zenKey && this.data.zenStatus !== 'no-endpoint') {
        items.push(this.providerNode('zen', '🔵 OpenCode Zen', this.data.zenStatus, this.data.zenFamilies, this.data.zenUsage));
      }
      if (this.data.goKey && this.data.goStatus !== 'no-endpoint') {
        items.push(this.providerNode('go', '🟢 OpenCode Go', this.data.goStatus, this.data.goFamilies, this.data.goUsage));
      }

      if (items.length === 0) {
        items.push({
          id: 'no-keys',
          label: '⚠️ No API keys configured',
          description: 'Use Config tab to add keys',
          collapsibleState: vscode.TreeItemCollapsibleState.None,
        });
      }

      return items;
    }

    return element.children ?? [];
  }

  private providerNode(
    id: string,
    label: string,
    status: 'pending' | 'error' | 'ok' | 'no-endpoint',
    families: ModelFamily[],
    usage?: { balance?: number; used?: number; limit?: number; remaining?: number; quotas?: ApiQuota[] }
  ): GlobalTreeItem {
    const children: GlobalTreeItem[] = [];

    if (status === 'no-endpoint') {
      children.push(this.item(`${id}-no-ep`, 'ℹ️ No usage endpoint', '/usage returns 404 — not available', 'opencodeUsage'));
      if (families.length > 0) {
        children.push(...this.familyNodes(id, families));
      }
    } else if (status === 'pending') {
      children.push(this.item(`${id}-loading`, '⏳ Fetching…', 'Please wait', 'opencodeUsage'));
      if (families.length > 0) {
        children.push(...this.familyNodes(id, families));
      }
    } else if (status === 'error') {
      children.push(this.item(`${id}-error`, '❌ API Error', 'Failed to fetch account data', 'opencodeUsage'));
      if (families.length > 0) {
        children.push(...this.familyNodes(id, families));
      }
    } else if (usage) {
      if (usage.balance !== undefined) {
        children.push(this.item(`balance-${id}`, 'Balance', `$${usage.balance.toFixed(4)}`));
      }
      if (usage.used !== undefined) {
        const pct = usage.limit ? ((usage.used / usage.limit) * 100).toFixed(1) + '%' : '';
        children.push(this.item(`used-${id}`, 'Used', `$${usage.used.toFixed(4)}${pct ? ` (${pct})` : ''}`));
      }
      if (usage.remaining !== undefined) {
        children.push(this.item(`remaining-${id}`, 'Remaining', `$${usage.remaining.toFixed(4)}`));
      }
      if (usage.quotas && usage.quotas.length > 0) {
        children.push(...this.quotaNodes(id, usage.quotas));
      }
      if (families.length > 0) {
        children.push(...this.familyNodes(id, families));
      }
    } else {
      if (families.length > 0) {
        children.push(...this.familyNodes(id, families));
      }
    }

    const modelCount = families.reduce((s, f) => s + f.count, 0);
    const desc = status === 'no-endpoint' ? `${modelCount} models — no usage API` :
      status === 'pending' ? '⏳ fetching…' :
      status === 'error' ? '❌ error' :
      `${modelCount} models`;

    return {
      id: `provider-${id}`,
      label,
      description: desc,
      tooltip: `${label}\n${modelCount} models available`,
      collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
      children,
      contextValue: 'opencodeProvider',
    };
  }

  private familyNodes(providerId: string, families: ModelFamily[]): GlobalTreeItem[] {
    return families.slice(0, 12).map(f => ({
      id: `family-${providerId}-${f.name}`,
      label: `📦 ${f.name}`,
      description: `${f.count} model${f.count > 1 ? 's' : ''}`,
      tooltip: f.models.join(', '),
      collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
      contextValue: 'opencodeFamily',
      children: f.models.map(m => this.item(`model-${providerId}-${m}`, m, '', 'opencodeUsage')),
    }));
  }

  private quotaNodes(providerId: string, quotas: ApiQuota[]): GlobalTreeItem[] {
    return quotas.map(q => {
      const pct = q.limit > 0 ? (q.used / q.limit) * 100 : 0;
      const pctStr = pct.toFixed(1) + '%';
      const resetStr = q.reset_at ? ` · Resets ${new Date(q.reset_at).toLocaleString()}` : '';
      return {
        id: `quota-${providerId}-${q.id}`,
        label: `📊 ${q.name}`,
        description: `${this.fmtNum(q.used)} / ${this.fmtNum(q.limit)} ${q.unit} (${pctStr})${resetStr}`,
        tooltip: `${q.name}\nUsed: ${this.fmtNum(q.used)} ${q.unit}\nLimit: ${this.fmtNum(q.limit)} ${q.unit}\nRemaining: ${this.fmtNum(q.remaining)} ${q.unit}${q.reset_at ? `\nResets: ${q.reset_at}` : ''}`,
        collapsibleState: vscode.TreeItemCollapsibleState.None,
        contextValue: 'opencodeQuota',
        children: [],
      };
    });
  }

  private item(id: string, label: string, desc: string, context?: string): GlobalTreeItem {
    return { id, label, description: desc, collapsibleState: vscode.TreeItemCollapsibleState.None, contextValue: context };
  }

  private fmtNum(n: number): string {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toFixed(0);
  }
}

export interface GlobalTreeItem extends vscode.TreeItem {
  children?: GlobalTreeItem[];
}