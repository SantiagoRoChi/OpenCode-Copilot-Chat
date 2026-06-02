import * as vscode from 'vscode';
import { ZenClient } from './client/zenClient';
import { ChatCompletionRequest, ChatMessage, TokenUsage, StatusSnapshot, ModelSummary, SessionStats, LastRequest, ZenConfig } from './client/types';
import { ModelRegistry } from './models/registry';
import { buildModelInfo } from './models/modelInfoBuilder';
import { ZenModelDefinition } from './client/types';
import { OpenCodeConnector } from './integration/opencodeConnector';
import { SecretStorage } from './config/secretStorage';
import { convertTools, resolveToolCallArgs } from './tools/toolCallAdapter';
import { streamResponse, StreamReporter, StreamResult } from './streaming/responseStreamer';
import { convertMessage, normalizeVsCodeMessages, NormalizedRole, NormalizedPart } from './streaming/messageConverter';
import {
  TOKEN_CONSTANTS,
  estimateTextTokens,
  calculateMaxInputTokens,
  calculateSafeMaxOutputTokens,
  truncateMessagesToFit,
  buildInputText,
} from './utils/tokenEstimate';
import { loadConfig } from './config/settings';

const DEFAULT_TEMPERATURE = 0.7;

export type RequestStateEvent =
  | { readonly kind: 'start'; readonly modelId: string; readonly modelName: string }
  | { readonly kind: 'complete'; readonly modelId: string; readonly modelName: string; readonly usage?: TokenUsage }
  | { readonly kind: 'error'; readonly modelId: string; readonly modelName: string; readonly errorMessage: string };

export class ZenProvider implements vscode.LanguageModelChatProvider {
  private readonly client: ZenClient;
  private readonly registry: ModelRegistry;
  private readonly connector: OpenCodeConnector;
  private readonly secretStorage: SecretStorage;
  private readonly outputChannel: vscode.OutputChannel;
  private readonly providerType: 'zen' | 'go';
  private config: ZenConfig;
  private apiKey: string = '';

  private readonly _onDidChangeLanguageModelChatInformation = new vscode.EventEmitter<void>();
  readonly onDidChangeLanguageModelChatInformation = this._onDidChangeLanguageModelChatInformation.event;

  private readonly _onDidChangeRequestState = new vscode.EventEmitter<RequestStateEvent>();
  readonly onDidChangeRequestState = this._onDidChangeRequestState.event;

  private readonly _onDidChangeStatusSnapshot = new vscode.EventEmitter<void>();
  readonly onDidChangeStatusSnapshot = this._onDidChangeStatusSnapshot.event;

  private sessionStats: SessionStats = { requestCount: 0, totalTokens: { prompt: 0, completion: 0, total: 0 } };
  private lastRequest?: LastRequest;
  private lastSuccessfulFetchAt?: number;
  private lastConnectionError?: string;

  private modelFetchInFlight?: Promise<vscode.LanguageModelChatInformation[]>;
  private modelFetchCache?: { at: number; result: vscode.LanguageModelChatInformation[] };
  private configChangeDebounce?: ReturnType<typeof setTimeout>;

