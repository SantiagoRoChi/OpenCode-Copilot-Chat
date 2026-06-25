import { window, LanguageModelChatInformation, LanguageModelChatRequestMessage, ProvideLanguageModelChatResponseOptions, Progress, LanguageModelResponsePart, CancellationToken, LanguageModelChatTool } from 'vscode';
import { BaseProvider, RoutedModelInfo } from './BaseProvider';
import { ServerApiClient } from '../client/multiServerManager';
import { getModelCapabilities } from '../client/modelRegistry';
import { streamOpenAIChat } from './sdk/openaiChat';

interface ServerEntry {
  name: string;
  baseUrl: string;
  client: ServerApiClient;
  connected: boolean;
}

export class OpenCodeServerProvider extends BaseProvider {
  private readonly servers = new Map<string, ServerEntry>();
  private readonly out = window.createOutputChannel('OpenCode Servers');

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
   * Stream chat via the local OpenCode Server using the OpenAI SDK.
   * Builds fresh auth headers via the client on every call.
   */
  override async provideLanguageModelChatResponse(
    model: LanguageModelChatInformation,
    messages: readonly LanguageModelChatRequestMessage[],
    options: ProvideLanguageModelChatResponseOptions,
    progress: Progress<LanguageModelResponsePart>,
    token: CancellationToken
  ): Promise<void> {
    const rm = model as RoutedModelInfo; // safe: routing data embedded at construction
    const tools = (options as unknown as { tools?: LanguageModelChatTool[] }).tools;

    // OpenCode Server uses OpenAI-compatible API
    // Clean the base URL - remove the chat completions path if present
    let baseUrl = rm._url;
    if (baseUrl.includes('/v1/chat/completions')) {
      baseUrl = baseUrl.replace(/\/v1\/chat\/completions$/, '');
    } else if (baseUrl.includes('/chat/completions')) {
      baseUrl = baseUrl.replace(/\/chat\/completions$/, '');
    }
    
    const apiKey = rm._headers['Authorization']?.replace('Bearer ', '') ?? '';

    this.out.appendLine(`[Server] Requesting ${rm._apiId} at ${baseUrl}`);

    try {
      await streamOpenAIChat(
        apiKey,
        baseUrl,
        rm._apiId,
        rm.maxOutputTokens,
        messages,
        tools,
        options.modelOptions ?? {},
        progress,
        token,
      );
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.out.appendLine(`[Server] Error for ${rm._apiId}: ${errorMsg}`);
      
      // Provide more helpful error message
      if (errorMsg.includes('Not Found') || errorMsg.includes('404')) {
        throw new Error(`Model "${rm._apiId}" not found on server. The model may not be available or the server configuration is incorrect.`);
      }
      throw err;
    }
  }

  protected async getModels(): Promise<RoutedModelInfo[]> {
    const all: RoutedModelInfo[] = [];
    const seen = new Set<string>(); // Track seen model IDs to avoid duplicates

    for (const [serverId, entry] of this.servers) {
      try {
        const providers = await entry.client.getProviders();
        if (!providers) { entry.connected = false; continue; }

        entry.connected = true;
        const connected: string[] = providers.connected ?? [];
        let count = 0;

        for (const provider of providers.all ?? []) {
          if (!(provider.connected || connected.includes(provider.id))) continue;

          for (const [modelId, modelData] of Object.entries(provider.models ?? {})) {
            const data = modelData as Record<string, unknown> | undefined;
            // Create unique ID to prevent duplicates across servers
            const uniqueId = `${serverId}:${modelId}`;
            
            // Skip if we've already seen this model
            if (seen.has(uniqueId)) continue;
            seen.add(uniqueId);
            
            const isRich = typeof data === 'object' && data !== null;
            const caps = getModelCapabilities(modelId);
            const maxInput: number  = isRich ? (data!['maxTokens'] as number)      : caps.maxInputTokens;
            const maxOutput: number = isRich ? (data!['maxOutputTokens'] as number) : caps.maxOutputTokens;
            const name: string      = isRich ? (data!['name'] as string)            : caps.name;

            const headers = entry.client.buildHeaders();
            const { 'Content-Type': _ct, ...authHeaders } = headers;

            all.push({
              id: uniqueId,
              name: `${name} (${entry.name})`,
              family: provider.name,
              version: isRich ? (data!['version'] as string) : '1',
              maxInputTokens: maxInput,
              maxOutputTokens: maxOutput,
              capabilities: {
                toolCalling: (isRich && data!['toolCalling'] as boolean) ?? caps.toolCalling,
                imageInput:  (isRich && data!['vision'] as boolean)      ?? caps.imageInput,
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
