import * as vscode from 'vscode';
import { UsageRecord } from '../usage/UsageTracker';
import { TokenUsage } from '../client/types';

export interface UsageTreeItem extends vscode.TreeItem {
  children?: UsageTreeItem[];
}

type UsageData = {
  zenKey: string;
  goKey: string;
  sessionStats: {
    totalRequests: number;
    totalTokens: TokenUsage;
    byModel: Record<string, { requests: number; tokens: TokenUsage }>;
    byProvider: Record<string, { requests: number; tokens: TokenUsage }>;
    history: UsageRecord[];
  };
  zenUsage?: { balance?: number; used?: number; limit?: number };
  goUsage?: { used?: number; limit?: number };
};

export class UsageTreeProvider implements vscode.TreeDataProvider<UsageTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<UsageTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private data?: UsageData;

  update(data: UsageData): void {
    this.data = data;
    this._onDidChangeTreeData.fire();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: UsageTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: UsageTreeItem): UsageTreeItem[] {
    if (!this.data) return [];

    if (!element) {
      const items: UsageTreeItem[] = [];

      items.push({
        id: 'keys',
        label: `🔑 API Keys`,
        description: this.data.zenKey ? `Zen: ${this.mask(this.data.zenKey)}` : 'Zen: not set',
        collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
        contextValue: 'opencodeUsageKey',
      });

      const balance = (this.data.zenUsage?.balance ?? 'N/A').toString();
      items.push({
        id: 'balance',
        label: `💰 Balance`,
        description: `$${balance}`,
        collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
        contextValue: 'opencodeUsageBalance',
      });

      const s = this.data.sessionStats;
      items.push({
        id: 'summary',
        label: `📈 Session`,
        description: `${s.totalRequests} req · ${this.fmtNum(s.totalTokens.total)} tok`,
        collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
        contextValue: 'opencodeUsageSession',
        children: [
          {
            id: 'summary-total',
            label: `Total Requests`,
            description: `${s.totalRequests}`,
            collapsibleState: vscode.TreeItemCollapsibleState.None,
          },
          {
            id: 'summary-prompt',
            label: `Prompt Tokens`,
            description: this.fmtNum(s.totalTokens.prompt),
            collapsibleState: vscode.TreeItemCollapsibleState.None,
          },
          {
            id: 'summary-completion',
            label: `Completion Tokens`,
            description: this.fmtNum(s.totalTokens.completion),
            collapsibleState: vscode.TreeItemCollapsibleState.None,
          },
          {
            id: 'summary-total-tokens',
            label: `Total Tokens`,
            description: this.fmtNum(s.totalTokens.total),
            collapsibleState: vscode.TreeItemCollapsibleState.None,
          },
        ],
      });

      const byProvider = Object.entries(s.byProvider).sort((a, b) => b[1].tokens.total - a[1].tokens.total);
      if (byProvider.length > 0) {
        items.push({
          id: 'providers',
          label: `📊 By Provider`,
          description: `${byProvider.length} providers`,
          collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
          contextValue: 'opencodeUsageProvider',
          children: byProvider.map(([id, d]) => ({
            id: `provider-${id}`,
            label: `${id === 'opencode-go' ? '🟢' : '🔵'} ${id}`,
            description: `${d.requests} req · ${this.fmtNum(d.tokens.total)} tok`,
            collapsibleState: vscode.TreeItemCollapsibleState.None,
          })),
        });
      }

      const byModel = Object.entries(s.byModel).sort((a, b) => b[1].tokens.total - a[1].tokens.total).slice(0, 15);
      if (byModel.length > 0) {
        items.push({
          id: 'models',
          label: `🤖 By Model`,
          description: `${byModel.length} models`,
          collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
          contextValue: 'opencodeUsageModel',
          children: byModel.map(([id, d]) => ({
            id: `model-${id}`,
            label: `${id}`,
            description: `${d.requests} req · ${this.fmtNum(d.tokens.total)} tok`,
            collapsibleState: vscode.TreeItemCollapsibleState.None,
          })),
        });
      }

      const sessions = this.groupBySession(s.history);
      if (sessions.length > 0) {
        items.push({
          id: 'sessions',
          label: `🔀 Sessions`,
          description: `${sessions.length} sessions`,
          collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
          contextValue: 'opencodeUsageSessionGroup',
          children: sessions.map(session => ({
            id: `session-${session.sessionId}`,
            label: `Session ${session.sessionId.slice(0, 8)}…`,
            description: `${session.count} req · ${this.fmtNum(session.tokens)} tok`,
            collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
            contextValue: 'opencodeUsageSessionItem',
            children: session.records.map(r => ({
              id: `req-${r.requestId}`,
              label: `${new Date(r.timestamp).toLocaleTimeString()} · ${r.modelName}`,
              description: `${this.fmtNum(r.usage.total)} tok`,
              tooltip: `Provider: ${r.provider}\nModel: ${r.modelId}\nPrompt: ${this.fmtNum(r.usage.prompt)}\nCompletion: ${this.fmtNum(r.usage.completion)}\nTotal: ${this.fmtNum(r.usage.total)}`,
              collapsibleState: vscode.TreeItemCollapsibleState.None,
              contextValue: 'opencodeUsageRequest',
            })),
          })),
        });
      }

      if (s.history.length > 0) {
        const recent = [...s.history].reverse().slice(0, 20);
        items.push({
          id: 'recent',
          label: `📝 Recent`,
          description: `${s.history.length} requests`,
          collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
          contextValue: 'opencodeUsageRecent',
          children: recent.map(r => ({
            id: `recent-${r.requestId}`,
            label: `${new Date(r.timestamp).toLocaleTimeString()} · ${r.modelName}`,
            description: `${this.fmtNum(r.usage.total)} tok`,
            tooltip: `Provider: ${r.provider}\nSession: ${r.sessionId.slice(0, 12)}…\nRequest: ${r.requestId.slice(0, 12)}…\nPrompt: ${this.fmtNum(r.usage.prompt)}\nCompletion: ${this.fmtNum(r.usage.completion)}`,
            collapsibleState: vscode.TreeItemCollapsibleState.None,
            contextValue: 'opencodeUsageRecentItem',
          })),
        });
      }

      return items;
    }

    return element.children ?? [];
  }

  private groupBySession(history: UsageRecord[]): { sessionId: string; count: number; tokens: number; records: UsageRecord[] }[] {
    const map = new Map<string, { sessionId: string; count: number; tokens: number; records: UsageRecord[] }>();
    for (const r of history) {
      if (!map.has(r.sessionId)) {
        map.set(r.sessionId, { sessionId: r.sessionId, count: 0, tokens: 0, records: [] });
      }
      const s = map.get(r.sessionId)!;
      s.count++;
      s.tokens += r.usage.total;
      s.records.push(r);
    }
    return Array.from(map.values()).sort((a, b) => b.tokens - a.tokens);
  }

  private mask(key: string): string {
    if (key.length <= 8) return '••••';
    return `${key.slice(0, 6)}…${key.slice(-4)}`;
  }

  private fmtNum(n: number): string {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
  }
}