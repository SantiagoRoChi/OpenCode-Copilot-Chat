import * as vscode from 'vscode';
import { OpenCodeClient } from '../client/opencodeClient';
import {
  ApiEndpoint,
  ZEN_BASE_URL,
  GO_BASE_URL,
} from '../client/endpoints';
import {
  ApiModel,
  ApiUsageResponse,
  ChatCompletionRequest,
  ChatMessage,
  StatusSnapshot,
  TokenUsage,
  SessionStats,
  LastRequest,
  ToolDefinition,
  ConnectionState,
  RequestMeta,
  ReasonerStep,
} from '../client/types';
import { SecretStorage } from '../config/secretStorage';
import { loadConfig } from '../config/settings';
import { OpenCodeConnector } from '../integration/opencodeConnector';
import { convertTools, resolveToolCallArgs } from '../tools/toolCallAdapter';
import { streamResponse, StreamReporter, StreamResult } from '../streaming/responseStreamer';
import { convertMessage, NormalizedRole, NormalizedPart } from '../streaming/messageConverter';
import {
  TOKEN_CONSTANTS,
  estimateTextTokens,
  calculateMaxInputTokens,
  calculateSafeMaxOutputTokens,
  truncateMessagesToFit,
  buildInputText,
} from '../utils/tokenEstimate';
import { UsageTracker } from '../usage/UsageTracker';

const DEFAULT_TEMPERATURE = 0.7;
const MODEL_CACHE_TTL = 5 * 60 * 1000;
const USAGE_CACHE_TTL = 60 * 1000;

export type RequestStateEvent =
  | { kind: 'start'; modelId: string; modelName: string }
  | { kind: 'complete'; modelId: string; modelName: string; usage?: TokenUsage }
  | { kind: 'error'; modelId: string; modelName: string; errorMessage: string };

export interface ModelInfo {
  id: string;
  name: string;
  family: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  contextLabel: string;
  capabilityLabels: string[];
}

export abstract class BaseOpenCodeProvider implements vscode.LanguageModelChatProvider {
  protected readonly client: OpenCodeClient;
  protected readonly secretStorage: SecretStorage;
  protected readonly connector: OpenCodeConnector;
  protected readonly usageTracker: UsageTracker;
  protected readonly outputChannel: vscode.OutputChannel;
  protected apiKey: string = '';
  protected models: vscode.LanguageModelChatInformation[] = [];
  protected modelInfoMap: Map<string, ModelInfo> = new Map();
  protected lastFetch = 0;
  protected lastUsage?: ApiUsageResponse;
  protected lastUsageFetch = 0;
  protected sessionStats: SessionStats = {
    requestCount: 0,
    totalTokens: { prompt: 0, completion: 0, total: 0 },
  };
  protected lastRequest?: LastRequest;
  protected readonly providerSessionId: string;
  private readonly _onDidChangeLanguageModelChatInformation = new vscode.EventEmitter<void>();
  readonly onDidChangeLanguageModelChatInformation = this._onDidChangeLanguageModelChatInformation.event;
  private readonly _onDidChangeRequestState = new vscode.EventEmitter<RequestStateEvent>();
  readonly onDidChangeRequestState = this._onDidChangeRequestState.event;

