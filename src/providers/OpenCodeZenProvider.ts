import * as vscode from 'vscode';
import { BaseProvider, RoutedModelInfo } from './BaseProvider';
import { ZEN_BASE_URL } from '../client/endpoints';
import { SecretStorage } from '../config/secretStorage';
import { getModelCapabilities, getModelEndpoint } from '../client/modelRegistry';
import { streamAnthropicChat, TokenUsage as AnthropicTokenUsage } from './sdk/anthropicChat';
import { streamOpenAIChat, TokenUsage as OpenAITokenUsage } from './sdk/openaiChat';

interface ApiModel { id: string; }

export class OpenCodeZenProvider extends BaseProvider {
  protected apiKey = '';
  private readonly storage: SecretStorage;
  protected readonly out = vscode.window.createOutputChannel('OpenCode Zen');
  private onUsageCallback?: (usage: { prompt: number; completion: number; total: number }) => void;

  get vendor(): string { return 'opencode-zen'; }

  constructor(context: vscode.ExtensionContext) {
    super();
    this.storage = new SecretStorage(context);
  }

  setOnUsageCallback(callback: (usage: { prompt: number; completion: number; total: number }) => void): void {
    this.onUsageCallback = callback;
  }

  async loadApiKey(): Promise<void> {
    this.apiKey = await this.storage.getZenKey();
    if (this.apiKey) {
      this.invalidateCache();
    }
  }

  async setApiKey(key: string): Promise<void> {
    this.apiKey = key;
    await this.storage.setZenKey(key);
    this.refreshModels();
  }

  getApiKey(): string { return this.apiKey; }

  // Accept apiKey from VS Code's native provider-group configuration
  override async provideLanguageModelChatInformation(
    options: { silent: boolean; configuration?: Record<string, unknown> },
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelChatInformation[]> {
    const configKey = options.configuration?.apiKey as string | undefined;
    if (configKey && configKey !== this.apiKey) {
      await this.setApiKey(configKey);
    }
    return super.provideLanguageModelChatInformation(options, token);
  }

  /**
   * Routes each chat request to the correct AI SDK based on the model's API format.
   * The API key is passed fresh to the SDK on every call — no stale cache.
   */
  override async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    const rm = model as RoutedModelInfo;
    const apiKey = this.apiKey;
    if (!apiKey) {
      throw new Error('Zen API key not configured. Use "OpenCode Zen: Configure Zen Key".');
    }

    const tools = (options as any).tools as vscode.LanguageModelChatTool[] | undefined;
    const modelOpts = options.modelOptions ?? {};

    const handleUsage = (usage: AnthropicTokenUsage | OpenAITokenUsage) => {
      if (this.onUsageCallback) {
        this.onUsageCallback(usage);
      }
    };

    if (rm._apiFormat === 'anthropic') {
      await streamAnthropicChat(
        apiKey, `${ZEN_BASE_URL}`, rm._apiId,
        rm.maxOutputTokens, messages, tools, modelOpts, progress, token,
        handleUsage,
      );
    } else {
      // openai or openai-compatible
      await streamOpenAIChat(
        apiKey, `${ZEN_BASE_URL}`, rm._apiId,
        rm.maxOutputTokens, messages, tools, modelOpts, progress, token,
        handleUsage,
      );
    }
    this.out.appendLine(`[${this.vendor}] ✅ ${rm._apiId} responded`);
  }

  protected getBaseUrl(): string { return ZEN_BASE_URL; }
  protected filterModels(models: ApiModel[]): ApiModel[] {
    return models.filter(m =>
      !m.id.includes('free') &&
      !m.id.includes('pickle') &&
      !m.id.startsWith('gemini-')
    );
  }

  protected async getModels(): Promise<RoutedModelInfo[]> {
    try {
      const res = await fetch(`${this.getBaseUrl()}/models`, {
        headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return [];
      const data = await res.json() as { data: ApiModel[] };
      const models = this.filterModels(data.data ?? []);
      this.out.appendLine(`[${this.vendor}] ${models.length} models`);
      return models.map(m => this.toModelInfo(m.id));
    } catch (err) {
      this.out.appendLine(`[${this.vendor}] error: ${err}`);
      return [];
    }
  }

  protected toModelInfo(id: string): RoutedModelInfo {
    const caps = getModelCapabilities(id);
    const ep = getModelEndpoint('zen', id);
    const info: RoutedModelInfo = {
      id,
      name: caps.name !== id ? caps.name : id,
      family: caps.family,
      version: '1',
      maxInputTokens: caps.maxInputTokens,
      maxOutputTokens: caps.maxOutputTokens,
      capabilities: { toolCalling: caps.toolCalling, imageInput: caps.imageInput },
      _url: `${this.getBaseUrl()}${ep.chatEndpoint}`,
      _headers: { Authorization: `Bearer ${this.apiKey}` },
      _apiId: id,
      _apiFormat: ep.apiFormat === 'google' ? 'openai-compatible' : ep.apiFormat,
    };
    if (caps.reasoning) {
      (info as any).configurationSchema = {
        properties: {
          reasoningEffort: {
            type: 'string',
            enum: ['low', 'medium', 'high'],
            default: caps.thinkingEffort ?? 'medium',
            description: 'Reasoning depth. Higher = more thorough but slower.',
            enumItemLabels: ['Low', 'Medium', 'High'],
          },
        },
      };
    }
    return info;
  }

  override dispose(): void {
    this.out.dispose();
    super.dispose();
  }
}

