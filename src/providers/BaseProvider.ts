import * as vscode from 'vscode';
import { ApiFormat, isModelRegistryPopulated, refreshModelRegistry } from '../client/modelRegistry';

/**
 * Routing data embedded directly in each model object.
 * VS Code returns the exact object from provideLanguageModelChatInformation
 * back to provideLanguageModelChatResponse, so we can read _url/_headers/_apiFormat
 * without any server lookup map.
 */
export interface RoutedModelInfo extends vscode.LanguageModelChatInformation {
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
  /**
   * Configuration schema for model options shown in the chat UI.
   * This allows users to configure reasoning effort, temperature, etc.
   */
  configurationSchema?: LanguageModelConfigurationSchema;
}

/**
 * Local interface for LanguageModelConfigurationSchema
 * since it may not be available in all VS Code API versions.
 */
export interface LanguageModelConfigurationProperty {
  type: string;
  title?: string;
  description?: string;
  default?: string;
  enum?: string[];
  enumItemLabels?: string[];
  enumDescriptions?: string[];
  group?: string;
}

export interface LanguageModelConfigurationSchema {
  type: 'object';
  properties?: Record<string, LanguageModelConfigurationProperty>;
}

/**
 * Base class for all LM providers (OpenAI, Anthropic, and compatible).
 *
 * Responsibilities:
 *  - Model discovery and caching (provideLanguageModelChatInformation)
 *  - Token counting (provideTokenCount)
 *  - onDidChangeLanguageModelChatInformation event
 *
 * Subclasses ONLY need to implement:
 *  - getModels(): discover and return RoutedModelInfo[]
 *  - provideLanguageModelChatResponse(): stream the chat response
 *    using the AI SDK handlers in ./sdk/
 */
export abstract class BaseProvider implements vscode.LanguageModelChatProvider {
  protected models: RoutedModelInfo[] = [];
  protected lastFetch = 0;
  protected readonly cacheTtlMs = 5 * 60 * 1000;

  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeLanguageModelChatInformation = this._onDidChange.event;

  protected fire(): void {
    this._onDidChange.fire();
  }

  dispose(): void {
    this._onDidChange.dispose();
  }

  // ── Subclass contract ─────────────────────────────────────────────────────

  /** Discover models and return them with routing data embedded. */
  protected abstract getModels(): Promise<RoutedModelInfo[]>;

  /**
   * Stream a chat response for the given model.
   * Each subclass implements this — use the SDK handlers in ./sdk/.
   */
  abstract provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void>;

  // ── provideLanguageModelChatInformation ───────────────────────────────────

  async provideLanguageModelChatInformation(
    _options: { silent: boolean; configuration?: Record<string, unknown> },
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelChatInformation[]> {
    // Ensure the model registry is populated before resolving capabilities
    if (!isModelRegistryPopulated()) {
      await refreshModelRegistry();
    }

    if (Date.now() - this.lastFetch > this.cacheTtlMs || this.models.length === 0) {
      this.models = await this.getModels().catch(() => this.models);
      this.lastFetch = Date.now();
    }
    return this.models as vscode.LanguageModelChatInformation[];
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

  /** Get current cached models without triggering a fetch */
  getCurrentModels(): RoutedModelInfo[] {
    return this.models;
  }

  // ── Configuration helpers ─────────────────────────────────────────────────

  private static readonly REASONING_DESCRIPTIONS: Record<string, string> = {
    off:    'No reasoning applied',
    on:     'Model decides reasoning automatically',
    low:    'Faster responses with less reasoning',
    medium: 'Balanced reasoning and speed',
    high:   'Greater reasoning depth but slower',
    xhigh:  'Highest reasoning depth but slowest',
    max:    'Absolute maximum capability with no constraints',
  };

  /**
   * Builds the configurationSchema for a model based on its capabilities.
   * This schema controls what options appear in the chat UI model picker.
   *
   * @param supportedLevels - Array of reasoning levels the model supports (e.g. ['low','medium','high'])
   * @param defaultLevel - Default reasoning level
   * @returns The configuration schema or undefined if no configurable options
   */
  protected buildConfigurationSchema(
    supportedLevels?: string[],
    defaultLevel?: string
  ): LanguageModelConfigurationSchema | undefined {
    const properties: NonNullable<LanguageModelConfigurationSchema['properties']> = {};

    // Add reasoning effort config only when the model supports multiple levels
    if (supportedLevels && supportedLevels.length > 0) {
      const defaultEffort = defaultLevel
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

    return Object.keys(properties).length > 0
      ? { type: 'object', properties }
      : undefined;
  }

  /**
   * Extracts user configuration from the response options.
   * Merges modelConfiguration (from UI picker) with modelOptions (from the API).
   *
   * @param options - The provideLanguageModelChatResponse options
   * @returns Merged model options including user configuration
   */
  protected extractModelOptions(
    options: vscode.ProvideLanguageModelChatResponseOptions
  ): Record<string, unknown> {
    const userConfig = (options as any).modelConfiguration as Record<string, unknown> | undefined;
    const modelOpts: Record<string, unknown> = { ...options.modelOptions };

    // Apply reasoning effort if configured via the UI picker
    if (userConfig?.reasoningEffort) {
      modelOpts.reasoningEffort = userConfig.reasoningEffort;
    }

    // Apply temperature if configured via the UI picker
    if (userConfig?.temperature !== undefined) {
      modelOpts.temperature = userConfig.temperature;
    }

    return modelOpts;
  }

  // ── provideTokenCount ─────────────────────────────────────────────────────

  async provideTokenCount(
    _model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatMessage,
    _token: vscode.CancellationToken
  ): Promise<number> {
    if (typeof text === 'string') {
      return Math.ceil(text.length / 4);
    }
    let chars = 0;
    for (const part of text.content) {
      if (part instanceof vscode.LanguageModelTextPart) {
        chars += part.value.length;
      }
    }
    return Math.ceil(chars / 4);
  }
}
