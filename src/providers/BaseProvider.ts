import { EventEmitter, CancellationToken, LanguageModelChatInformation, LanguageModelChatMessage, LanguageModelChatProvider, LanguageModelChatRequestMessage, LanguageModelResponsePart, LanguageModelTextPart, Progress, ProvideLanguageModelChatResponseOptions } from 'vscode';
import { ApiFormat, isModelRegistryPopulated, refreshModelRegistry, getModelCapabilities } from '../client/modelRegistry';

export interface RoutedModelInfo extends LanguageModelChatInformation {
  readonly _url: string;
  readonly _headers: Record<string, string>;
  readonly _apiId: string;
  readonly _apiFormat: ApiFormat;
  readonly _pricing?: {
    inputTokenPrice?: number;
    outputTokenPrice?: number;
    reasoningTokenPrice?: number;
    currency?: string;
  };
  configurationSchema?: LanguageModelConfigurationSchema;
}

export interface LanguageModelConfigurationProperty {
  type: string;
  title?: string;
  description?: string;
  default?: string | number;
  enum?: (string | number)[];
  enumItemLabels?: string[];
  enumDescriptions?: string[];
  group?: string;
}

export interface LanguageModelConfigurationSchema {
  type: 'object';
  properties?: Record<string, LanguageModelConfigurationProperty>;
}

export abstract class BaseProvider implements LanguageModelChatProvider {
  protected models: RoutedModelInfo[] = [];
  protected lastFetch = 0;
  protected readonly cacheTtlMs = 5 * 60 * 1000;

  private readonly _onDidChange = new EventEmitter<void>();
  readonly onDidChangeLanguageModelChatInformation = this._onDidChange.event;

  protected fire(): void {
    this._onDidChange.fire();
  }

  dispose(): void {
    this._onDidChange.dispose();
  }

  protected abstract getModels(): Promise<RoutedModelInfo[]>;

  abstract provideLanguageModelChatResponse(
    model: LanguageModelChatInformation,
    messages: readonly LanguageModelChatRequestMessage[],
    options: ProvideLanguageModelChatResponseOptions,
    progress: Progress<LanguageModelResponsePart>,
    token: CancellationToken
  ): Promise<void>;

  async provideLanguageModelChatInformation(
    _options: { silent: boolean; configuration?: Record<string, unknown> },
    _token: CancellationToken
  ): Promise<LanguageModelChatInformation[]> {
    if (!isModelRegistryPopulated()) {
      await refreshModelRegistry();
    }

    if (Date.now() - this.lastFetch > this.cacheTtlMs || this.models.length === 0) {
      this.models = await this.getModels().catch(() => this.models);
      this.lastFetch = Date.now();
    }
    return this.models as LanguageModelChatInformation[];
  }

  invalidateCache(): void {
    this.lastFetch = 0;
  }

  refreshModels(): void {
    this.invalidateCache();
    void this.getModels().then(m => {
      this.models = m;
      this.fire();
    }).catch(() => undefined);
  }

  getCurrentModels(): RoutedModelInfo[] {
    return this.models;
  }

  private static readonly REASONING_DESCRIPTIONS: Record<string, string> = {
    off:    'No reasoning applied',
    on:     'Model decides reasoning automatically',
    low:    'Faster responses with less reasoning',
    medium: 'Balanced reasoning and speed',
    high:   'Greater reasoning depth but slower',
    xhigh:  'Highest reasoning depth but slowest',
    max:    'Absolute maximum capability with no constraints',
  };

  private static familyDefaultReasoning(family: string, levels: string[]): string | undefined {
    const familyLC = family.toLowerCase();
    if (familyLC.includes('claude') || familyLC.includes('sonnet') || familyLC.includes('opus')) {
      return levels.includes('high') ? 'high' : undefined;
    }
    if (familyLC.includes('haiku')) {
      return levels.includes('medium') ? 'medium' : undefined;
    }
    if (familyLC.includes('gpt') || familyLC.includes('openai') || familyLC.includes('codex')) {
      return levels.includes('medium') ? 'medium' : undefined;
    }
    if (familyLC.includes('deepseek')) {
      return levels.includes('high') ? 'high' : undefined;
    }
    if (familyLC.includes('gemini') || familyLC.includes('google')) {
      return levels.includes('medium') ? 'medium' : undefined;
    }
    if (familyLC.includes('qwen') || familyLC.includes('minimax')) {
      return levels.includes('low') ? 'low' : undefined;
    }
    return undefined;
  }

