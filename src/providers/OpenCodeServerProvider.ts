import * as vscode from 'vscode';
import { OpenAICompatibleProvider, RoutedModelInfo } from './OpenAICompatibleProvider';
import { ServerApiClient } from '../client/multiServerManager';
import { getModelCapabilities } from '../client/modelRegistry';
import { streamCompatChat } from './sdk/compatChat';

interface ServerEntry {
  name: string;
  baseUrl: string;
  client: ServerApiClient;
  connected: boolean;
}

export class OpenCodeServerProvider extends OpenAICompatibleProvider {
  private readonly servers = new Map<string, ServerEntry>();
  private readonly out = vscode.window.createOutputChannel('OpenCode Servers');

  get vendor(): string { return 'opencode-server'; }

  addServer(serverId: string, name: string, baseUrl: string, client: ServerApiClient): void {
    this.servers.set(serverId, { name, baseUrl: baseUrl.replace(/\/$/, ''), client, connected: true });
    this.invalidateCache();
    void this.getModels().then(m => { this.models = m; this.fire(); }).catch(() => undefined);
  }

  removeServer(serverId: string): void {
    this.servers.delete(serverId);
    this.invalidateCache();
    void this.getModels().then(m => { this.models = m; this.fire(); }).catch(() => undefined);
  }

  protected getEndpoint(_compositeId: string): never { throw new Error('not used'); }

  /**
   * Stream chat via the local OpenCode Server using the compat HTTP helper.
   * Builds fresh auth headers via the client on every call.
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

    await streamCompatChat(
      rm._url,
      rm._headers,
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
        const providers = await entry.client.getProviders();
        if (!providers) { entry.connected = false; continue; }

        entry.connected = true;
        const connected: string[] = providers.connected ?? [];
        let count = 0;

        for (const provider of providers.all ?? []) {
          if (!(provider.connected || connected.includes(provider.id))) continue;

          for (const [modelId, modelData] of Object.entries(provider.models ?? {}) as [string, any][]) {
            const uniqueId = `${serverId}:${modelId}`;
            const isRich = typeof modelData === 'object' && modelData !== null;
            const caps = getModelCapabilities(modelId);
            const maxInput: number  = (isRich && modelData.maxTokens)      ?? caps.maxInputTokens;
            const maxOutput: number = (isRich && modelData.maxOutputTokens) ?? caps.maxOutputTokens;
            const name: string      = (isRich && modelData.name)            ?? caps.name;

            const headers = entry.client.buildHeaders();
            const { 'Content-Type': _ct, ...authHeaders } = headers;

            all.push({
              id: uniqueId,
              name: `${name} (${entry.name})`,
              family: provider.name,
              version: (isRich && modelData.version) ?? '1',
              maxInputTokens: maxInput,
              maxOutputTokens: maxOutput,
              capabilities: {
                toolCalling: (isRich && modelData.toolCalling) ?? caps.toolCalling,
                imageInput:  (isRich && modelData.vision)      ?? caps.imageInput,
              },
              _url: `${entry.baseUrl}/v1/chat/completions`,
              _headers: authHeaders,
              _apiId: modelId,
              _apiFormat: 'openai-compatible',
            });
            count++;
          }
        }

        this.out.appendLine(`[Servers] "${entry.name}": ${count} models`);
      } catch (err) {
        entry.connected = false;
        this.out.appendLine(`[Servers] "${entry.name}" error: ${err}`);
      }
    }

    return all;
  }

  override dispose(): void {
    this.out.dispose();
    super.dispose();
  }
}
