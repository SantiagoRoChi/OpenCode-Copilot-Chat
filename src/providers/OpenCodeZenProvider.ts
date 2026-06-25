import { window, ExtensionContext, CancellationToken, LanguageModelChatInformation, LanguageModelChatRequestMessage, LanguageModelChatTool, LanguageModelResponsePart, Progress, ProvideLanguageModelChatResponseOptions } from 'vscode';
import { BaseProvider, RoutedModelInfo } from './BaseProvider';
import { ZEN_BASE_URL } from '../client/endpoints';
import { SecretStorage } from '../config/secretStorage';
import { getModelCapabilities, getModelEndpoint } from '../client/modelRegistry';
import { ApiModel } from '../client/types';
import { streamAnthropicChat, TokenUsage as AnthropicTokenUsage } from './sdk/anthropicChat';
import { streamOpenAIChat, TokenUsage as OpenAITokenUsage } from './sdk/openaiChat';

export class OpenCodeZenProvider extends BaseProvider {
  protected apiKey = '';
  private readonly storage: SecretStorage;
  protected readonly out = window.createOutputChannel('OpenCode Zen');
  private onUsageCallback?: (usage: { prompt: number; completion: number; total: number }) => void;

  get vendor(): string { return 'opencode-zen'; }

  constructor(context: ExtensionContext) {
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

  override async provideLanguageModelChatInformation(
    options: { silent: boolean; configuration?: Record<string, unknown> },
    token: CancellationToken
  ): Promise<LanguageModelChatInformation[]> {
    const configKey = options.configuration?.apiKey as string | undefined;
    if (configKey && configKey !== this.apiKey) {
      await this.setApiKey(configKey);
    }
    return super.provideLanguageModelChatInformation(options, token);
  }

  override async provideLanguageModelChatResponse(
    model: LanguageModelChatInformation,
    messages: readonly LanguageModelChatRequestMessage[],
    options: ProvideLanguageModelChatResponseOptions,
    progress: Progress<LanguageModelResponsePart>,
    token: CancellationToken
  ): Promise<void> {
    const rm = model as RoutedModelInfo; // safe: RoutedModelInfo extends LanguageModelChatInformation with routing data embedded
    const apiKey = this.apiKey;
    if (!apiKey) {
      throw new Error('Zen API key not configured. Use "OpenCode Zen: Configure Zen Key".');
    }

    const tools = (options as unknown as { tools?: LanguageModelChatTool[] }).tools;
    
    const modelOpts = this.extractModelOptions(options);

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
    return models.filter(m => {
      if (m.id.startsWith('gemini-')) return false;
      
      const caps = getModelCapabilities(m.id);
      const inputPrice = caps.pricePerMillionInput;
      const outputPrice = caps.pricePerMillionOutput;
      const isFree = (inputPrice === undefined || inputPrice === 0) &&
                     (outputPrice === undefined || outputPrice === 0);
      
      return !isFree;
    });
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
      return this.buildUtilityAliases(models.map(m => this.toModelInfo(m.id)));
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
    info.configurationSchema = this.buildConfigurationSchema(
      caps.supportedReasoningLevels,
      undefined,
      caps.family,
      caps.maxInputTokens
    );

    return info;
  }

  private buildUtilityAliases(models: RoutedModelInfo[]): RoutedModelInfo[] {
    if (models.length === 0) return models;
    const sortedByPrice = [...models].filter(m => m._pricing?.inputTokenPrice != null)
      .sort((a, b) => a._pricing!.inputTokenPrice! - b._pricing!.inputTokenPrice!);
    const sortedBySpeed = [...models].sort(
      (a, b) => (a.maxInputTokens ?? Infinity) - (b.maxInputTokens ?? Infinity)
    );

    const result = [...models];

    if (sortedByPrice.length > 0) {
      const cheapest = sortedByPrice[0];
      result.push(this.buildAliasModel('opencode-cheap-zen', `Cheap (Zen)`, cheapest, 'Cheapest available model on Zen'));
    }

    if (sortedBySpeed.length > 0) {
      const fastest = sortedBySpeed[0];
      result.push(this.buildAliasModel('opencode-fast-zen', `Fast (Zen)`, fastest, 'Fastest responding model on Zen'));
    }

    return result;
  }

  private buildAliasModel(id: string, name: string, target: RoutedModelInfo, _description: string): RoutedModelInfo {
    return {
      ...target,
      id,
      name,
    };
  }

  override dispose(): void {
    this.out.dispose();
    super.dispose();
  }
}
