import * as vscode from 'vscode';
import { OpenAICompatibleProvider, RoutedModelInfo } from './OpenAICompatibleProvider';
import { GO_BASE_URL } from '../client/endpoints';
import { SecretStorage } from '../config/secretStorage';
import { getModelCapabilities, getModelEndpoint } from '../client/modelRegistry';

interface ApiModel { id: string; }

export class OpenCodeGoProvider extends OpenAICompatibleProvider {
  private apiKey = '';
  private readonly storage: SecretStorage;
  private readonly out = vscode.window.createOutputChannel('OpenCode Go');

  get vendor(): string { return 'opencode-go'; }

  constructor(context: vscode.ExtensionContext) {
    super();
    this.storage = new SecretStorage(context);
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
      const res = await fetch(`${GO_BASE_URL}/models`, {
        headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return [];
      const data = await res.json() as { data: ApiModel[] };
      this.out.appendLine(`[Go] ${data.data?.length ?? 0} models`);
      return (data.data ?? []).map(m => this.toModelInfo(m.id));
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
    if (caps.reasoning) {
      (info as any).configurationSchema = {
        properties: {
          reasoningEffort: {
            type: 'string', enum: ['low', 'medium', 'high'],
            default: caps.thinkingEffort ?? 'medium',
            description: 'Reasoning depth.',
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