  /** Build context size options based on model's max input tokens */
  private static getContextSizeOptions(maxInputTokens: number): { value: number; description: string; isDefault: boolean }[] | undefined {
    if (maxInputTokens <= 16000) return undefined;
    const defaultMax = Math.min(maxInputTokens, 32000);
    const midMax = Math.min(maxInputTokens, 64000);
    const fullMax = maxInputTokens;

    if (defaultMax >= fullMax) return undefined;

    return [
      { value: defaultMax, description: 'Default recommended context size', isDefault: true },
      ...(midMax > defaultMax ? [{ value: midMax, description: 'Larger context', isDefault: false }] : []),
      { value: fullMax, description: 'Full context window', isDefault: false },
    ];
  }

  private static formatTokenCount(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K';
    return String(n);
  }

  protected buildConfigurationSchema(
    supportedLevels?: string[],
    defaultLevel?: string,
    family?: string,
    maxInputTokens?: number
  ): LanguageModelConfigurationSchema | undefined {
    const properties: NonNullable<LanguageModelConfigurationSchema['properties']> = {};

    if (supportedLevels && supportedLevels.length > 0) {
      const familyDefault = family
        ? BaseProvider.familyDefaultReasoning(family, supportedLevels)
        : undefined;
      const defaultEffort = defaultLevel ?? familyDefault
        ?? (supportedLevels.includes('high') ? 'high'
          : supportedLevels.includes('on') ? 'on'
          : supportedLevels[supportedLevels.length - 1]);

      properties.reasoningEffort = {
        type: 'string',
        title: 'Thinking Effort',
        enum: supportedLevels,
        default: defaultEffort,
        description: 'Controls how much reasoning effort the model uses',
        enumItemLabels: supportedLevels.map(l => l.charAt(0).toUpperCase() + l.slice(1)),
        enumDescriptions: supportedLevels.map(l => BaseProvider.REASONING_DESCRIPTIONS[l] ?? ''),
        group: 'navigation',
      };
    }

    // Context size configuration
    if (maxInputTokens && maxInputTokens > 16000) {
      const ctxOptions = BaseProvider.getContextSizeOptions(maxInputTokens);
      if (ctxOptions) {
        properties.contextSize = {
          type: 'number',
          title: 'Context Size',
          enum: ctxOptions.map(o => o.value),
          enumItemLabels: ctxOptions.map(o => BaseProvider.formatTokenCount(o.value)),
          enumDescriptions: ctxOptions.map(o => o.description),
          default: ctxOptions.find(o => o.isDefault)?.value,
          group: 'tokens',
        };
      }
    }

    return Object.keys(properties).length > 0
      ? { type: 'object', properties }
      : undefined;
  }

  protected extractModelOptions(
    options: ProvideLanguageModelChatResponseOptions
  ): Record<string, unknown> {
    const userConfig = (options as unknown as { modelConfiguration?: Record<string, unknown> }).modelConfiguration;
    const modelOpts: Record<string, unknown> = { ...options.modelOptions };

    if (userConfig?.reasoningEffort) {
      modelOpts.reasoningEffort = userConfig.reasoningEffort;
    }

    if (userConfig?.temperature !== undefined) {
      modelOpts.temperature = userConfig.temperature;
    }

    if (userConfig?.contextSize !== undefined) {
      modelOpts.maxTokens = userConfig.contextSize;
    }

    return modelOpts;
  }

  async provideTokenCount(
    _model: LanguageModelChatInformation,
    text: string | LanguageModelChatMessage,
    _token: CancellationToken
  ): Promise<number> {
    if (typeof text === 'string') {
      return Math.ceil(text.length / 4);
    }
    let chars = 0;
    for (const part of text.content) {
      if (part instanceof LanguageModelTextPart) {
        chars += part.value.length;
      }
    }
    return Math.ceil(chars / 4);
  }
}