  constructor(
    context: vscode.ExtensionContext,
    protected readonly providerType: 'zen' | 'go' | 'free',
    protected readonly outputChannelName: string
  ) {
    this.outputChannel = vscode.window.createOutputChannel(outputChannelName);
    this.secretStorage = new SecretStorage(context);
    this.client = new OpenCodeClient();
    this.connector = new OpenCodeConnector(this.outputChannel);
    this.usageTracker = new UsageTracker();
    this.providerSessionId = `${providerType}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  abstract get vendor(): string;
  abstract get displayName(): string;
  abstract get endpoint(): ApiEndpoint;
  abstract get keyName(): 'zenKey' | 'goKey';
  abstract filterModels(models: ApiModel[]): ApiModel[];

  async loadApiKey(): Promise<void> {
    if (this.keyName === 'zenKey') {
      this.apiKey = await this.secretStorage.getZenKey();
    } else {
      this.apiKey = await this.secretStorage.getGoKey();
    }
  }

  async setApiKey(key: string): Promise<void> {
    this.apiKey = key;
    if (this.keyName === 'zenKey') {
      await this.secretStorage.setZenKey(key);
    } else {
      await this.secretStorage.setGoKey(key);
    }
    this.invalidateCache();
    // Fire change event so VS Code re-queries models
    this._onDidChangeLanguageModelChatInformation.fire();
    // Trigger immediate fetch in background
    void this.fetchModels().then(() => {
      this._onDidChangeLanguageModelChatInformation.fire();
    });
  }

  getApiKey(): string {
    return this.apiKey;
  }

  protected invalidateCache(): void {
    this.lastFetch = 0;
    this.lastUsage = undefined;
  }

  private async fetchModels(): Promise<vscode.LanguageModelChatInformation[]> {
    this.outputChannel.appendLine(
      `Fetching models from ${this.endpoint} (key ${this.apiKey ? 'set' : 'not set'})...`
    );

    try {
      // Always try to fetch. Some endpoints allow unauthenticated listing.
      // If fetch fails, fall back to no models.
      const response = await this.client.listModels(this.apiKey, this.endpoint);
      const allModels = response.data || [];
      const filteredModels = this.filterModels(allModels);
      this.outputChannel.appendLine(
        `Found ${filteredModels.length} models (${this.outputChannelName})`
      );

      const info: vscode.LanguageModelChatInformation[] = [];
      this.modelInfoMap.clear();
      for (const m of filteredModels) {
        const modelInfo = this.toModelInfo(m);
        this.modelInfoMap.set(m.id, modelInfo);
        info.push(this.toChatInformation(m, modelInfo));
      }
      this.models = info;
      this.lastFetch = Date.now();
      return info;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.outputChannel.appendLine(`Error fetching models: ${msg}`);
      this.models = [];
      this.lastFetch = Date.now();
      return [];
    }
  }

  protected toModelInfo(m: ApiModel): ModelInfo {
    return {
      id: m.id,
      name: m.id,
      family: this.inferFamily(m.id),
      maxInputTokens: 131072,
      maxOutputTokens: 32000,
      contextLabel: '128K ctx',
      capabilityLabels: ['tools'],
    };
  }

  protected toChatInformation(m: ApiModel, info: ModelInfo): vscode.LanguageModelChatInformation {
    return {
      id: m.id,
      name: m.id,
      family: info.family,
      version: m.id,
      maxInputTokens: info.maxInputTokens,
      maxOutputTokens: info.maxOutputTokens,
      tooltip: `${info.name}\n\nContext: ${info.contextLabel}\n\nModel from ${this.displayName}`,
      detail: `${info.contextLabel} · ${this.displayName}`,
      capabilities: {
        imageInput: false,
        toolCalling: true,
      },
    };
  }

  protected inferFamily(id: string): string {
    const lower = id.toLowerCase();
    if (lower.includes('gpt')) return 'openai';
    if (lower.includes('claude')) return 'anthropic';
    if (lower.includes('gemini')) return 'google';
    if (lower.includes('qwen')) return 'qwen';
    if (lower.includes('deepseek')) return 'deepseek';
    if (lower.includes('kimi')) return 'kimi';
    if (lower.includes('glm')) return 'glm';
    if (lower.includes('minimax')) return 'minimax';
    if (lower.includes('grok')) return 'grok';
    if (lower.includes('nemotron')) return 'nvidia';
    if (lower.includes('mimo')) return 'mimo';
    return id.split('-')[0];
  }

  async provideLanguageModelChatInformation(
    options: { silent: boolean; configuration?: { [key: string]: unknown } },
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelChatInformation[]> {
    const now = Date.now();
    if (now - this.lastFetch > MODEL_CACHE_TTL || this.models.length === 0) {
      await this.fetchModels();
    }
    if (!options.silent && this.models.length === 0) {
      if (!this.apiKey) {
        vscode.window.showWarningMessage(
          `OpenCode ${this.displayName}: Please configure your API key.`
        );
      }
    }
    return this.models;
  }

  refreshModels(): void {
    this.invalidateCache();
    this._onDidChangeLanguageModelChatInformation.fire();
  }

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const sessionId = this.providerSessionId;
    const modelName = this.modelInfoMap.get(model.id)?.name ?? model.id;

    this.outputChannel.appendLine(
      `${this.outputChannelName} request: id=${requestId} model=${model.id} session=${sessionId.slice(0,12)}…`
    );
    this._onDidChangeRequestState.fire({ kind: 'start', modelId: model.id, modelName });

    const reasonerSteps: ReasonerStep[] = [];

    try {
      const openaiMessages = this.convertAllMessages(messages);
      const modelMaxContext = model.maxInputTokens || TOKEN_CONSTANTS.DEFAULT_CONTEXT_TOKENS;
      const configuredMaxOutput = model.maxOutputTokens || TOKEN_CONSTANTS.DEFAULT_OUTPUT_TOKENS;
      const toolsSerializedLength = options.tools ? JSON.stringify(options.tools).length : 0;

      const maxInputTokens = calculateMaxInputTokens({
        modelMaxContext,
        configuredMaxOutput,
        toolsSerializedLength,
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
        estimatedInputTokens,
        toolsOverhead,
        modelMaxContext,
        configuredMaxOutput,
      });

      const { tools, schemas } = this.buildToolsConfig(options);
      const hasTools = tools !== undefined && tools.length > 0;
      const temperature = hasTools ? 0 : DEFAULT_TEMPERATURE;

      const request: ChatCompletionRequest = {
        model: model.id,
        messages: truncatedMessages,
        max_tokens: safeMaxOutputTokens,
        temperature,
        ...(hasTools && { tools, tool_choice: this.mapToolChoice(options.toolMode) }),
      };

      let capturedUsage: TokenUsage | undefined;
      const abortSignal = new AbortController();
      token.onCancellationRequested(() => abortSignal.abort());
      const stream = this.client.streamChatCompletion(request, this.apiKey, this.endpoint, abortSignal.signal);

      const reporter = this.createStreamReporter(requestId, sessionId, progress, reasonerSteps, (usage) => {
        capturedUsage = usage;
      });

      const stats = await streamResponse({
        chunks: stream,
        reporter,
        isCancelled: () => token.isCancellationRequested,
        resolveToolCallArgs: (tc) => resolveToolCallArgs(tc, schemas),
      });

      const meta: RequestMeta = {
        requestId,
        sessionId,
        modelId: model.id,
        modelName,
        startedAt: Date.now() - stats.totalContentLength,
        completedAt: Date.now(),
        reasonerSteps,
      };

      this.recordCompletedRequest(requestId, sessionId, model.id, modelName, capturedUsage, meta);
      this._onDidChangeRequestState.fire({
        kind: 'complete',
        modelId: model.id,
        modelName,
        usage: capturedUsage,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.outputChannel.appendLine(`ERROR: ${errorMessage}`);
      this._onDidChangeRequestState.fire({
        kind: 'error',
        modelId: model.id,
        modelName,
        errorMessage,
      });
      throw err;
    }
  }

  async provideTokenCount(
    _model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatMessage,
    _token: vscode.CancellationToken
  ): Promise<number> {
    if (typeof text === 'string') {
      return estimateTextTokens(text);
    }
    let tokens = 0;
    for (const part of text.content) {
      if (part instanceof vscode.LanguageModelTextPart) {
        tokens += estimateTextTokens(part.value);
      } else if (part instanceof vscode.LanguageModelToolCallPart) {
        tokens += estimateTextTokens(part.name + JSON.stringify(part.input ?? {}));
      } else if (part instanceof vscode.LanguageModelToolResultPart) {
        const body = typeof part.content === 'string' ? part.content : JSON.stringify(part.content);
        tokens += estimateTextTokens(body);
      } else if (part instanceof vscode.LanguageModelDataPart) {
        tokens += TOKEN_CONSTANTS.IMAGE_OVERHEAD_TOKENS;
      }
    }
    return tokens;
  }

  async provideLanguageModelChatConfiguration(): Promise<{ [key: string]: unknown }> {
    return { apiKey: this.apiKey };
  }

  showOutput(): void {
    this.outputChannel.show();
  }

  appendOutput(text: string): void {
    this.outputChannel.appendLine(text);
  }

  getStatusSnapshot(): StatusSnapshot {
    const models = Array.from(this.modelInfoMap.values()).map(info => ({
      id: info.id,
      name: info.name,
      contextLabel: info.contextLabel,
      totalContext: info.maxInputTokens,
      capabilityLabels: info.capabilityLabels,
    }));

    let connection: { state: ConnectionState; errorMessage?: string };
    if (!this.apiKey) {
      connection = { state: 'unknown' };
    } else if (this.models.length > 0) {
      connection = { state: 'ok' };
    } else {
      connection = { state: 'noModels' };
    }

    return {
      host: this.endpoint,
      connection,
      lastSuccessfulFetchAt: this.lastFetch || undefined,
      models,
      sessionStats: this.sessionStats,
      lastRequest: this.lastRequest,
      features: {
        toolCalling: true,
        imageInput: false,
        parallelToolCalling: false,
        agentTemperature: 0,
      },
      now: Date.now(),
    };
  }

  getUsageTracker(): UsageTracker {
    return this.usageTracker;
  }

  async fetchApiUsage(): Promise<ApiUsageResponse | undefined> {
    if (!this.apiKey) return undefined;
    const now = Date.now();
    if (now - this.lastUsageFetch < USAGE_CACHE_TTL && this.lastUsage) {
      return this.lastUsage;
    }
    const usage = await this.client.getUsage(this.apiKey, this.endpoint);
    if (usage) {
      this.lastUsage = usage;
      this.lastUsageFetch = now;
    }
    return usage;
  }

  getApiUsage(): ApiUsageResponse | undefined {
    return this.lastUsage;
  }

  private convertAllMessages(messages: readonly vscode.LanguageModelChatMessage[]): ChatMessage[] {
    const result: ChatMessage[] = [];
    for (const msg of messages) {
      const role = msg.role === vscode.LanguageModelChatMessageRole.Assistant ? 'assistant' : 'user';
      const normalized = {
        role: role as NormalizedRole,
        parts: msg.content.map(part => this.classifyPart(part)),
      };
      result.push(...convertMessage(normalized, true));
    }
    return result;
  }

  private classifyPart(part: unknown): NormalizedPart {
    if (part instanceof vscode.LanguageModelTextPart) {
      return { kind: 'text', value: part.value };
    }
    if (part instanceof vscode.LanguageModelToolResultPart) {
      return {
        kind: 'toolResult',
        callId: part.callId,
        content: typeof part.content === 'string' ? part.content : JSON.stringify(part.content),
      };
    }
    if (part instanceof vscode.LanguageModelToolCallPart) {
      return {
        kind: 'toolCall',
        callId: part.callId,
        name: part.name,
        input: part.input,
      };
    }
    const maybeValue = (part as { value?: unknown })?.value;
    if (typeof maybeValue === 'string' && maybeValue.length > 0) {
      return { kind: 'text', value: maybeValue };
    }
    return { kind: 'unknown' };
  }

  private buildToolsConfig(
    options: vscode.ProvideLanguageModelChatResponseOptions
  ): { tools: ToolDefinition[] | undefined; schemas: Map<string, Record<string, unknown> | undefined> } {
    const schemas = new Map<string, Record<string, unknown> | undefined>();
    if (!options.tools || options.tools.length === 0) {
      return { tools: undefined, schemas };
    }
    const tools: ToolDefinition[] = options.tools.map(tool => {
      const schema = tool.inputSchema as Record<string, unknown> | undefined;
      schemas.set(tool.name, schema);
      return {
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: schema,
        },
      };
    });
    return { tools, schemas };
  }

  private mapToolChoice(mode: vscode.LanguageModelChatToolMode | undefined): 'auto' | 'required' | 'none' | undefined {
    if (mode === vscode.LanguageModelChatToolMode.Required) return 'required';
    if (mode === vscode.LanguageModelChatToolMode.Auto) return 'auto';
    return undefined;
  }

  private createStreamReporter(
    requestId: string,
    sessionId: string,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    reasonerSteps: ReasonerStep[],
    onUsage?: (usage: TokenUsage) => void
  ): StreamReporter {
    return {
      requestId,
      sessionId,
      reportText: (text) => progress.report(new vscode.LanguageModelTextPart(text)),
      reportThinking: (text) => progress.report(new vscode.LanguageModelTextPart(text)),
      reportThinkingDone: () => { /* no-op */ },
      reportToolCall: (id, name, args) =>
        progress.report(new vscode.LanguageModelToolCallPart(id, name, args)),
      reportUsage: (usage) => {
        onUsage?.({
          prompt: usage.prompt_tokens,
          completion: usage.completion_tokens,
          total: usage.total_tokens,
        });
        const payload = new TextEncoder().encode(JSON.stringify(usage));
        progress.report(new vscode.LanguageModelDataPart(payload, 'usage'));
      },
      reportReasonerStep: (stepId, label, tokens) => {
        reasonerSteps.push({ stepId, label, startedAt: Date.now(), tokens });
      },
    };
  }

  private recordCompletedRequest(
    requestId: string,
    sessionId: string,
    modelId: string,
    modelName: string,
    usage?: TokenUsage,
    meta?: RequestMeta
  ): void {
    this.sessionStats = {
      requestCount: this.sessionStats.requestCount + 1,
      totalTokens: {
        prompt: this.sessionStats.totalTokens.prompt + (usage?.prompt ?? 0),
        completion: this.sessionStats.totalTokens.completion + (usage?.completion ?? 0),
        total: this.sessionStats.totalTokens.total + (usage?.total ?? 0),
      },
    };
    this.lastRequest = { modelId, modelName, completedAt: Date.now(), usage };

    this.usageTracker.recordRequest(
      requestId,
      sessionId,
      modelId,
      modelName,
      this.providerType,
      usage ?? { prompt: 0, completion: 0, total: 0 },
      undefined,
      meta
    );
  }
}
