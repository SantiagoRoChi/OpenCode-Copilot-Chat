import * as vscode from 'vscode';

export interface ServerEntry {
  serverId: string;
  serverName: string;
  baseUrl: string;
  connected: boolean;
}

export interface LocalModelInfo {
  id: string;
  name: string;
  maxContextLength: number;
  supportsReasoning: boolean;
  supportsVision: boolean;
  supportsTools: boolean;
  reasoningOptions?: Array<'off' | 'on' | 'low' | 'medium' | 'high'>;
  reasoningDefault?: 'off' | 'on' | 'low' | 'medium' | 'high';
  quantization?: string;
  parameters?: string;
  architecture?: string;
  family?: string;
  parameterSize?: string;
  quantizationLevel?: string;
}

/**
 * Base class for local AI providers (LM Studio, Ollama).
 * Handles server management, model discovery, and common helpers.
 * Subclasses implement their own provideLanguageModelChatResponse() with provider-specific streaming.
 */
export abstract class BaseLocalProvider implements vscode.LanguageModelChatProvider {
  protected models: vscode.LanguageModelChatInformation[] = [];
  protected modelInfoMap = new Map<string, LocalModelInfo>();
  protected modelServerMap = new Map<string, ServerEntry>();
  protected lastFetch = 0;
  protected readonly outputChannel: vscode.OutputChannel;
  protected readonly _onDidChangeLanguageModelChatInformation = new vscode.EventEmitter<void>();

  readonly onDidChangeLanguageModelChatInformation = this._onDidChangeLanguageModelChatInformation.event;

  abstract get vendor(): string;
  abstract get displayName(): string;

  constructor(outputChannelName: string) {
    this.outputChannel = vscode.window.createOutputChannel(outputChannelName);
    this.outputChannel.appendLine(`[${this.constructor.name}] Created`);
  }

  dispose(): void {
    this.outputChannel.dispose();
    this._onDidChangeLanguageModelChatInformation.dispose();
  }

  addServer(serverId: string, serverName: string, baseUrl: string): void {
    this.modelServerMap.set(serverId, {
      serverId,
      serverName,
      baseUrl: baseUrl.replace(/\/$/, ''),
      connected: true,
    });
    this.outputChannel.appendLine(`[${this.constructor.name}] Added "${serverName}" (${baseUrl})`);
    this.lastFetch = 0;
    void this.fetchModels().then(() => this._onDidChangeLanguageModelChatInformation.fire());
  }

  removeServer(serverId: string): void {
    this.modelServerMap.delete(serverId);
    this.lastFetch = 0;
    void this.fetchModels().then(() => this._onDidChangeLanguageModelChatInformation.fire());
  }

  getServerStatus(): Array<{ id: string; name: string; url: string; available: boolean; models: string[] }> {
    const result: Array<{ id: string; name: string; url: string; available: boolean; models: string[] }> = [];
    for (const [serverId, entry] of this.modelServerMap) {
      const serverModels = this.models
        .filter(m => m.id.startsWith(`${serverId}:`) && !m.id.includes(':offline'))
        .map(m => m.id.split(':')[1] || m.id);
      result.push({
        id: serverId,
        name: entry.serverName,
        url: entry.baseUrl,
        available: entry.connected && serverModels.length > 0,
        models: serverModels,
      });
    }
    return result;
  }

  async provideLanguageModelChatInformation(
    _options: { silent: boolean; configuration?: { [key: string]: unknown } },
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelChatInformation[]> {
    if (Date.now() - this.lastFetch > 5 * 60 * 1000 || this.models.length === 0) {
      await this.fetchModels();
    }
    if (this.models.length === 0 && this.modelServerMap.size > 0) {
      return this.getPlaceholderModels();
    }
    return this.models;
  }

  protected getPlaceholderModels(): vscode.LanguageModelChatInformation[] {
    const placeholders: vscode.LanguageModelChatInformation[] = [];
    for (const [serverId, entry] of this.modelServerMap) {
      placeholders.push({
        id: `${serverId}:offline`,
        name: `⚠️ ${entry.serverName} (offline)`,
        vendor: this.vendor,
        family: this.vendor,
        version: '1',
        maxInputTokens: 0,
        maxOutputTokens: 0,
        capabilities: {},
      });
    }
    return placeholders;
  }

  /**
   * Subclasses must implement this to fetch models from their API.
   */
  abstract fetchModels(): Promise<void>;

  /**
   * Convert VS Code messages to OpenAI format.
   */
  protected convertMessages(messages: readonly vscode.LanguageModelChatMessage[]): any[] {
    const openaiMessages: any[] = [];
    for (const msg of messages) {
      const role = msg.role === vscode.LanguageModelChatMessageRole.Assistant ? 'assistant' : 'user';
      const textParts = msg.content
        .filter(part => part instanceof vscode.LanguageModelTextPart)
        .map(part => (part as vscode.LanguageModelTextPart).value)
        .join('');
      openaiMessages.push({ role, content: textParts });
    }
    return openaiMessages;
  }

  async provideTokenCount(
    _model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatMessage,
    _token: vscode.CancellationToken
  ): Promise<number> {
    if (typeof text === 'string') return Math.ceil(text.length / 4);
    let tokens = 0;
    for (const part of text.content) {
      if (part instanceof vscode.LanguageModelTextPart) {
        tokens += Math.ceil(part.value.length / 4);
      }
    }
    return tokens;
  }
}
