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
}

/**
 * Base class for local AI providers (LM Studio, Ollama).
 * Handles SSE streaming, tool calls, thinking tag cleanup, and common logic.
 * Subclasses only need to implement model discovery and request building.
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
   * Build the chat request body. Subclasses can override to add provider-specific fields.
   */
  protected buildRequestBody(
    modelId: string,
    messages: any[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    modelInfo?: LocalModelInfo
  ): any {
    const requestBody: any = {
      model: modelId,
      messages,
      stream: true,
    };

    if (options.modelOptions) {
      for (const [key, value] of Object.entries(options.modelOptions)) {
        if (value !== undefined && value !== null) {
          if (key === 'temperature') {
            requestBody.temperature = value;
          } else if (key === 'max_tokens') {
            requestBody.max_tokens = value;
          } else if (key === 'top_p') {
            requestBody.top_p = value;
          } else if (key === 'reasoning') {
            if (!requestBody.extra_body) requestBody.extra_body = {};
            if (typeof value === 'boolean') {
              requestBody.extra_body.reasoning = { enabled: value };
            } else if (typeof value === 'string') {
              requestBody.extra_body.reasoning = { level: value };
            } else if (typeof value === 'object') {
              requestBody.extra_body.reasoning = value;
            }
          } else {
            requestBody[key] = value;
          }
        }
      }
    }

    if (requestBody.temperature === undefined) {
      requestBody.temperature = 0.7;
    }
    if (requestBody.max_tokens === undefined) {
      requestBody.max_tokens = 4096;
    }

    // Enable reasoning if model supports it
    if (modelInfo?.supportsReasoning && !requestBody.extra_body?.reasoning) {
      const defaultLevel = modelInfo.reasoningDefault || 'on';
      if (!requestBody.extra_body) requestBody.extra_body = {};
      if (defaultLevel === 'on' || defaultLevel === 'low' || defaultLevel === 'medium' || defaultLevel === 'high') {
        requestBody.extra_body.reasoning = { level: defaultLevel };
      } else {
        requestBody.extra_body.reasoning = { enabled: true };
      }
    }

    return requestBody;
  }

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

  /**
   * Clean thinking tags from model output.
   */
  protected cleanThinkingTags(text: string): string {
    if (!text) return text;
    let cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
    cleaned = cleaned.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
    cleaned = cleaned.replace(/\[reasoning\][\s\S]*?\[\/reasoning\]/gi, '');
    cleaned = cleaned.replace(/<think>[\s\S]*$/gi, '');
    cleaned = cleaned.replace(/<thinking>[\s\S]*$/gi, '');
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
    return cleaned.trim();
  }

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    const [serverId, modelId] = model.id.split(':');
    const entry = this.modelServerMap.get(serverId);
    if (!entry) throw new Error(`Server ${serverId} not found`);

    const modelInfo = this.modelInfoMap.get(model.id);

    try {
      const openaiMessages = this.convertMessages(messages);
      const requestBody = this.buildRequestBody(modelId, openaiMessages, options, modelInfo);

      const abortController = new AbortController();
      token.onCancellationRequested(() => abortController.abort());

      const response = await fetch(`${entry.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${body}`);
      }

      if (!response.body) {
        throw new Error('No response body for streaming');
      }

      await this.streamResponse(response.body, progress);

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.outputChannel.appendLine(`[${this.constructor.name}] ERROR: ${errorMessage}`);
      throw err;
    }
  }

  /**
   * Stream SSE response. Centralized logic for all local providers.
   */
  protected async streamResponse(
    body: ReadableStream<Uint8Array>,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>
  ): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let contentBuffer = '';
    const toolCallBuffers = new Map<number, { id: string; name: string; args: string }>();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;

          if (trimmed.startsWith('data: ')) {
            try {
              const data = JSON.parse(trimmed.slice(6));
              const delta = data.choices?.[0]?.delta;

              if (delta?.content) {
                contentBuffer += delta.content;
                const cleaned = this.cleanThinkingTags(contentBuffer);
                if (cleaned.length > 0) {
                  progress.report(new vscode.LanguageModelTextPart(cleaned));
                  contentBuffer = '';
                }
              }

              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index || 0;
                  let buf = toolCallBuffers.get(idx);
                  if (!buf) {
                    buf = { id: tc.id || '', name: '', args: '' };
                    toolCallBuffers.set(idx, buf);
                  }
                  if (tc.id) buf.id = tc.id;
                  if (tc.function?.name) buf.name = tc.function.name;
                  if (tc.function?.arguments) buf.args += tc.function.arguments;
                }
              }

              if (data.choices?.[0]?.finish_reason) {
                const cleaned = this.cleanThinkingTags(contentBuffer);
                if (cleaned.length > 0) {
                  progress.report(new vscode.LanguageModelTextPart(cleaned));
                }
                for (const [idx, buf] of toolCallBuffers) {
                  if (buf.id && buf.name) {
                    try {
                      const args = buf.args ? JSON.parse(buf.args) : {};
                      progress.report(new vscode.LanguageModelToolCallPart(buf.id, buf.name, args));
                    } catch {
                      progress.report(new vscode.LanguageModelToolCallPart(buf.id, buf.name, buf.args || {}));
                    }
                  }
                }
              }
            } catch {
              // Skip malformed lines
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
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
