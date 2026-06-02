import * as vscode from 'vscode';
import { ServerApiClient, ConnectedServer } from '../client/multiServerManager';
import { UsageTracker } from '../usage/UsageTracker';
import {
  TokenUsage,
  SessionStats,
  LastRequest,
  ChatMessage,
} from '../client/types';
import { streamResponse, StreamReporter } from '../streaming/responseStreamer';
import { convertMessage } from '../streaming/messageConverter';
import {
  TOKEN_CONSTANTS,
  estimateTextTokens,
  calculateMaxInputTokens,
  calculateSafeMaxOutputTokens,
  truncateMessagesToFit,
  buildInputText,
} from '../utils/tokenEstimate';
import { loadConfig } from '../config/settings';
import { getModelCapabilities } from '../client/modelRegistry';

export type ServerRequestStateEvent =
  | { kind: 'start'; modelId: string; modelName: string }
  | { kind: 'complete'; modelId: string; modelName: string; usage?: TokenUsage }
  | { kind: 'error'; modelId: string; modelName: string; errorMessage: string };

export interface ServerModelInfo {
  id: string;
  name: string;
  family: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  contextLabel: string;
  capabilityLabels: string[];
}

interface ServerEntry {
  serverId: string;
  serverName: string;
  baseUrl: string;
  client: ServerApiClient;
  connected: boolean;
}

export class OpenCodeServerProvider implements vscode.LanguageModelChatProvider {
  private models: vscode.LanguageModelChatInformation[] = [];
  private modelInfoMap = new Map<string, ServerModelInfo>();
  private modelServerMap = new Map<string, ServerEntry>();
  private lastFetch = 0;
  private readonly usageTracker: UsageTracker;
  private readonly outputChannel: vscode.OutputChannel;
  private sessionStats: SessionStats = {
    requestCount: 0,
    totalTokens: { prompt: 0, completion: 0, total: 0 },
  };
  private lastRequest?: LastRequest;
  private readonly _onDidChangeLanguageModelChatInformation = new vscode.EventEmitter<void>();
  private readonly _onDidChangeRequestState = new vscode.EventEmitter<ServerRequestStateEvent>();

  readonly onDidChangeLanguageModelChatInformation = this._onDidChangeLanguageModelChatInformation.event;
  readonly onDidChangeRequestState = this._onDidChangeRequestState.event;

  public get vendor(): string { return 'opencode-server'; }
  get displayName(): string { return 'OpenCode Servers'; }

  constructor() {
    this.usageTracker = new UsageTracker();
    this.outputChannel = vscode.window.createOutputChannel('OpenCode Servers');
    this.outputChannel.appendLine('[ServerProvider] Created single server provider');
  }

  addServer(entry: ServerEntry): void {
    this.modelServerMap.set(entry.serverId, entry);
    this.outputChannel.appendLine(`[ServerProvider] Added server "${entry.serverName}" (${entry.baseUrl})`);
    this.lastFetch = 0;
    void this.fetchModels().then(() => {
      this._onDidChangeLanguageModelChatInformation.fire();
    });
  }

  removeServer(serverId: string): void {
    this.modelServerMap.delete(serverId);
    this.lastFetch = 0;
    void this.fetchModels().then(() => {
      this._onDidChangeLanguageModelChatInformation.fire();
    });
  }

  getUsageTracker(): UsageTracker { return this.usageTracker; }

  getStatusSnapshot() {
    return {
      connected: true,
      modelCount: this.models.length,
      lastRequest: this.lastRequest,
      sessionStats: this.sessionStats,
    };
  }

