import * as vscode from 'vscode';
import { BaseProvider, RoutedModelInfo } from './OpenAICompatibleProvider';
import { SecretStorage } from '../config/secretStorage';
import { ServerData } from '../webview/openCodeWebviewProvider';
import { streamOpenAIChat } from './sdk/openaiChat';

// Response shape from /api/v1/models (LM Studio native API)
interface LMStudioModel {
  key: string;
  display_name: string;
  type: string;
  publisher?: string;
  architecture?: string;
  quantization?: { name: string; bits_per_weight?: number };
  max_context_length: number;
  capabilities?: {
    vision?: boolean;
    trained_for_tool_use?: boolean;
    reasoning?: { allowed_options?: string[]; default?: string };
  };
  loaded_instances?: Array<{ id: string; state?: string }>;
}

interface ServerEntry {
  name: string;
  baseUrl: string;
  connected: boolean;
}

export class LMStudioProvider extends BaseProvider {
  private readonly servers = new Map<string, ServerEntry>();
  private readonly out = vscode.window.createOutputChannel('LM Studio');
  private readonly storage?: SecretStorage;

  constructor(storage?: SecretStorage) {
    super();
    this.storage = storage;
  }

  get vendor(): string { return 'lmstudio'; }

  /** Load persisted LMStudio servers from workspace state. */
  async loadPersistedServers(): Promise<void> {
    if (!this.storage) return;
    const configs = await this.storage.getLocalServerConfigs();
    for (const c of configs) {
      if (c.kind === 'lmstudio' && c.enabled) {
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
    const others = existing.filter(c => c.kind !== 'lmstudio');
    const mine: typeof existing = [];
    for (const [id, entry] of this.servers) {
      mine.push({ id, kind: 'lmstudio', name: entry.name, baseUrl: entry.baseUrl, enabled: true });
    }
    await this.storage.setLocalServerConfigs([...others, ...mine]);
  }

  /**
   * Stream chat via LM Studio using the OpenAI SDK.
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

    // LM Studio uses OpenAI-compatible API at /v1/chat/completions
    const baseUrl = rm._url.replace(/\/v1\/chat\/completions$/, '');

    await streamOpenAIChat(
      '', // LM Studio doesn't require API key
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
        const res = await fetch(`${entry.baseUrl}/api/v1/models`, {
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) { entry.connected = false; continue; }

        const data = await res.json() as { models: LMStudioModel[] };
        entry.connected = true;

        for (const m of data.models ?? []) {
          if (m.type === 'embedding') continue;

          const contextWindow = m.max_context_length;
          const maxOutput = Math.min(
            contextWindow < 4096 ? Math.floor(contextWindow / 2) : 8192,
            contextWindow
          );
          const displayName = m.display_name;
          const isVision = m.capabilities?.vision === true;
          const supportsTools = m.capabilities?.trained_for_tool_use === true;
          const supportsReasoning = m.capabilities?.reasoning != null;
          const quantStr = m.quantization?.name ?? '';

          const instances = m.loaded_instances && m.loaded_instances.length > 0
            ? m.loaded_instances
            : [{ id: '' }];
          const showDeviceSuffix = instances.length > 1 || (instances.length === 1 && instances[0].id !== '');

          for (const inst of instances) {
            const info: RoutedModelInfo = {
              id: inst.id
                ? `${serverId}:${m.key}@${inst.id}`
                : `${serverId}:${m.key}`,
              name: showDeviceSuffix && inst.id
                ? `${displayName} (${inst.id}) (${entry.name})`
                : `${displayName} (${entry.name})`,
              family: m.architecture ?? displayName,
              version: '1',
              maxInputTokens: contextWindow,
              maxOutputTokens: maxOutput,
              detail: `${quantStr}${quantStr ? ' · ' : ''}${Math.round(contextWindow / 1024)}K ctx${isVision ? ' · vision' : ''}${inst.id ? ' · ' + inst.id : ''}`,
              capabilities: { toolCalling: supportsTools, imageInput: isVision },
              _url: `${entry.baseUrl}/v1/chat/completions`,
              _headers: {},
              _apiId: m.key,
              _apiFormat: 'openai-compatible',
            };

            if (supportsReasoning) {
              (info as any).configurationSchema = {
                properties: {
                  reasoningEffort: {
                    type: 'string',
                    enum: ['low', 'medium', 'high'],
                    default: 'medium',
                    description: 'Reasoning depth for thinking models.',
                    enumItemLabels: ['Low', 'Medium', 'High'],
                  },
                },
              };
            }

            all.push(info);
          }
        }

        this.out.appendLine(`[LMStudio] "${entry.name}": ${all.length} models`);
      } catch (err) {
        entry.connected = false;
        this.out.appendLine(`[LMStudio] "${entry.name}" error: ${err}`);
      }
    }

    return all;
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
        type: 'lmstudio',
      });
    }
    return list;
  }
}

