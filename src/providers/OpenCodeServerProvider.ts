import * as vscode from 'vscode';
import { ServerApiClient } from '../client/multiServerManager';
import { SecretStorage } from '../config/secretStorage';
import { UsageTracker } from '../usage/UsageTracker';
import {
  TokenUsage,
  SessionStats,
  LastRequest,
  ReasonerStep,
  ToolDefinition,
  ChatMessage,
} from '../client/types';
import { streamResponse } from '../streaming/responseStreamer';
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

const MODEL_CACHE_TTL = 5 * 60 * 1000;

export interface ServerModelInfo {
  id: string;
  name: string;
  family: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  contextLabel: string;
  capabilityLabels: string[];
}

export type ServerRequestStateEvent =
  | { kind: 'start'; modelId: string; modelName: string }
  | { kind: 'complete'; modelId: string; modelName: string; usage?: TokenUsage }
  | { kind: 'error'; modelId: string; modelName: string; errorMessage: string };

export class OpenCodeServerProvider implements vscode.LanguageModelChatProvider {
  private models: vscode.LanguageModelChatInformation[] = [];
  private modelInfoMap = new Map<string, ServerModelInfo>();
  private lastFetch = 0;
  private readonly serverId: string;
  private readonly serverName: string;
  private readonly baseUrl: string;
  private readonly serverClient: ServerApiClient;
  private readonly usageTracker: UsageTracker;
  private readonly outputChannel: vscode.OutputChannel;
  private readonly providerSessionId: string;
  private sessionStats: SessionStats = {
    requestCount: 0,
    totalTokens: { prompt: 0, completion: 0, total: 0 },
  };
  private lastRequest?: LastRequest;
  private readonly _onDidChangeLanguageModelChatInformation = new vscode.EventEmitter<void>();
  private readonly _onDidChangeRequestState = new vscode.EventEmitter<ServerRequestStateEvent>();

  readonly onDidChangeLanguageModelChatInformation = this._onDidChangeLanguageModelChatInformation.event;
  readonly onDidChangeRequestState = this._onDidChangeRequestState.event;

  get vendor(): string { return `opencode-server-${this.serverId}`; }
  get displayName(): string { return `OpenCode ${this.serverName}`; }

  constructor(
    context: vscode.ExtensionContext,
    serverId: string,
    serverName: string,
    baseUrl: string,
    serverClient: ServerApiClient
  ) {
    this.serverId = serverId;
    this.serverName = serverName;
    this.baseUrl = baseUrl;
    this.serverClient = serverClient;
    this.usageTracker = new UsageTracker();
    this.outputChannel = vscode.window.createOutputChannel(`OpenCode ${serverName}`);
    this.providerSessionId = `server-${serverId}-${Date.now()}`;
  }

  async loadApiKey(): Promise<void> {
  }

  async setApiKey(_key: string): Promise<void> {
  }

