import * as vscode from 'vscode';

export interface ConfigTreeItem extends vscode.TreeItem {
  children?: ConfigTreeItem[];
}

export class ConfigTreeProvider implements vscode.TreeDataProvider<ConfigTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ConfigTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private zenKey: string = '';
  private goKey: string = '';

  update(zenKey: string, goKey: string): void {
    this.zenKey = zenKey;
    this.goKey = goKey;
    this._onDidChangeTreeData.fire();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ConfigTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ConfigTreeItem): ConfigTreeItem[] {
    if (!element) {
      return [
        this.button('configure-zen', '🔵 Configure Zen Key', this.zenKey ? `Current: ${this.mask(this.zenKey)}` : 'Not configured', 'opencodeConfigureZen'),
        this.button('configure-go', '🟢 Configure Go Key', this.goKey ? `Current: ${this.mask(this.goKey)}` : 'Not configured', 'opencodeConfigureGo'),
        this.button('refresh-all', '🔄 Refresh All Models', 'Reload models from API', 'opencodeRefreshAll'),
        this.button('clear-stats', '🗑️ Clear Usage Stats', 'Reset session statistics', 'opencodeClearUsage'),
      ];
    }
    return element.children ?? [];
  }

  private button(id: string, label: string, desc: string, command: string): ConfigTreeItem {
    return {
      id,
      label,
      description: desc,
      collapsibleState: vscode.TreeItemCollapsibleState.None,
      contextValue: 'opencodeConfigAction',
      command: {
        title: label,
        command,
        arguments: [],
      },
    };
  }

  private mask(key: string): string {
    if (key.length <= 8) return '••••';
    return `${key.slice(0, 6)}…${key.slice(-4)}`;
  }
}