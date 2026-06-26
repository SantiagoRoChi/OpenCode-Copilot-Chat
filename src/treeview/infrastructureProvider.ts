import { EventEmitter, ThemeIcon, TreeDataProvider, TreeItem, TreeItemCollapsibleState, ProviderResult } from 'vscode';

export interface ModelItem {
  id: string;
  name: string;
  vendor: string;
  capabilities: string[];
  contextSize: number;
}

export interface ServerItem {
  id: string;
  name: string;
  type: 'opencode-zen' | 'opencode-go' | 'opencode-free' | 'lmstudio' | 'ollama' | 'opencode-server';
  url: string;
  online: boolean;
  keyConfigured: boolean;
  models: ModelItem[];
}

type Node = ServerRootNode | ModelLeafNode | EmptyNode;

function serverIcon(type: ServerItem['type']): ThemeIcon {
  switch (type) {
    case 'opencode-zen':
    case 'opencode-go':
    case 'opencode-free':
      return new ThemeIcon('cloud');
    case 'lmstudio':
      return new ThemeIcon('chip');
    case 'ollama':
      return new ThemeIcon('zap');
    case 'opencode-server':
      return new ThemeIcon('server');
  }
}

function serverLabel(item: ServerItem): string {
  const icons: Record<string, string> = {
    'opencode-zen': '🔌',
    'opencode-go': '🔌',
    'opencode-free': '🔌',
    'lmstudio': '🔌',
    'ollama': '🔌',
    'opencode-server': '🔌',
  };
  return `${icons[item.type]} ${item.name}`;
}

function modelCapabilities(model: ModelItem): string {
  const caps: string[] = [];
  const capSet = new Set(model.capabilities.map(c => c.toLowerCase()));
  if (capSet.has('chat') || capSet.has('text')) caps.push('Chat');
  if (capSet.has('tool calling') || capSet.has('toolcalling') || capSet.has('tools')) caps.push('Tools');
  if (capSet.has('vision') || capSet.has('image input') || capSet.has('imageinput') || capSet.has('multimodal')) caps.push('Vision');
  if (capSet.has('embedding') || capSet.has('embeddings')) caps.push('Embedding');
  return caps.join(', ') || 'Chat';
}

export class InfrastructureTreeProvider implements TreeDataProvider<Node> {
  private _onDidChangeTreeData = new EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private servers: ServerItem[] = [];

  refresh(servers: ServerItem[]): void {
    this.servers = servers;
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: Node): TreeItem {
    return element;
  }

  getChildren(element?: Node): ProviderResult<Node[]> {
    if (!element) return this.getRootNodes();
    if (element instanceof ServerRootNode) return element.modelNodes;
    return [];
  }

  private getRootNodes(): Node[] {
    if (this.servers.length === 0) {
      return [new EmptyNode('No servers configured')];
    }
    return this.servers.map(s => new ServerRootNode(s));
  }
}

class ServerRootNode extends TreeItem {
  readonly modelNodes: ModelLeafNode[];

  constructor(public readonly server: ServerItem) {
    const modelCount = server.models.length;
    const desc = server.online
      ? `${modelCount} model${modelCount !== 1 ? 's' : ''} · ${server.type === 'lmstudio' || server.type === 'ollama' || server.type === 'opencode-server' ? server.url : 'cloud'}`
      : 'offline';

    super(
      serverLabel(server),
      modelCount > 0 ? TreeItemCollapsibleState.Collapsed : TreeItemCollapsibleState.None
    );

    this.id = `server-${server.id}`;
    this.description = desc;
    this.iconPath = serverIcon(server.type);
    this.contextValue = 'server';
    this.tooltip = `${server.name}\nType: ${server.type}\nURL: ${server.url}\nModels: ${modelCount}\nStatus: ${server.online ? 'Online' : 'Offline'}`;

    if (!server.online) {
      this.label = `◌ ${server.name}`;
      this.description = 'offline';
    }

    this.modelNodes = server.models.map(m => new ModelLeafNode(m, server));
  }
}

class ModelLeafNode extends TreeItem {
  constructor(public readonly model: ModelItem, public readonly server: ServerItem) {
    const caps = modelCapabilities(model);
    const ctx = model.contextSize > 0 ? ` · ${fmtCtx(model.contextSize)}` : '';

    super(`${model.name}`, TreeItemCollapsibleState.None);

    this.id = `model-${server.id}-${model.id}`;
    this.description = `${caps}${ctx}`;
    this.iconPath = new ThemeIcon('symbol-misc');
    this.contextValue = 'model';
    this.tooltip = `${model.name}\nVendor: ${model.vendor}\nServer: ${server.name}\nCapabilities: ${caps}\nContext: ${model.contextSize.toLocaleString()} tokens`;
  }
}

class EmptyNode extends TreeItem {
  constructor(text: string) {
    super(text, TreeItemCollapsibleState.None);
    this.iconPath = new ThemeIcon('info');
  }
}

function fmtCtx(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(0)}K ctx`;
  return `${n} ctx`;
}
