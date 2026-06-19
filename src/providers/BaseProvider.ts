import * as vscode from 'vscode';
import { ApiFormat } from '../client/modelRegistry';

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
