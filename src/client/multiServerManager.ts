import { ServerConfig, SecretStorage } from '../config/secretStorage';

export interface ServerInfo {
  available: boolean;
  port?: number;
  version?: string;
  healthChecked: boolean;
  serverId: string;
  baseUrl: string;
}

export interface ServerUserInfo {
  username: string;
  providerCount: number;
  modelCount: number;
  sessionCount: number;
  activeSessionId?: string;
  activeSessionTitle?: string;
  agent?: string;
  model?: string;
  cost?: number;
  tokens?: {
    input: number;
    output: number;
    reasoning: number;
    cache: { read: number; write: number };
  };
}

export interface ServerProviderInfo {
  id: string;
  name: string;
  source: string;
  modelCount: number;
  connected: boolean;
  models: Record<string, boolean>;
}

export interface ServerSessionInfo {
  id: string;
  title: string;
  path: string;
  cost: number;
  tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } };
  agent: string;
  model: string;
  updatedAt: number;
}

interface ConnectedServer {
  config: ServerConfig;
  info: ServerInfo;
  client: ServerApiClient;
}

export class ServerApiClient {
  private baseUrl: string;
  private username?: string;
  private password?: string;
  private requestTimeout: number;

  constructor(baseUrl: string, username?: string, password?: string, timeout = 5000) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.username = username;
    this.password = password;
    this.requestTimeout = timeout;
  }

  public buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.username && this.password) {
      const encoded = Buffer.from(`${this.username}:${this.password}`).toString('base64');
      headers['Authorization'] = `Basic ${encoded}`;
    }
    return headers;
  }

  private async get<T>(path: string): Promise<T | undefined> {
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        headers: this.buildHeaders(),
        signal: AbortSignal.timeout(this.requestTimeout),
      });
      if (!response.ok) return undefined;
      return await response.json() as T;
    } catch {
      return undefined;
    }
  }

  async healthCheck(): Promise<{ healthy: boolean; version?: string } | undefined> {
    const data = await this.get<{ healthy: boolean; version?: string }>('/global/health');
    return data?.healthy ? data : undefined;
  }

  async getConfig(): Promise<any> {
    return this.get<any>('/config');
  }

  async getProviders(): Promise<any> {
    return this.get<any>('/provider');
  }

  async getSessions(limit = 20): Promise<any[]> {
    const data = await this.get<any[]>(`/session?limit=${limit}`);
    return data ?? [];
  }

  async getSessionStatus(): Promise<Record<string, any>> {
    const data = await this.get<Record<string, any>>('/session/status');
    return data ?? {};
  }

  async getUser(): Promise<ServerUserInfo | undefined> {
    const [config, providers, sessions] = await Promise.all([
      this.getConfig(),
      this.getProviders(),
      this.getSessions(1),
    ]);

    if (!config && !providers && sessions.length === 0) return undefined;

    const activeSession = sessions?.[0];
    const connected = providers?.connected || [];
    let modelCount = 0;
    for (const p of providers?.all || []) {
      modelCount += Object.keys(p.models || {}).length;
    }

    return {
      username: config?.username || 'Unknown',
      providerCount: connected.length,
      modelCount,
      sessionCount: sessions?.length || 0,
      activeSessionId: activeSession?.id,
      activeSessionTitle: activeSession?.title,
      agent: activeSession?.agent,
      model: activeSession?.model?.id,
      cost: activeSession?.cost,
      tokens: activeSession?.tokens,
    };
  }

  async getProvidersInfo(): Promise<ServerProviderInfo[]> {
    const providers = await this.getProviders();
    if (!providers) return [];

    const connected = providers.connected || [];
    return (providers.all || []).map((p: any) => ({
      id: p.id,
      name: p.name,
      source: p.source,
      modelCount: p.connected ? Object.keys(p.models || {}).length : 0,
      connected: p.connected || connected.includes(p.id),
      models: p.models || {},
    }));
  }

  async getSessionsInfo(limit = 20): Promise<ServerSessionInfo[]> {
    const sessions = await this.getSessions(limit);
    return sessions.map((s: any) => ({
      id: s.id,
      title: s.title || 'Untitled Session',
      path: s.path || '',
      cost: s.cost || 0,
      tokens: s.tokens || { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      agent: s.agent || '',
      model: s.model?.id || 'unknown',
      updatedAt: s.updatedAt || Date.now(),
    }));
  }
}

