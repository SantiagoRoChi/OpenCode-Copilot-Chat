import * as vscode from 'vscode';

const ZEN_SECRET_KEY = 'opencode-zen.zenKey';
const GO_SECRET_KEY = 'opencode-zen.goKey';
const SERVER_CONFIGS_KEY = 'opencode-zen.serverConfigs';
const LOCAL_SERVER_CONFIGS_KEY = 'opencode-zen.localServerConfigs';

export interface ServerConfig {
  id: string;
  name: string;
  url: string;
  port: number;
  username?: string;
  hasPassword?: boolean;
  enabled: boolean;
  isLocal: boolean;
}

export type LocalServerKind = 'lmstudio' | 'ollama';

export interface LocalServerConfig {
  id: string;
  kind: LocalServerKind;
  name: string;
  baseUrl: string;
  enabled: boolean;
}

export class SecretStorage {
  private secrets: vscode.SecretStorage;
  private state: vscode.Memento;

  constructor(context: vscode.ExtensionContext) {
    this.secrets = context.secrets;
    this.state = context.workspaceState;
  }

  async getZenKey(): Promise<string> {
    const key = await this.secrets.get(ZEN_SECRET_KEY);
    return key ?? '';
  }

  async setZenKey(apiKey: string): Promise<void> {
    if (apiKey.trim().length === 0) {
      await this.secrets.delete(ZEN_SECRET_KEY);
    } else {
      await this.secrets.store(ZEN_SECRET_KEY, apiKey.trim());
    }
  }

  async clearZenKey(): Promise<void> {
    await this.secrets.delete(ZEN_SECRET_KEY);
  }

  async getGoKey(): Promise<string> {
    const key = await this.secrets.get(GO_SECRET_KEY);
    return key ?? '';
  }

  async setGoKey(apiKey: string): Promise<void> {
    if (apiKey.trim().length === 0) {
      await this.secrets.delete(GO_SECRET_KEY);
    } else {
      await this.secrets.store(GO_SECRET_KEY, apiKey.trim());
    }
  }

  async clearGoKey(): Promise<void> {
    await this.secrets.delete(GO_SECRET_KEY);
  }

  async getServerConfigs(): Promise<ServerConfig[]> {
    const stored = this.state.get<string>(SERVER_CONFIGS_KEY);
    if (!stored) return this.getDefaultLocalConfig();
    try {
      return JSON.parse(stored) as ServerConfig[];
    } catch {
      return this.getDefaultLocalConfig();
    }
  }

  private getDefaultLocalConfig(): ServerConfig[] {
    return [{
      id: 'local-default',
      name: 'Local OpenCode',
      url: 'http://127.0.0.1',
      port: 4096,
      enabled: true,
      isLocal: true,
    }];
  }

  async setServerConfigs(configs: ServerConfig[]): Promise<void> {
    await this.state.update(SERVER_CONFIGS_KEY, JSON.stringify(configs));
  }

  async getServerPassword(serverId: string): Promise<string> {
    const key = `opencode-zen.serverpwd:${serverId}`;
    const pwd = await this.secrets.get(key);
    return pwd ?? '';
  }

  async setServerPassword(serverId: string, password: string): Promise<void> {
    const key = `opencode-zen.serverpwd:${serverId}`;
    if (password.trim().length === 0) {
      await this.secrets.delete(key);
    } else {
      await this.secrets.store(key, password.trim());
    }
  }

  // ── Local server persistence (LMStudio / Ollama) ─────────────────────────

  async getLocalServerConfigs(): Promise<LocalServerConfig[]> {
    const stored = this.state.get<string>(LOCAL_SERVER_CONFIGS_KEY);
    if (!stored) return [];
    try {
      const parsed = JSON.parse(stored) as LocalServerConfig[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async setLocalServerConfigs(configs: LocalServerConfig[]): Promise<void> {
    await this.state.update(LOCAL_SERVER_CONFIGS_KEY, JSON.stringify(configs));
  }
}