  constructor(context: vscode.ExtensionContext, providerType: 'zen' | 'go' = 'zen') {
    this.providerType = providerType;
    this.outputChannel = vscode.window.createOutputChannel(`OpenCode ${providerType === 'go' ? 'Go' : 'Zen'}`);
    this.secretStorage = new SecretStorage(context);
    this.client = new ZenClient();
    this.registry = new ModelRegistry(this.outputChannel);
    this.connector = new OpenCodeConnector(this.outputChannel);
    this.config = loadConfig();

    context.subscriptions.push(
      this.outputChannel,
      this._onDidChangeLanguageModelChatInformation,
      this._onDidChangeRequestState,
      this._onDidChangeStatusSnapshot,
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (!e.affectsConfiguration('opencode-zen')) return;
        this.config = loadConfig();
        this.outputChannel.appendLine('Configuration changed, reloading...');
        if (this.configChangeDebounce) clearTimeout(this.configChangeDebounce);
        this.configChangeDebounce = setTimeout(() => {
          this.configChangeDebounce = undefined;
          this._onDidChangeLanguageModelChatInformation.fire();
        }, 500);
      })
    );
  }

  async loadSecrets(): Promise<void> {
    this.apiKey = await this.secretStorage.getApiKey();

    if (!this.apiKey && this.config.autoDetectOpenCode) {
      this.outputChannel.appendLine('No API key in SecretStorage, trying OpenCode auto-detection...');
      const detectedKey = await this.connector.getZenApiKey();
      if (detectedKey) {
        this.apiKey = detectedKey;
        await this.secretStorage.setApiKey(detectedKey);
        this.outputChannel.appendLine('Auto-detected Zen API key from OpenCode installation');
        vscode.window.showInformationMessage('OpenCode Zen: API key auto-detected from OpenCode installation.');
      }
    }

    if (this.apiKey) {
      await this.registry.refresh(this.apiKey);
    }
  }

  async setApiKey(apiKey: string): Promise<void> {
    this.apiKey = apiKey;
    await this.secretStorage.setApiKey(apiKey);
    this.invalidateModelCache();
    this.refreshModels();
  }

  refreshModels(): void {
    this._onDidChangeLanguageModelChatInformation.fire();
  }

  invalidateModelCache(): void {
    this.modelFetchCache = undefined;
  }

  async provideLanguageModelChatInformation(
    options: { silent: boolean; configuration?: { readonly [key: string]: unknown } },
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelChatInformation[]> {
    const frameworkApiKey = options.configuration?.apiKey;
    if (typeof frameworkApiKey === 'string' && frameworkApiKey !== this.apiKey) {
      this.apiKey = frameworkApiKey;
      await this.secretStorage.setApiKey(frameworkApiKey);
      this.invalidateModelCache();
    }

    const outcome = await this.getOrFetchModels(token);
    if (!options.silent && outcome.error) {
      this.promptOpenSettings(`OpenCode Zen: ${outcome.error}`);
    }
    return outcome.models;
  }

  private async getOrFetchModels(
    token: vscode.CancellationToken
  ): Promise<{ models: vscode.LanguageModelChatInformation[]; error?: string }> {
    const now = Date.now();
    if (this.modelFetchCache && this.modelFetchCache.result.length > 0 && now - this.modelFetchCache.at < 300_000) {
      return { models: this.modelFetchCache.result };
    }
    if (this.modelFetchInFlight) {
      try {
        return { models: await this.modelFetchInFlight };
      } catch (err) {
        return { models: [], error: err instanceof Error ? err.message : String(err) };
      }
    }

    const inFlight = this.doFetchModels(token);
    this.modelFetchInFlight = inFlight;
    try {
      const result = await inFlight;
      if (!token.isCancellationRequested) {
        this.modelFetchCache = { at: Date.now(), result };
        this.lastSuccessfulFetchAt = Date.now();
        this.lastConnectionError = undefined;
        this._onDidChangeStatusSnapshot.fire();
      }
      return { models: result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.lastConnectionError = message;
      this._onDidChangeStatusSnapshot.fire();
      return { models: [], error: message };
    } finally {
      if (this.modelFetchInFlight === inFlight) {
        this.modelFetchInFlight = undefined;
      }
    }
  }

  private async doFetchModels(
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelChatInformation[]> {
    this.outputChannel.appendLine('Fetching model catalog...');

    this.registry.refresh(this.apiKey || undefined);

    // Filter models based on provider type
    const allModels = this.registry.getModels();
    const filteredModels = allModels.filter(m => {
      if (this.providerType === 'go') {
        // Go provider: only show Go models
        return m.provider === 'opencode-go' || m.tags.includes('go');
      } else {
        // Zen provider: only show Zen models (not Go)
        return m.provider !== 'opencode-go' && !m.tags.includes('go');
      }
    });

    const models = filteredModels.map(def => buildModelInfo(def));

    this.outputChannel.appendLine(
      `Found ${models.length} models (${this.providerType}): ${models.map(m => m.id).join(', ')}`
    );

    return models;
  }

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    this.outputChannel.appendLine(`Chat request: model=${model.id}, tools=${options.tools?.length ?? 0}`);

    const def = this.registry.getModel(model.id);
    const modelName = def?.displayName ?? model.id;
    this._onDidChangeRequestState.fire({ kind: 'start', modelId: model.id, modelName });

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
      const temperature = hasTools ? this.config.agentTemperature : DEFAULT_TEMPERATURE;

      const request: ChatCompletionRequest = {
        model: model.id,
        messages: truncatedMessages,
        max_tokens: safeMaxOutputTokens,
        temperature,
        ...(hasTools && { tools, tool_choice: this.mapToolChoice(options.toolMode) }),
        ...(hasTools && { parallel_tool_calls: this.config.parallelToolCalling }),
      };

      this.logRequest(request);

      let capturedUsage: TokenUsage | undefined;
      const abortSignal = new AbortController();
      token.onCancellationRequested(() => abortSignal.abort());
      
      // Determine base URL based on model provider
      const modelDef = this.registry.getModel(model.id);
      const baseUrl = modelDef?.provider === 'opencode-go' 
        ? 'https://opencode.ai/zen/go/v1' 
        : undefined;
      
      const stream = this.client.streamChatCompletion(request, this.apiKey, abortSignal.signal, baseUrl);

      const reporter = this.createStreamReporter(progress, (usage) => {
        capturedUsage = usage;
      });

      const stats = await streamResponse({
        chunks: stream as unknown as ReadableStream<import('./client/types').ChatCompletionChunk>,
        reporter,
        isCancelled: () => token.isCancellationRequested,
        resolveToolCallArgs: (tc) => resolveToolCallArgs(tc, schemas),
      });

      this.outputChannel.appendLine(
        `Completed: ${stats.totalContentLength} chars, ${stats.totalTextParts} text, ${stats.totalToolCalls} tools`
      );

      this.recordCompletedRequest(model.id, modelName, capturedUsage);
      this._onDidChangeRequestState.fire({
        kind: 'complete',
        modelId: model.id,
        modelName,
        usage: capturedUsage,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this._onDidChangeRequestState.fire({
        kind: 'error',
        modelId: model.id,
        modelName,
        errorMessage,
      });
      this.outputChannel.appendLine(`ERROR: ${errorMessage}`);
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

  async provideLanguageModelChatConfiguration(
    configuration?: { readonly [key: string]: unknown }
  ): Promise<{ [key: string]: unknown }> {
    if (configuration?.apiKey && typeof configuration.apiKey === 'string' && configuration.apiKey !== this.apiKey) {
      this.apiKey = configuration.apiKey;
      await this.secretStorage.setApiKey(configuration.apiKey);
      this.invalidateModelCache();
      this.registry.refresh(this.apiKey);
    }
    return { apiKey: this.apiKey };
  }

  getStatusSnapshot(): StatusSnapshot {
    const cachedModels = this.modelFetchCache?.result ?? [];
    const models: ModelSummary[] = cachedModels.map(m => {
      const def = this.registry.getModel(m.id);
      return {
        id: m.id,
        name: m.name,
        contextLabel: `${Math.round((m.maxInputTokens || 0) / 1000)}K ctx`,
        totalContext: m.maxInputTokens,
        capabilityLabels: this.getCapabilityLabels(def),
      };
    });

    let connection: { state: import('./client/types').ConnectionState; errorMessage?: string };
    if (this.lastConnectionError) {
      connection = { state: 'error', errorMessage: this.lastConnectionError };
    } else if (this.lastSuccessfulFetchAt === undefined) {
      connection = { state: 'unknown' };
    } else if (cachedModels.length === 0) {
      connection = { state: 'noModels' };
    } else {
      connection = { state: 'ok' };
    }

    return {
      host: 'opencode.ai/zen',
      connection,
      ...(this.lastSuccessfulFetchAt !== undefined ? { lastSuccessfulFetchAt: this.lastSuccessfulFetchAt } : {}),
      models,
      sessionStats: this.sessionStats,
      ...(this.lastRequest ? { lastRequest: this.lastRequest } : {}),
      features: {
        toolCalling: this.config.enableToolCalling,
        imageInput: this.config.enableImageInput,
        parallelToolCalling: this.config.parallelToolCalling,
        agentTemperature: this.config.agentTemperature,
      },
      now: Date.now(),
    };
  }

  showOutput(): void {
    this.outputChannel.show();
  }

  appendOutput(text: string): void {
    this.outputChannel.appendLine(text);
  }

  private convertAllMessages(messages: readonly vscode.LanguageModelChatMessage[]): ChatMessage[] {
    const result: ChatMessage[] = [];
    for (const msg of messages) {
      const normalized = {
        role: this.mapRole(msg.role),
        parts: msg.content.map(part => this.classifyPart(part)),
      };
      result.push(...convertMessage(normalized, this.config.enableImageInput));
    }
    return result;
  }

  private mapRole(role: vscode.LanguageModelChatMessageRole): NormalizedRole {
    if (role === vscode.LanguageModelChatMessageRole.Assistant) return 'assistant';
    return 'user';
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
    if (part instanceof vscode.LanguageModelDataPart) {
      return { kind: 'image', mimeType: part.mimeType, data: part.data };
    }
    // Unknown part types (e.g. LanguageModelPromptTsxPart) — extract any text content
    // so the message isn't silently dropped
    const maybeValue = (part as { value?: unknown })?.value;
    if (typeof maybeValue === 'string' && maybeValue.length > 0) {
      return { kind: 'text', value: maybeValue };
    }
    const maybeValue2 = (part as { _value?: unknown })?._value;
    if (typeof maybeValue2 === 'string' && maybeValue2.length > 0) {
      return { kind: 'text', value: maybeValue2 };
    }
    return { kind: 'unknown' };
  }

  private mapToolChoice(toolMode: vscode.LanguageModelChatToolMode | undefined): 'auto' | 'required' | 'none' | undefined {
    if (toolMode === vscode.LanguageModelChatToolMode.Required) return 'required';
    if (toolMode === vscode.LanguageModelChatToolMode.Auto) return 'auto';
    return undefined;
  }

  private buildToolsConfig(
    options: vscode.ProvideLanguageModelChatResponseOptions
  ): { tools: import('./client/types').ToolDefinition[] | undefined; schemas: Map<string, Record<string, unknown> | undefined> } {
    const schemas = new Map<string, Record<string, unknown> | undefined>();
    if (!this.config.enableToolCalling || !options.tools || options.tools.length === 0) {
      return { tools: undefined, schemas };
    }

    const tools = options.tools.map(tool => {
      const schema = tool.inputSchema as Record<string, unknown> | undefined;
      schemas.set(tool.name, schema);
      return {
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      };
    });

    return { tools, schemas };
  }

  private createStreamReporter(
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    onUsage?: (usage: TokenUsage) => void
  ): StreamReporter {
    return {
      reportText: (text) => progress.report(new vscode.LanguageModelTextPart(text)),
      reportThinking: (text) => {
        // LanguageModelThinkingPart may not be available in all VS Code versions
        // Use LanguageModelTextPart as fallback with thinking prefix
        try {
          const Ctor = (vscode as Record<string, unknown>)['LanguageModelThinkingPart'] as
            | (new (text: string, options?: unknown) => vscode.LanguageModelResponsePart)
            | undefined;
          if (Ctor) {
            progress.report(new Ctor(text));
          } else {
            progress.report(new vscode.LanguageModelTextPart(`<think>${text}</think>`));
          }
        } catch {
          progress.report(new vscode.LanguageModelTextPart(`<think>${text}</think>`));
        }
      },
      reportThinkingDone: () => {
        try {
          const Ctor = (vscode as Record<string, unknown>)['LanguageModelThinkingPart'] as
            | (new (text: string, options?: unknown) => vscode.LanguageModelResponsePart)
            | undefined;
          if (Ctor) {
            progress.report(new Ctor('', { vscode_reasoning_done: true }));
          }
        } catch {
          // no-op
        }
      },
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
    };
  }

  private recordCompletedRequest(modelId: string, modelName: string, usage?: TokenUsage): void {
    this.sessionStats = {
      requestCount: this.sessionStats.requestCount + 1,
      totalTokens: {
        prompt: this.sessionStats.totalTokens.prompt + (usage?.prompt ?? 0),
        completion: this.sessionStats.totalTokens.completion + (usage?.completion ?? 0),
        total: this.sessionStats.totalTokens.total + (usage?.total ?? 0),
      },
    };
    this.lastRequest = { modelId, modelName, completedAt: Date.now(), usage };
    this._onDidChangeStatusSnapshot.fire();
  }

  private getCapabilityLabels(def: ZenModelDefinition | undefined): string[] {
    if (!def) return [];
    const labels: string[] = [];
    if (def.capabilities.reasoning) labels.push('reasoning');
    if (def.capabilities.toolCalling) labels.push('tools');
    if (def.capabilities.imageInput) labels.push('vision');
    if (def.pricing.input === 0) labels.push('free');
    return labels;
  }

  private logRequest(request: ChatCompletionRequest): void {
    if (!this.config.verboseLogging) {
      this.outputChannel.appendLine(
        `Request: model=${request.model}, messages=${request.messages.length}, tools=${request.tools?.length ?? 0}, max_tokens=${request.max_tokens}`
      );
      return;
    }
    const json = JSON.stringify(request, null, 2);
    this.outputChannel.appendLine(
      json.length > 2000 ? `Request (truncated): ${json.substring(0, 2000)}...` : `Request: ${json}`
    );
  }

  private promptOpenSettings(message: string): void {
    vscode.window.showErrorMessage(message, 'Open Settings').then(selection => {
      if (selection === 'Open Settings') {
        vscode.commands.executeCommand('workbench.action.openSettings', 'opencode-zen');
      }
    });
  }
}
