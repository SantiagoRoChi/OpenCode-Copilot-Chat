import * as vscode from 'vscode';
import { BaseProvider, RoutedModelInfo } from './OpenAICompatibleProvider';
import { ZEN_BASE_URL } from '../client/endpoints';
import { SecretStorage } from '../config/secretStorage';
import { getModelCapabilities, getModelEndpoint } from '../client/modelRegistry';
import { streamOpenAIChat } from './sdk/openaiChat';
import { streamAnthropicChat } from './sdk/anthropicChat';

interface ApiModel { id: string; }

export class OpenCodeFreeProvider extends BaseProvider {
  private apiKey = '';
  private readonly storage: SecretStorage;
  private readonly out = vscode.window.createOutputChannel('OpenCode Free');

  get vendor(): string { return 'opencode-free'; }

  constructor(context: vscode.ExtensionContext) {
    super();
    this.storage = new SecretStorage(context);
  }

  async loadApiKey(): Promise<void> {
    this.apiKey = await this.storage.getZenKey();  // Free uses same Zen key
    if (this.apiKey) this.invalidateCache();
  }

  async setApiKey(key: string): Promise<void> {
    this.apiKey = key;
    await this.storage.setZenKey(key);
    this.refreshModels();
  }

  getApiKey(): string { return this.apiKey; }

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
      throw new Error('API key not configured. Use "OpenCode Zen: Configure Zen Key".');
    }

    const tools = (options as any).tools as vscode.LanguageModelChatTool[] | undefined;
    const modelOpts = options.modelOptions ?? {};

    if (rm._apiFormat === 'anthropic') {
      await streamAnthropicChat(
        apiKey, `${ZEN_BASE_URL}`, rm._apiId,
        rm.maxOutputTokens, messages, tools, modelOpts, progress, token,
      );
    } else {
      await streamOpenAIChat(
        apiKey, `${ZEN_BASE_URL}`, rm._apiId,
        rm.maxOutputTokens, messages, tools, modelOpts, progress, token,
      );
    }
    this.out.appendLine(`[Free] ✅ ${rm._apiId} responded`);
  }

  override async provideLanguageModelChatInformation(
    options: { silent: boolean; configuration?: Record<string, unknown> },
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelChatInformation[]> {
    const configKey = options.configuration?.apiKey as string | undefined;
    if (configKey && configKey !== this.apiKey) await this.setApiKey(configKey);
    return super.provideLanguageModelChatInformation(options, token);
  }

  protected getEndpoint(_modelId: string): never { throw new Error('not used'); }

  protected async getModels(): Promise<RoutedModelInfo[]> {
    try {
      const res = await fetch(`${ZEN_BASE_URL}/models`, {
        headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return [];
      const data = await res.json() as { data: ApiModel[] };
      // Free tier: only free/pickle models
      const models = (data.data ?? []).filter(
        m => m.id.includes('free') || m.id.includes('pickle')
      );
      this.out.appendLine(`[Free] ${models.length} models`);
      return models.map(m => this.toModelInfo(m.id));
    } catch (err) {
      this.out.appendLine(`[Free] error: ${err}`);
      return [];
    }
  }

  private toModelInfo(id: string): RoutedModelInfo {
    const caps = getModelCapabilities(id);
    const ep = getModelEndpoint('zen', id);
    return {
      id,
      name: caps.name !== id ? caps.name : id,
      family: caps.family,
      version: '1',
      maxInputTokens: caps.maxInputTokens,
      maxOutputTokens: caps.maxOutputTokens,
      capabilities: { toolCalling: caps.toolCalling, imageInput: caps.imageInput },
      _url: `${ZEN_BASE_URL}${ep.chatEndpoint}`,
      _headers: { Authorization: `Bearer ${this.apiKey}` },
      _apiId: id,
      _apiFormat: ep.apiFormat === 'google' ? 'openai-compatible' : ep.apiFormat,
      _pricing: caps.pricePerMillionInput !== undefined || caps.pricePerMillionOutput !== undefined ? {
        inputTokenPrice: caps.pricePerMillionInput ? caps.pricePerMillionInput / 1_000_000 : undefined,
        outputTokenPrice: caps.pricePerMillionOutput ? caps.pricePerMillionOutput / 1_000_000 : undefined,
        currency: 'USD',
      } : undefined,
    };
  }

  override dispose(): void {
    this.out.dispose();
    super.dispose();
  }
}