  getUsageTracker(): UsageTracker {
    return this.usageTracker;
  }

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
    if (now - this.lastFetch > MODEL_CACHE_TTL || this.models.length === 0) {
      await this.fetchModels();
    }
    return this.models;
  }

  async fetchModels(): Promise<void> {
    try {
      const providers = await this.serverClient.getProviders();
      if (!providers) return;

      const allModels: vscode.LanguageModelChatInformation[] = [];
      const connectedIds = providers.connected || [];

      for (const provider of providers.all || []) {
        const isConnected = provider.connected || connectedIds.includes(provider.id);
        if (!isConnected) continue;

        const modelEntries = Object.entries(provider.models || {}) as [string, any][];
        for (const [modelId, modelData] of modelEntries) {
          const info: ServerModelInfo = {
            id: modelId,
            name: modelData.name || modelId.split('/').pop() || modelId,
            family: provider.name,
            maxInputTokens: modelData.maxTokens || TOKEN_CONSTANTS.DEFAULT_CONTEXT_TOKENS,
            maxOutputTokens: modelData.maxOutputTokens || TOKEN_CONSTANTS.DEFAULT_OUTPUT_TOKENS,
            contextLabel: provider.name,
            capabilityLabels: [],
          };

          if (modelData.supportsImages) info.capabilityLabels.push('Vision');
          if (modelData.supportsTools) info.capabilityLabels.push('Tools');
          if (modelData.supportsStreaming) info.capabilityLabels.push('Streaming');

          this.modelInfoMap.set(modelId, info);

          const label = `${info.name} @ ${this.serverName}`;
          allModels.push({
            id: modelId,
            name: label,
            description: `${provider.name} · ${info.maxInputTokens.toLocaleString()} in · ${info.maxOutputTokens.toLocaleString()} out`,
            vendor: this.vendor,
            family: provider.name,
            version: modelData.version || '1',
            maxInputTokens: info.maxInputTokens,
            maxOutputTokens: info.maxOutputTokens,
            supportedLanguageModelCapabilities: [
              vscode.LanguageModelChatCapability.InContextLearning,
            ],
          });
        }
      }

      this.models = allModels;
      this.lastFetch = Date.now();
    } catch (err) {
      this.outputChannel.appendLine(`Failed to fetch models: ${err}`);
    }
  }

  refreshModels(): void {
    this.lastFetch = 0;
    this._onDidChangeLanguageModelChatInformation.fire();
  }

  invalidateCache(): void {
    this.lastFetch = 0;
  }

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    let hasImages = false;
    try {
      hasImages = messages.some(msg =>
        msg.content.some(part => {
          try {
            return part instanceof vscode.LanguageModelImagePart;
          } catch {
            return false;
          }
        })
      );
    } catch {
      hasImages = false;
    }

    if (hasImages) {
      this.outputChannel.appendLine(`ERROR: Image input not supported for model ${model.id}`);
      vscode.window.showWarningMessage(`OpenCode ${this.serverName}: This model does not support image input.`);
      return;
    }

    const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const modelName = this.modelInfoMap.get(model.id)?.name ?? model.id;

    this.outputChannel.appendLine(
      `[${this.serverName}] request: id=${requestId} model=${model.id}`
    );
    this._onDidChangeRequestState.fire({ kind: 'start', modelId: model.id, modelName });

    try {
      const convertedMessages = await Promise.all(
        messages.map(msg => convertMessage(msg))
      );

      const modelMaxContext = model.maxInputTokens || TOKEN_CONSTANTS.DEFAULT_CONTEXT_TOKENS;
      const configuredMaxOutput = model.maxOutputTokens || TOKEN_CONSTANTS.DEFAULT_OUTPUT_TOKENS;
      const toolsSerializedLength = options.tools ? JSON.stringify(options.tools).length : 0;

      const maxInputTokens = calculateMaxInputTokens({
        modelMaxContext,
        configuredMaxOutput,
        toolsSerializedLength,
      });

      const truncatedMessages = truncateMessagesToFit(
        convertedMessages as unknown as Record<string, unknown>[],
        maxInputTokens,
        (msg) => this.outputChannel.appendLine(msg)
      ) as unknown as ChatMessage[];

      const inputText = buildInputText(truncatedMessages as unknown as Record<string, unknown>[]);
      const estimatedInputTokens = estimateTextTokens(inputText);
      const safeMaxOutputTokens = calculateSafeMaxOutputTokens({
        estimatedInputTokens,
        modelMaxContext,
        configuredMaxOutput,
      });

      const tools = options.tools
        ? options.tools.map(t => ({
            type: 'function' as const,
            function: {
              name: t.name,
              description: t.description || '',
              parameters: t.inputSchema as { type: 'object'; properties?: Record<string, unknown>; required?: string[] },
            },
          }))
        : undefined;

      const config = await loadConfig();
      const requestBody: any = {
        model: model.id,
        messages: truncatedMessages,
        max_tokens: safeMaxOutputTokens,
        stream: true,
      };

      if (tools) {
        requestBody.tools = tools;
        requestBody.temperature = config.agentTemperature;
        requestBody.parallel_tool_calls = config.parallelToolCalling;
      } else {
        requestBody.temperature = config.agentTemperature || DEFAULT_TEMPERATURE;
      }

      const requestOptions: RequestInit = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.serverClient as any).buildHeaders?.() || {},
        },
        body: JSON.stringify(requestBody),
        signal: token ? (token as any) : undefined,
      };

      const response = await fetch(`${this.baseUrl}/chat`, requestOptions);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const result = await streamResponse(
        response,
        progress,
        token,
        (part) => {
          if (part.usage) {
            this.trackUsage(part.usage);
          }
        }
      );

      this.lastRequest = {
        modelId: model.id,
        modelName,
        timestamp: Date.now(),
        inputTokens: result.usage?.prompt || estimatedInputTokens,
        outputTokens: result.usage?.completion || 0,
      };

      this.sessionStats.requestCount++;
      this.sessionStats.totalTokens.prompt += this.lastRequest.inputTokens;
      this.sessionStats.totalTokens.completion += this.lastRequest.outputTokens;
      this.sessionStats.totalTokens.total += this.lastRequest.inputTokens + this.lastRequest.outputTokens;

      const usage: TokenUsage = {
        prompt: this.lastRequest.inputTokens,
        completion: this.lastRequest.outputTokens,
        total: this.lastRequest.inputTokens + this.lastRequest.outputTokens,
      };

      this.usageTracker.recordRequest(model.id, modelName, this.serverName, usage, this.providerSessionId);
      this._onDidChangeRequestState.fire({ kind: 'complete', modelId: model.id, modelName, usage });

      this.outputChannel.appendLine(
        `[${this.serverName}] response: id=${requestId} tokens=${usage.total}`
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.outputChannel.appendLine(`[${this.serverName}] ERROR: ${errorMessage}`);
      this._onDidChangeRequestState.fire({ kind: 'error', modelId: model.id, modelName, errorMessage });

      const errorMsg = typeof errorMessage === 'string'
        ? errorMessage.length > 200 ? errorMessage.slice(0, 200) + '…' : errorMessage
        : 'Request failed';
      progress.report({ content: `ERROR: ${errorMsg}` });
    }
  }

  private trackUsage(usage: { prompt?: number; completion?: number }): void {
  }

  showOutput(): void {
    this.outputChannel.show();
  }

  appendOutput(text: string): void {
    this.outputChannel.appendLine(text);
  }

  dispose(): void {
    this.outputChannel.dispose();
    this._onDidChangeLanguageModelChatInformation.dispose();
    this._onDidChangeRequestState.dispose();
  }
}

const DEFAULT_TEMPERATURE = 0.7;