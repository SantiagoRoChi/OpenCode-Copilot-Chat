import { window, ExtensionContext, CancellationToken, LanguageModelChatInformation, LanguageModelChatRequestMessage, LanguageModelChatTool, LanguageModelResponsePart, Progress, ProvideLanguageModelChatResponseOptions } from 'vscode';
import { BaseProvider, RoutedModelInfo } from './BaseProvider';
import { GO_BASE_URL } from '../client/endpoints';
import { SecretStorage } from '../config/secretStorage';
import { getModelCapabilities, getModelEndpoint } from '../client/modelRegistry';
import { streamAnthropicChat, TokenUsage as AnthropicTokenUsage } from './sdk/anthropicChat';
import { streamOpenAIChat, TokenUsage as OpenAITokenUsage } from './sdk/openaiChat';

interface ApiModel {
  id: string;
  name?: string;
  maxTokens?: number;
  contextWindow?: number;
  capabilities?: {
    toolCalling?: boolean;
    imageInput?: boolean;
    reasoning?: boolean;
  };
}

export class OpenCodeGoProvider extends BaseProvider {
  private apiKey = '';
  private readonly storage: SecretStorage;
  private readonly out = window.createOutputChannel('OpenCode Go');
  private onUsageCallback?: (usage: { prompt: number; completion: number; total: number }) => void;

  get vendor(): string { return 'opencode-go'; }

  constructor(context: ExtensionContext) {
    super();
    this.storage = new SecretStorage(context);
  }

  setOnUsageCallback(callback: (usage: { prompt: number; completion: number; total: number }) => void): void {
    this.onUsageCallback = callback;
  }

  async loadApiKey(): Promise<void> {
    this.apiKey = await this.storage.getGoKey();
    if (this.apiKey) this.invalidateCache();
  }

  async setApiKey(key: string): Promise<void> {
    this.apiKey = key;
    await this.storage.setGoKey(key);
    this.refreshModels();
  }

  getApiKey(): string { return this.apiKey; }

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
      throw new Error('Go API key not configured. Use "OpenCode Zen: Configure Go Key".');
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
        apiKey, `${GO_BASE_URL}`, rm._apiId,
        rm.maxOutputTokens, messages, tools, modelOpts, progress, token,
        handleUsage,
      );
    } else {
      await streamOpenAIChat(
        apiKey, `${GO_BASE_URL}`, rm._apiId,
        rm.maxOutputTokens, messages, tools, modelOpts, progress, token,
        handleUsage,
      );
    }
    this.out.appendLine(`[Go] ✅ ${rm._apiId} responded`);
  }

  override async provideLanguageModelChatInformation(
    options: { silent: boolean; configuration?: Record<string, unknown> },
    token: CancellationToken
  ): Promise<LanguageModelChatInformation[]> {
    const configKey = options.configuration?.apiKey as string | undefined;
    if (configKey && configKey !== this.apiKey) await this.setApiKey(configKey);
    return super.provideLanguageModelChatInformation(options, token);
  }

  protected getEndpoint(_modelId: string): never { throw new Error('not used'); }

  protected async getModels(): Promise<RoutedModelInfo[]> {
    try {
      const res = await fetch(`${GO_BASE_URL}/models`, {
        headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return [];
      const data = await res.json() as { data: ApiModel[] };
      this.out.appendLine(`[Go] ${data.data?.length ?? 0} models`);
      return this.buildUtilityAliases((data.data ?? []).map(m => this.toModelInfo(m.id)));
    } catch (err) {
      this.out.appendLine(`[Go] error: ${err}`);
      return [];
    }
  }

  private toModelInfo(id: string): RoutedModelInfo {
    const caps = getModelCapabilities(id);
    const ep = getModelEndpoint('go', id);
    const info: RoutedModelInfo = {
      id,
      name: caps.name !== id ? caps.name : id,
      family: caps.family,
      version: '1',
      maxInputTokens: caps.maxInputTokens,
      maxOutputTokens: caps.maxOutputTokens,
      capabilities: { toolCalling: caps.toolCalling, imageInput: caps.imageInput },
      _url: `${GO_BASE_URL}${ep.chatEndpoint}`,
      _headers: { Authorization: `Bearer ${this.apiKey}` },
      _apiId: id,
      _apiFormat: ep.apiFormat,
      _pricing: caps.pricePerMillionInput !== undefined || caps.pricePerMillionOutput !== undefined ? {
        inputTokenPrice: caps.pricePerMillionInput ? caps.pricePerMillionInput / 1_000_000 : undefined,
        outputTokenPrice: caps.pricePerMillionOutput ? caps.pricePerMillionOutput / 1_000_000 : undefined,
        currency: 'USD',
      } : undefined,
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
      result.push(this.buildAliasModel('opencode-cheap-go', 'Cheap (Go)', cheapest));
    }
    if (sortedBySpeed.length > 0) {
      const fastest = sortedBySpeed[0];
      result.push(this.buildAliasModel('opencode-fast-go', 'Fast (Go)', fastest));
    }
    return result;
  }

  private buildAliasModel(id: string, name: string, target: RoutedModelInfo): RoutedModelInfo {
    return { ...target, id, name };
  }

  override dispose(): void {
    this.out.dispose();
    super.dispose();
  }
}
