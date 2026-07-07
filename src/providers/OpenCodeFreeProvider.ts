import { window, ExtensionContext, CancellationToken, LanguageModelChatInformation, LanguageModelChatRequestMessage, LanguageModelChatTool, LanguageModelResponsePart, Progress, ProvideLanguageModelChatResponseOptions } from 'vscode';
import { BaseProvider, RoutedModelInfo } from './BaseProvider';
import { ApiModel } from '../client/types';
import { ZEN_BASE_URL } from '../client/endpoints';
import { SecretStorage } from '../config/secretStorage';
import { getModelCapabilities, getModelEndpoint } from '../client/modelRegistry';
import { streamOpenAIChat, TokenUsage as OpenAITokenUsage } from './sdk/openaiChat';
import { streamAnthropicChat, TokenUsage as AnthropicTokenUsage } from './sdk/anthropicChat';

export class OpenCodeFreeProvider extends BaseProvider {
  private readonly storage: SecretStorage;
  private readonly out = window.createOutputChannel('OpenCode Free');
  private onUsageCallback?: (usage: { prompt: number; completion: number; total: number }) => void;

  get vendor(): string { return 'opencode-free'; }

  constructor(context: ExtensionContext) {
    super();
    this.storage = new SecretStorage(context);
  }

  setOnUsageCallback(callback: (usage: { prompt: number; completion: number; total: number }) => void): void {
    this.onUsageCallback = callback;
  }

  override async provideLanguageModelChatResponse(
    model: LanguageModelChatInformation,
    messages: readonly LanguageModelChatRequestMessage[],
    options: ProvideLanguageModelChatResponseOptions,
    progress: Progress<LanguageModelResponsePart>,
    token: CancellationToken
  ): Promise<void> {
    const rm = model as RoutedModelInfo; // safe: RoutedModelInfo extends LanguageModelChatInformation with routing data embedded

    const tools = (options as unknown as { tools?: LanguageModelChatTool[] }).tools;
    
    const modelOpts = this.extractModelOptions(options);

    const handleUsage = (usage: AnthropicTokenUsage | OpenAITokenUsage) => {
      if (this.onUsageCallback) {
        this.onUsageCallback(usage);
      }
    };

    if (rm._apiFormat === 'anthropic') {
      await streamAnthropicChat("",`${ZEN_BASE_URL}`, rm._apiId,
        rm.maxOutputTokens, messages, tools, modelOpts, progress, token,
        handleUsage,
      );
    } else {
      await streamOpenAIChat("",`${ZEN_BASE_URL}`, rm._apiId,
        rm.maxOutputTokens, messages, tools, modelOpts, progress, token,
        handleUsage,
      );
    }
    this.out.appendLine(`[Free] ✅ ${rm._apiId} responded`);
  }

  override async provideLanguageModelChatInformation(
    options: { silent: boolean; configuration?: Record<string, unknown> },
    token: CancellationToken
  ): Promise<LanguageModelChatInformation[]> {
    return super.provideLanguageModelChatInformation(options, token);
  }

  protected getEndpoint(_modelId: string): never { throw new Error('not used'); }

  protected async getModels(): Promise<RoutedModelInfo[]> {
    try {
      const res = await fetch(`${ZEN_BASE_URL}/models`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        this.out.appendLine(`[Free] HTTP ${res.status} - API key may be invalid`);
        return [];
      }
      const data = await res.json() as { data: ApiModel[] };
      
      const allModels = data.data ?? [];
      const models = allModels.filter(m => {
        const caps = getModelCapabilities(m.id);
        const inputPrice = caps.pricePerMillionInput;
        const outputPrice = caps.pricePerMillionOutput;
        const isFree = inputPrice === 0 && outputPrice === 0;
        return isFree;
      });
      
      this.out.appendLine(`[Free] ${models.length}/${allModels.length} models (filtered by zero pricing)`);
      return this.buildUtilityAliases(models.map(m => this.toModelInfo(m.id)));
    } catch (err) {
      this.out.appendLine(`[Free] error: ${err}`);
      return [];
    }
  }

  private toModelInfo(id: string): RoutedModelInfo {
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
      _url: `${ZEN_BASE_URL}${ep.chatEndpoint}`,
      _headers: {},
      _apiId: id,
      _apiFormat: ep.apiFormat === 'google' ? 'openai-compatible' : ep.apiFormat,
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
    const sortedBySpeed = [...models].sort(
      (a, b) => (a.maxInputTokens ?? Infinity) - (b.maxInputTokens ?? Infinity)
    );
    const result = [...models];
    if (sortedBySpeed.length > 0) {
      const fastest = sortedBySpeed[0];
      result.push(this.buildAliasModel('opencode-fast-free', 'Fast (Free)', fastest));
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
