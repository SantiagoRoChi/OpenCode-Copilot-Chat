import * as vscode from 'vscode';
import { UsageRecord } from '../usage/UsageTracker';
import { TokenUsage } from '../client/types';

export interface UsageTreeItem extends vscode.TreeItem {
  children?: UsageTreeItem[];
}

type SessionStats = {
  totalRequests: number;
  totalTokens: TokenUsage;
  byModel: Record<string, { requests: number; tokens: TokenUsage }>;
  byProvider: Record<string, { requests: number; tokens: TokenUsage }>;
  history: UsageRecord[];
};

type SessionData = {
  zenKey: string;
  goKey: string;
  sessionStats: SessionStats;
  zenUsage?: { balance?: number; used?: number; limit?: number };
  goUsage?: { used?: number; limit?: number };
};

export class SessionTreeProvider implements vscode.TreeDataProvider<UsageTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<UsageTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private data?: SessionData;

  update(data: SessionData): void {
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
      const s = this.data.sessionStats;
      const items: UsageTreeItem[] = [];

      items.push(this.header('📈', 'Session Stats', `${s.totalRequests} req · ${this.fmtNum(s.totalTokens.total)} tok`, [
        this.item('total-req', `Total Requests`, `${s.totalRequests}`, 'opencodeUsage'),
        this.item('prompt-tok', `Prompt Tokens`, this.fmtNum(s.totalTokens.prompt), 'opencodeUsage'),
        this.item('completion-tok', `Completion Tokens`, this.fmtNum(s.totalTokens.completion), 'opencodeUsage'),
        this.item('total-tok', `Total Tokens`, this.fmtNum(s.totalTokens.total), 'opencodeUsage'),
      ]));

      const byProvider = Object.entries(s.byProvider).sort((a, b) => b[1].tokens.total - a[1].tokens.total);
      if (byProvider.length > 0) {
        items.push(this.header('📊', 'By Provider', `${byProvider.length} providers`, byProvider.map(([id, d]) =>
          this.item(`provider-${id}`, `${id === 'opencode-go' ? 'Go' : id === 'zen' ? 'Zen' : id}`, `${d.requests} req · ${this.fmtNum(d.tokens.total)} tok`, 'opencodeUsage')
        )));
      }

      const byModel = Object.entries(s.byModel).sort((a, b) => b[1].tokens.total - a[1].tokens.total).slice(0, 15);
      if (byModel.length > 0) {
        items.push(this.header('🤖', 'By Model', `${byModel.length} models`, byModel.map(([id, d]) =>
          this.item(`model-${id}`, id, `${d.requests} req · ${this.fmtNum(d.tokens.total)} tok`, 'opencodeUsage')
        )));
      }

      const sessions = this.groupBySession(s.history);
      if (sessions.length > 0) {
        items.push(this.header('🔀', 'Sessions', `${sessions.length} sessions`, sessions.map(session =>
          this.header('📁', `Session ${session.sessionId.slice(0, 8)}…`, `${session.count} req · ${this.fmtNum(session.tokens)} tok`,
            session.records.map(r => this.item(`req-${r.requestId}`, `${this.time(r.timestamp)} · ${r.modelName}`, `${this.fmtNum(r.usage.total)} tok`, 'opencodeUsageRequest', `Provider: ${r.provider}\nModel: ${r.modelId}\nPrompt: ${this.fmtNum(r.usage.prompt)}\nCompletion: ${this.fmtNum(r.usage.completion)}`))
          )
        )));
      }

      if (s.history.length > 0) {
        const recent = [...s.history].reverse().slice(0, 20);
        items.push(this.header('📝', 'Recent Requests', `${s.history.length} total`, recent.map(r =>
          this.item(`recent-${r.requestId}`, `${this.time(r.timestamp)} · ${r.modelName}`, `${this.fmtNum(r.usage.total)} tok`, 'opencodeUsage')
        )));
      }

      return items;
    }

    return element.children ?? [];
  }

  private header(id: string, label: string, desc: string, children: UsageTreeItem[]): UsageTreeItem {
    return { id, label, description: desc, collapsibleState: vscode.TreeItemCollapsibleState.Expanded, children, contextValue: 'opencodeUsageSection' };
  }

  private item(id: string, label: string, desc: string, context?: string, tooltip?: string): UsageTreeItem {
    return { id, label, description: desc, collapsibleState: vscode.TreeItemCollapsibleState.None, contextValue: context, tooltip };
  }

  private groupBySession(history: UsageRecord[]): { sessionId: string; count: number; tokens: number; records: UsageRecord[] }[] {
    const map = new Map<string, { sessionId: string; count: number; tokens: number; records: UsageRecord[] }>();
    for (const r of history) {
      if (!map.has(r.sessionId)) map.set(r.sessionId, { sessionId: r.sessionId, count: 0, tokens: 0, records: [] });
      const s = map.get(r.sessionId)!;
      s.count++;
      s.tokens += r.usage.total;
      s.records.push(r);
    }
    return Array.from(map.values()).sort((a, b) => b.tokens - a.tokens);
  }

  private fmtNum(n: number): string {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
  }

  private time(ts: number): string {
    return new Date(ts).toLocaleTimeString();
  }
}