export class MultiServerManager {
  private secretStorage: SecretStorage;
  private connections: Map<string, ConnectedServer> = new Map();
  private configs: ServerConfig[] = [];

  constructor(secretStorage: SecretStorage) {
    this.secretStorage = secretStorage;
  }

  async loadConfigs(): Promise<ServerConfig[]> {
    this.configs = await this.secretStorage.getServerConfigs();
    return this.configs;
  }

  async connectAll(): Promise<Map<string, ConnectedServer>> {
    await this.loadConfigs();
    this.connections.clear();

    for (const config of this.configs) {
      if (!config.enabled) continue;

      const baseUrl = `${config.url}:${config.port}`;
      const password = config.hasPassword ? await this.secretStorage.getServerPassword(config.id) : undefined;
      const client = new ServerApiClient(baseUrl, config.username, password);

      const health = await client.healthCheck();
      if (health?.healthy) {
        const info: ServerInfo = {
          available: true,
          port: config.port,
          version: health.version,
          healthChecked: true,
          serverId: config.id,
          baseUrl,
        };
        this.connections.set(config.id, { config, info, client });
      }
    }

    return this.connections;
  }

  async reconnect(serverId: string): Promise<ConnectedServer | undefined> {
    const config = this.configs.find(c => c.id === serverId);
    if (!config || !config.enabled) return undefined;

    const baseUrl = `${config.url}:${config.port}`;
    const password = config.hasPassword ? await this.secretStorage.getServerPassword(config.id) : undefined;
    const client = new ServerApiClient(baseUrl, config.username, password);
    const health = await client.healthCheck();

    if (health?.healthy) {
      const info: ServerInfo = {
        available: true,
        port: config.port,
        version: health.version,
        healthChecked: true,
        serverId: config.id,
        baseUrl,
      };
      const connected: ConnectedServer = { config, info, client };
      this.connections.set(serverId, connected);
      return connected;
    }
    return undefined;
  }

  getConnected(): Map<string, ConnectedServer> {
    return this.connections;
  }

  getConnectedList(): ConnectedServer[] {
    return Array.from(this.connections.values());
  }

  getConfigs(): ServerConfig[] {
    return this.configs;
  }

  async launchServer(config: ServerConfig): Promise<boolean> {
    try {
      const { spawn } = require('child_process') as typeof import('child_process');

      const host = config.url.replace(/^https?:\/\//, '');
      const args = ['serve', '--host', host, '--port', String(config.port)];

      // Ejecutar como proceso background sin ventana (no más cmd.exe popup)
      const child = spawn('opencode', args, {
        detached: true,
        windowsHide: true,
        stdio: 'ignore',
      });
      child.unref();

      // Esperar a que el servidor arranque
      let attempts = 0;
      while (attempts < 10) {
        await new Promise<void>((resolve) => setTimeout(resolve, 1500));
        const connected = await this.reconnect(config.id);
        if (connected !== undefined) return true;
        attempts++;
      }
      return false;
    } catch {
      return false;
    }
  }
}

let multiServerManager: MultiServerManager | undefined;

export async function initMultiServerManager(secretStorage: SecretStorage): Promise<MultiServerManager> {
  if (!multiServerManager) {
    multiServerManager = new MultiServerManager(secretStorage);
    await multiServerManager.connectAll();
  }
  return multiServerManager;
}

export function getMultiServerManager(): MultiServerManager | undefined {
  return multiServerManager;
}