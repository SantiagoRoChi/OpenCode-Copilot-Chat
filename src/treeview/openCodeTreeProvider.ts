import * as vscode from 'vscode';
import { DashboardState } from '../webview/openCodeWebviewProvider';

type TreeItem = HeaderNode | StatNode | ActionNode | InfoNode;

export class OpenCodeTreeProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private state?: DashboardState;

  refresh(state?: DashboardState): void {
    if (state) this.state = state;
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeItem): TreeItem[] {
    if (!element) return this.getRootNodes();
    if (element instanceof HeaderNode) return element.children;
    return [];
  }

  private getRootNodes(): TreeItem[] {
    if (!this.state) return [new InfoNode('Loading...')];
    const items: TreeItem[] = [];

    // ── Dashboard section ──
    const dashChildren: TreeItem[] = [];

    // Per-server stats
    for (const s of this.state.servers) {
      const status = s.available ? '● Online' : '○ Offline';
      const typeIcon = s.type === 'lmstudio' ? '$(chip)' : s.type === 'ollama' ? '$(zap)' : '$(server)';
      const typeLabel = s.type === 'lmstudio' ? 'LM Studio' : s.type === 'ollama' ? 'Ollama' : 'OpenCode';
      dashChildren.push(new StatNode(
        `${typeIcon} ${s.name} — ${status}`,
        `${s.models.length} models · ${typeLabel}`
      ));
    }

    // Zen stats
    if (this.state.zenStats?.totalRequests > 0) {
      dashChildren.push(new StatNode(
        `Zen: ${this.state.zenStats.totalRequests} requests`,
        `${fmtTokens(this.state.zenStats.totalTokens.total)} tokens`
      ));
    }

    // Go stats
    if (this.state.goStats?.totalRequests > 0) {
      dashChildren.push(new StatNode(
        `Go: ${this.state.goStats.totalRequests} requests`,
        `${fmtTokens(this.state.goStats.totalTokens.total)} tokens`
      ));
    }

    if (dashChildren.length === 0) {
      dashChildren.push(new InfoNode('No data yet'));
    }

    items.push(new HeaderNode('Dashboard', dashChildren));

    // ── Config section ──
    const configChildren: TreeItem[] = [
      new ActionNode('Set Zen API Key', 'opencode-zen.configureZen', 'key'),
      new ActionNode('Set Go API Key', 'opencode-zen.configureGo', 'key'),
      new ActionNode('Add Server', 'opencode-zen.addServer', 'server'),
      new ActionNode('Edit Server', 'opencode-zen.editServer', 'edit'),
      new ActionNode('Remove Server', 'opencode-zen.removeServer', 'trash'),
      new ActionNode('Refresh Servers', 'opencode-zen.refreshServers', 'refresh'),
      new ActionNode('Refresh All Models', 'opencode-zen.refreshAll', 'refresh'),
      new ActionNode('Clear Usage Stats', 'opencode-zen.clearUsage', 'clear-all'),
    ];

    items.push(new HeaderNode('Config', configChildren));

    return items;
  }
}

function fmtTokens(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

class HeaderNode extends vscode.TreeItem {
  constructor(label: string, public readonly children: TreeItem[]) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.iconPath = new vscode.ThemeIcon('folder');
  }
}

class StatNode extends vscode.TreeItem {
  constructor(label: string, desc: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = desc;
    this.iconPath = new vscode.ThemeIcon('graph');
  }
}

class ActionNode extends vscode.TreeItem {
  constructor(label: string, command: string, icon: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(icon);
    this.command = { command, title: label };
  }
}

class InfoNode extends vscode.TreeItem {
  constructor(text: string) {
    super(text, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('info');
  }
}
