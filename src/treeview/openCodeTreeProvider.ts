import { EventEmitter, ThemeIcon, TreeDataProvider, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { DashboardState } from '../webview/openCodeWebviewProvider';

type TreeViewNode = HeaderNode | StatNode | ActionNode | InfoNode;

export class OpenCodeTreeProvider implements TreeDataProvider<TreeViewNode> {
  private _onDidChangeTreeData = new EventEmitter<TreeViewNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private state?: DashboardState;

  refresh(state?: DashboardState): void {
    if (state) this.state = state;
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: TreeViewNode): TreeItem {
    return element;
  }

  getChildren(element?: TreeViewNode): TreeViewNode[] {
    if (!element) return this.getRootNodes();
    if (element instanceof HeaderNode) return element.children;
    return [];
  }

  private getRootNodes(): TreeViewNode[] {
    if (!this.state) return [new InfoNode('Loading...')];
    const items: TreeItem[] = [];

    // ── Dashboard section ──
    const dashChildren: TreeItem[] = [];

    // Per-server stats
    for (const s of this.state.servers) {
      const status = s.available ? '● Online' : '○ Offline';
      const typeIcon = s.type === 'lmstudio' ? '$(chip)' : s.type === 'ollama-plus' ? '$(zap)' : '$(server)';
      const typeLabel = s.type === 'lmstudio' ? 'LM Studio' : s.type === 'ollama-plus' ? 'Ollama+' : 'OpenCode';
      dashChildren.push(new StatNode(
        `${typeIcon} ${s.name} — ${status}`,
        `${s.models.length} models · ${typeLabel}`
      ));
    }

    // Go burn-rate (if available)
    if (this.state.goBurnRate) {
      const go = this.state.goBurnRate;
      const warn = go.session.percent > 80 || go.weekly.percent > 80 || go.monthly.percent > 80;
      const icon = warn ? '⚠️' : '🚀';
      dashChildren.push(new StatNode(
        `${icon} Go Usage`,
        `5h: ${go.session.percent}% · Week: ${go.weekly.percent}% · Month: ${go.monthly.percent}%`
      ));
      dashChildren.push(new StatNode(
        `  Session`,
        `$${go.session.spent.toFixed(2)} / $${go.session.limit}`
      ));
      dashChildren.push(new StatNode(
        `  Weekly`,
        `$${go.weekly.spent.toFixed(2)} / $${go.weekly.limit}`
      ));
      dashChildren.push(new StatNode(
        `  Monthly`,
        `$${go.monthly.spent.toFixed(2)} / $${go.monthly.limit}`
      ));
    }

    // Zen stats
    if (this.state.zenStats?.totalRequests > 0) {
      dashChildren.push(new StatNode(
        `Zen: ${this.state.zenStats.totalRequests} requests`,
        `$${this.state.zenStats.totalCost.toFixed(4)} · ${fmtTokens(this.state.zenStats.totalTokens.total)} tokens`
      ));
    }

    // Go stats
    if (this.state.goStats?.totalRequests > 0) {
      dashChildren.push(new StatNode(
        `Go: ${this.state.goStats.totalRequests} requests`,
        `$${this.state.goStats.totalCost.toFixed(4)} · ${fmtTokens(this.state.goStats.totalTokens.total)} tokens`
      ));
    }

    if (dashChildren.length === 0) {
      dashChildren.push(new InfoNode('No data yet'));
    }

    items.push(new HeaderNode('Dashboard', dashChildren));

    // ── Config section ──
    const configChildren: TreeViewNode[] = [
      new ActionNode('Login with OpenCode', 'opencode-zen.openUsageWebview', 'sign-in'),
      new ActionNode('Configure Workspace URL', 'opencode-zen.pasteWorkspaceUrl', 'link-external'),
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

class HeaderNode extends TreeItem {
  constructor(label: string, public readonly children: TreeViewNode[]) {
    super(label, TreeItemCollapsibleState.Expanded);
    this.iconPath = new ThemeIcon('folder');
  }
}

class StatNode extends TreeItem {
  constructor(label: string, desc: string) {
    super(label, TreeItemCollapsibleState.None);
    this.description = desc;
    this.iconPath = new ThemeIcon('graph');
  }
}

class ActionNode extends TreeItem {
  constructor(label: string, command: string, icon: string) {
    super(label, TreeItemCollapsibleState.None);
    this.iconPath = new ThemeIcon(icon);
    this.command = { command, title: label };
  }
}

class InfoNode extends TreeItem {
  constructor(text: string) {
    super(text, TreeItemCollapsibleState.None);
    this.iconPath = new ThemeIcon('info');
  }
}
