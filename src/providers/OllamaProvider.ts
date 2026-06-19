import * as vscode from 'vscode';
import { BaseProvider, RoutedModelInfo } from './OpenAICompatibleProvider';
import { SecretStorage } from '../config/secretStorage';
import { ServerData } from '../webview/openCodeWebviewProvider';
import { streamOpenAIChat } from './sdk/openaiChat';

interface OllamaModelListItem {
  name: string;
  model: string;
  details?: {
    family?: string;
    parameter_size?: string;
    quantization_level?: string;
  };
}

interface OllamaShowResponse {
  capabilities?: string[];
  model_info?: Record<string, unknown>;
}

interface ServerEntry {
  name: string;
  baseUrl: string;
  connected: boolean;
}

export class OllamaProvider extends BaseProvider {
  private readonly servers = new Map<string, ServerEntry>();
  private readonly showCache = new Map<string, RoutedModelInfo>();
  private readonly out = vscode.window.createOutputChannel('Ollama');
  private readonly storage?: SecretStorage;

  constructor(storage?: SecretStorage) {
    super();
    this.storage = storage;
  }

  get vendor(): string { return 'ollama-plus'; }

  /** Load persisted Ollama servers from workspace state. */
  async loadPersistedServers(): Promise<void> {
    if (!this.storage) return;
    const configs = await this.storage.getLocalServerConfigs();
    for (const c of configs) {
      if (c.kind === 'ollama' && c.enabled) {
        this.servers.set(c.id, { name: c.name, baseUrl: c.baseUrl.replace(/\/$/, ''), connected: true });
      }
    }
  }

  addServer(serverId: string, name: string, baseUrl: string): void {
    this.servers.set(serverId, { name, baseUrl: baseUrl.replace(/\/$/, ''), connected: true });
    this.invalidateCache();
    void this.persistLocal();
    void this.getModels().then(m => { this.models = m; this.fire(); }).catch(() => undefined);
  }

  removeServer(serverId: string): void {
    this.servers.delete(serverId);
    this.invalidateCache();
    void this.persistLocal();
    void this.getModels().then(m => { this.models = m; this.fire(); }).catch(() => undefined);
  }

  private async persistLocal(): Promise<void> {
    if (!this.storage) return;
    const existing = await this.storage.getLocalServerConfigs();
    const others = existing.filter(c => c.kind !== 'ollama');
    const mine: typeof existing = [];
    for (const [id, entry] of this.servers) {
      mine.push({ id, kind: 'ollama', name: entry.name, baseUrl: entry.baseUrl, enabled: true });
    }
    await this.storage.setLocalServerConfigs([...others, ...mine]);
  }

  /**
   * Stream chat via Ollama using the OpenAI SDK.
   */
  override async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    const rm = model as RoutedModelInfo;
    const tools = (options as any).tools as vscode.LanguageModelChatTool[] | undefined;

    // Ollama uses OpenAI-compatible API at /v1/chat/completions
    const baseUrl = rm._url.replace(/\/v1\/chat\/completions$/, '');

    await streamOpenAIChat(
      '', // Ollama doesn't require API key by default
      baseUrl,
      rm._apiId,
      rm.maxOutputTokens,
      messages,
      tools,
      options.modelOptions ?? {},
      progress,
      token,
    );
  }

  protected async getModels(): Promise<RoutedModelInfo[]> {
    const all: RoutedModelInfo[] = [];

    for (const [serverId, entry] of this.servers) {
      try {
        const res = await fetch(`${entry.baseUrl}/api/tags`, {
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) { entry.connected = false; continue; }

        const data = await res.json() as { models: OllamaModelListItem[] };
        entry.connected = true;

        for (const m of data.models ?? []) {
          const modelId = m.model ?? m.name;
          const cacheKey = `${entry.baseUrl}/${modelId}`;
          let info = this.showCache.get(cacheKey);
          if (!info) {
            info = await this.fetchModelInfo(serverId, entry, modelId);
            this.showCache.set(cacheKey, info);
          }
          all.push(info);
        }
        this.out.appendLine(`[Ollama] "${entry.name}": ${data.models?.length ?? 0} models`);
      } catch (err) {
        entry.connected = false;
        this.out.appendLine(`[Ollama] "${entry.name}" error: ${err}`);
      }
    }

    return all;
  }

  private async fetchModelInfo(
    serverId: string,
    entry: ServerEntry,
    modelId: string
  ): Promise<RoutedModelInfo> {
    let show: OllamaShowResponse = {};
    try {
      const res = await fetch(`${entry.baseUrl}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelId }),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) show = await res.json() as OllamaShowResponse;
    } catch { /* fallback to heuristics */ }

    const caps = show.capabilities ?? [];
    const mi = show.model_info ?? {};
    const arch = (mi['general.architecture'] as string | undefined) ?? '';
    const contextWindow = (mi[`${arch}.context_length`] as number | undefined) ?? 32768;
    const maxOutput = Math.min(contextWindow < 4096 ? Math.floor(contextWindow / 2) : 4096, contextWindow);
    const maxInput = contextWindow - maxOutput;
    const displayName = modelId.split(':')[0];

    return {
      id: `${serverId}:${modelId}`,
      name: `${displayName} (${entry.name})`,
      family: arch || displayName,
      version: '1',
      maxInputTokens: maxInput,
      maxOutputTokens: maxOutput,
      capabilities: {
        toolCalling: caps.includes('tools'),
        imageInput: caps.includes('vision'),
      },
      _url: `${entry.baseUrl}/v1/chat/completions`,
      _headers: {},
      _apiId: modelId,
      _apiFormat: 'openai-compatible',
    };
  }

  override dispose(): void {
    this.out.dispose();
    super.dispose();
  }

  getServerList(): ServerData[] {
    const list: ServerData[] = [];
    for (const [id, entry] of this.servers) {
      list.push({
        id,
        name: entry.name,
        url: entry.baseUrl,
        available: entry.connected,
        models: [],
        providerCount: 0,
        type: 'ollama-plus',
      });
    }
    return list;
  }
}
