import * as vscode from 'vscode';
import { OpenAICompatibleProvider, RoutedModelInfo } from './OpenAICompatibleProvider';
import { ZEN_BASE_URL } from '../client/endpoints';
import { SecretStorage } from '../config/secretStorage';
import { getModelCapabilities, getModelEndpoint } from '../client/modelRegistry';

interface ApiModel { id: string; }

export class OpenCodeZenProvider extends OpenAICompatibleProvider {
  protected apiKey = '';
  private readonly storage: SecretStorage;
  protected readonly out = vscode.window.createOutputChannel('OpenCode Zen');

  get vendor(): string { return 'opencode-zen'; }

  constructor(context: vscode.ExtensionContext) {
    super();
    this.storage = new SecretStorage(context);
  }

  async loadApiKey(): Promise<void> {
    this.apiKey = await this.storage.getZenKey();
    if (this.apiKey) {
      // Invalidate cache so VS Code re-queries models with the loaded key
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

  protected getBaseUrl(): string { return ZEN_BASE_URL; }
  protected filterModels(models: ApiModel[]): ApiModel[] {
    // Exclude free/pickle (those belong to OpenCodeFreeProvider)
    // Exclude gemini (uses non-standard Google format, not yet supported)
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

