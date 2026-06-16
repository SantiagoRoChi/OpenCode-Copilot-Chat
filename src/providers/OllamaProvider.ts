import * as vscode from 'vscode';
import { OpenAICompatibleProvider, RoutedModelInfo } from './OpenAICompatibleProvider';

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

export class OllamaProvider extends OpenAICompatibleProvider {
  private readonly servers = new Map<string, ServerEntry>();
  private readonly showCache = new Map<string, RoutedModelInfo>();
  private readonly out = vscode.window.createOutputChannel('Ollama');

  get vendor(): string { return 'ollama-plus'; }

  addServer(serverId: string, name: string, baseUrl: string): void {
    this.servers.set(serverId, { name, baseUrl: baseUrl.replace(/\/$/, ''), connected: true });
    this.invalidateCache();
    void this.getModels().then(m => { this.models = m; this.fire(); }).catch(() => undefined);
  }

  removeServer(serverId: string): void {
    this.servers.delete(serverId);
    this.invalidateCache();
    void this.getModels().then(m => { this.models = m; this.fire(); }).catch(() => undefined);
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
}