  async provideLanguageModelChatInformation(
    options: { silent: boolean; configuration?: { [key: string]: unknown } },
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelChatInformation[]> {
    const now = Date.now();
    if (now - this.lastFetch > 5 * 60 * 1000 || this.models.length === 0) {
      await this.fetchModels();
    }
    this.outputChannel.appendLine(`[ServerProvider] provideLanguageModelChatInformation called, returning ${this.models.length} models`);
    return this.models;
  }

  async fetchModels(): Promise<void> {
    const allModels: vscode.LanguageModelChatInformation[] = [];

    for (const [serverId, entry] of this.modelServerMap) {
      try {
        this.outputChannel.appendLine(`[ServerProvider] Fetching from "${entry.serverName}" (${entry.baseUrl})...`);
        const providers = await entry.client.getProviders();
        if (!providers) {
          this.outputChannel.appendLine(`[ServerProvider] "${entry.serverName}": no providers returned`);
          entry.connected = false;
          continue;
        }

        const connectedIds = providers.connected || [];

        for (const provider of providers.all || []) {
          const isConnected = provider.connected || connectedIds.includes(provider.id);
          if (!isConnected) continue;

          const modelEntries = Object.entries(provider.models || {}) as [string, any][];
          for (const [modelId, modelData] of modelEntries) {
            const uniqueId = `${serverId}:${modelId}`;

            // Get real capabilities from models.dev registry
            const caps = getModelCapabilities(modelId);
            const maxInput = modelData.maxTokens || caps.maxInputTokens;
            const maxOutput = modelData.maxOutputTokens || caps.maxOutputTokens;

            const info: ServerModelInfo = {
              id: modelId,
              name: caps.name !== modelId ? caps.name : (modelData.name || modelId.split('/').pop() || modelId),
              family: caps.family,
              maxInputTokens: maxInput,
              maxOutputTokens: maxOutput,
              contextLabel: `${Math.round(maxInput / 1000)}K`,
              capabilityLabels: [
                ...(caps.toolCalling ? ['Tools'] : []),
                ...(caps.imageInput ? ['Vision'] : []),
                ...(caps.reasoning ? ['Reasoning'] : []),
              ],
            };

            this.modelInfoMap.set(uniqueId, info);

            allModels.push({
              id: uniqueId,
              name: `${info.name} (${entry.serverName})`,
              description: `${provider.name} · ${info.contextLabel} in · ${Math.round(maxOutput / 1000)}K out`,
              vendor: this.vendor,
              family: provider.name,
              version: modelData.version || '1',
              maxInputTokens: maxInput,
              maxOutputTokens: maxOutput,
              capabilities: {
                imageInput: caps.imageInput,
                toolCalling: caps.toolCalling,
              },
            });
            serverModelCount++;
          }
        }

        entry.connected = true;
        this.outputChannel.appendLine(`[ServerProvider] "${entry.serverName}": ${serverModelCount} models registered`);
      } catch (err) {
        entry.connected = false;
        this.outputChannel.appendLine(`[ServerProvider] "${entry.serverName}" ERROR: ${err}`);
      }
    }

    this.models = allModels;
    this.lastFetch = Date.now();
    this.outputChannel.appendLine(`[ServerProvider] Total: ${allModels.length} models from ${this.modelServerMap.size} server(s)`);
  }

  refreshModels(): void {
    this.lastFetch = 0;
    this._onDidChangeLanguageModelChatInformation.fire();
  }

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    const [serverId, modelId] = model.id.split(':');
    const entry = this.modelServerMap.get(serverId);
    if (!entry) {
      throw new Error(`Server ${serverId} not found`);
    }

    const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const info = this.modelInfoMap.get(model.id);
    const modelName = info?.name ?? modelId;

    this.outputChannel.appendLine(`[${entry.serverName}] request: model=${modelId}`);

    try {
      const openaiMessages = this.convertAllMessages(messages);
      const modelMaxContext = model.maxInputTokens || TOKEN_CONSTANTS.DEFAULT_CONTEXT_TOKENS;
      const configuredMaxOutput = model.maxOutputTokens || TOKEN_CONSTANTS.DEFAULT_OUTPUT_TOKENS;
      const toolsSerializedLength = options.tools ? JSON.stringify(options.tools).length : 0;

      const maxInputTokens = calculateMaxInputTokens({
        modelMaxContext, configuredMaxOutput, toolsSerializedLength,
      });

      const truncatedMessages = truncateMessagesToFit(
        openaiMessages as unknown as Record<string, unknown>[],
        maxInputTokens,
        (msg) => this.outputChannel.appendLine(msg)
      ) as unknown as ChatMessage[];

      const inputText = buildInputText(truncatedMessages as unknown as Record<string, unknown>[]);
      const estimatedInputTokens = estimateTextTokens(inputText);
      const toolsOverhead = Math.ceil(toolsSerializedLength / TOKEN_CONSTANTS.CHARS_PER_TOKEN);
      const safeMaxOutputTokens = calculateSafeMaxOutputTokens({
        estimatedInputTokens, toolsOverhead, modelMaxContext, configuredMaxOutput,
      });

      const { tools, schemas } = this.buildToolsConfig(options);
      const hasTools = tools !== undefined && tools.length > 0;

      const requestBody: any = {
        model: modelId,
        messages: truncatedMessages,
        max_tokens: safeMaxOutputTokens,
        temperature: hasTools ? 0 : 0.7,
        stream: true,
        ...(hasTools && { tools, tool_choice: this.mapToolChoice(options.toolMode) }),
      };

      const abortController = new AbortController();
      token.onCancellationRequested(() => abortController.abort());

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const authHeaders = entry.client.buildHeaders();
      Object.assign(headers, authHeaders);

      const response = await fetch(`${entry.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${body}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      const chunks: any[] = [];

      const controller = new ReadableStream({
        start: async (rc) => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';
              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith(':')) continue;
                if (trimmed.startsWith('data: ')) {
                  const data = trimmed.slice(6);
                  if (data === '[DONE]') { rc.close(); return; }
                  try {
                    const chunk = JSON.parse(data);
                    rc.enqueue(chunk);
                  } catch {}
                }
              }
            }
            rc.close();
          } catch (err) { rc.error(err); }
        },
      });

      const reporter: StreamReporter = {
        requestId,
        sessionId: entry.serverId,
        reportText: (text) => progress.report(new vscode.LanguageModelTextPart(text)),
        reportThinking: () => {},
        reportThinkingDone: () => {},
        reportToolCall: (id, name, args) => progress.report(new vscode.LanguageModelToolCallPart(id, name, args)),
        reportUsage: (usage) => {
          this.trackUsage(usage);
        },
        reportReasonerStep: () => {},
        reportThinkingBlock: () => {},
      };

      await streamResponse({
        chunks: chunks.length > 0 ? new ReadableStream({ start: (c) => { chunks.forEach(chunk => c.enqueue(chunk)); c.close(); } }) : controller as any,
        reporter,
        isCancelled: () => token.isCancellationRequested,
        resolveToolCallArgs: (tc) => {
          try { return JSON.parse(tc.function.arguments || '{}'); } catch { return {}; }
        },
      });

      this.lastRequest = { modelId, modelName, completedAt: Date.now() };
      this.sessionStats.requestCount++;
      this.outputChannel.appendLine(`[${entry.serverName}] response complete`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.outputChannel.appendLine(`[${entry.serverName}] ERROR: ${errorMessage}`);
      throw err;
    }
  }

  async provideTokenCount(
    _model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatMessage,
    _token: vscode.CancellationToken
  ): Promise<number> {
    if (typeof text === 'string') return estimateTextTokens(text);
    let tokens = 0;
    for (const part of text.content) {
      if (part instanceof vscode.LanguageModelTextPart) {
        tokens += estimateTextTokens(part.value);
      } else if (part instanceof vscode.LanguageModelToolCallPart) {
        tokens += estimateTextTokens(part.name + JSON.stringify(part.input ?? {}));
      } else if (part instanceof vscode.LanguageModelToolResultPart) {
        const body = typeof part.content === 'string' ? part.content : JSON.stringify(part.content);
        tokens += estimateTextTokens(body);
      }
    }
    return tokens;
  }

  private convertAllMessages(messages: readonly vscode.LanguageModelChatMessage[]): ChatMessage[] {
    const result: ChatMessage[] = [];
    for (const msg of messages) {
      const role = msg.role === vscode.LanguageModelChatMessageRole.Assistant ? 'assistant' : 'user';
      const normalized = {
        role: role as 'user' | 'assistant',
        parts: msg.content.map(part => this.classifyPart(part)),
      };
      result.push(...convertMessage(normalized, true));
    }
    return result;
  }

  private classifyPart(part: unknown): { kind: string; value?: string; callId?: string; name?: string; input?: unknown; content?: string } {
    if (part instanceof vscode.LanguageModelTextPart) return { kind: 'text', value: part.value };
    if (part instanceof vscode.LanguageModelToolResultPart) {
      return { kind: 'toolResult', callId: part.callId, content: typeof part.content === 'string' ? part.content : JSON.stringify(part.content) };
    }
    if (part instanceof vscode.LanguageModelToolCallPart) {
      return { kind: 'toolCall', callId: part.callId, name: part.name, input: part.input };
    }
    const maybeValue = (part as { value?: unknown })?.value;
    if (typeof maybeValue === 'string' && maybeValue.length > 0) return { kind: 'text', value: maybeValue };
    return { kind: 'unknown' };
  }

  private buildToolsConfig(options: vscode.ProvideLanguageModelChatResponseOptions) {
    const schemas = new Map<string, Record<string, unknown> | undefined>();
    if (!options.tools || options.tools.length === 0) return { tools: undefined, schemas };
    const tools = options.tools.map(tool => {
      const schema = tool.inputSchema as Record<string, unknown> | undefined;
      schemas.set(tool.name, schema);
      return { type: 'function', function: { name: tool.name, description: tool.description, parameters: schema } };
    });
    return { tools, schemas };
  }

  private mapToolChoice(mode: vscode.LanguageModelChatToolMode | undefined): 'auto' | 'required' | 'none' | undefined {
    if (mode === vscode.LanguageModelChatToolMode.Required) return 'required';
    if (mode === vscode.LanguageModelChatToolMode.Auto) return 'auto';
    return undefined;
  }

  private trackUsage(usage: { prompt_tokens?: number; completion_tokens?: number }): void {
    this.sessionStats.totalTokens.prompt += usage.prompt_tokens ?? 0;
    this.sessionStats.totalTokens.completion += usage.completion_tokens ?? 0;
    this.sessionStats.totalTokens.total += (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0);
  }

  showOutput(): void { this.outputChannel.show(); }
  appendOutput(text: string): void { this.outputChannel.appendLine(text); }

  dispose(): void {
    this.outputChannel.dispose();
    this._onDidChangeLanguageModelChatInformation.dispose();
    this._onDidChangeRequestState.dispose();
  }
}
