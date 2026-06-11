import * as vscode from 'vscode';

export interface LMStudioModel {
  id: string;
  object: string;
  owned_by: string;
}

export interface LMStudioModelInfo {
  id: string;
  name: string;
  maxContextLength: number;
  supportsReasoning: boolean;
  supportsVision: boolean;
  supportsTools: boolean;
  quantization?: string;
  parameters?: string;
  architecture?: string;
}

interface ServerEntry {
  serverId: string;
  serverName: string;
  baseUrl: string;
  connected: boolean;
}

export class LMStudioProvider implements vscode.LanguageModelChatProvider {
  private models: vscode.LanguageModelChatInformation[] = [];
  private modelInfoMap = new Map<string, LMStudioModelInfo>();
  private modelServerMap = new Map<string, ServerEntry>();
  private lastFetch = 0;
  private readonly outputChannel: vscode.OutputChannel;
  private readonly _onDidChangeLanguageModelChatInformation = new vscode.EventEmitter<void>();

  readonly onDidChangeLanguageModelChatInformation = this._onDidChangeLanguageModelChatInformation.event;

  public get vendor(): string { return 'lmstudio'; }
  get displayName(): string { return 'LM Studio'; }

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel('LM Studio');
    this.outputChannel.appendLine('[LMStudioProvider] Created');
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
    this.outputChannel.appendLine(`[LMStudioProvider] Added "${serverName}" (${baseUrl})`);
    this.lastFetch = 0;
    void this.fetchModels().then(() => this._onDidChangeLanguageModelChatInformation.fire());
  }

  removeServer(serverId: string): void {
    this.modelServerMap.delete(serverId);
    this.lastFetch = 0;
    void this.fetchModels().then(() => this._onDidChangeLanguageModelChatInformation.fire());
  }

  async provideLanguageModelChatInformation(
    _options: { silent: boolean; configuration?: { [key: string]: unknown } },
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelChatInformation[]> {
    if (Date.now() - this.lastFetch > 5 * 60 * 1000 || this.models.length === 0) {
      await this.fetchModels();
    }
    // If no models found but servers are configured, show placeholder
    if (this.models.length === 0 && this.modelServerMap.size > 0) {
      return this.getPlaceholderModels();
    }
    return this.models;
  }

  private getPlaceholderModels(): vscode.LanguageModelChatInformation[] {
    const placeholders: vscode.LanguageModelChatInformation[] = [];
    for (const [serverId, entry] of this.modelServerMap) {
      placeholders.push({
        id: `${serverId}:offline`,
        name: `⚠️ ${entry.serverName} (offline)`,
        family: 'lmstudio',
        version: '1',
        maxInputTokens: 0,
        maxOutputTokens: 0,
        capabilities: {},
      });
    }
    return placeholders;
  }

  async fetchModels(): Promise<void> {
    const allModels: vscode.LanguageModelChatInformation[] = [];

    for (const [serverId, entry] of this.modelServerMap) {
      try {
        const response = await fetch(`${entry.baseUrl}/v1/models`, {
          signal: AbortSignal.timeout(5000),
        });

        if (!response.ok) {
          entry.connected = false;
          continue;
        }

        const data = await response.json() as { data: LMStudioModel[] };
        const models = data.data || [];

        for (const model of models) {
          const modelId = `${serverId}:${model.id}`;
          const info = await this.detectModelInfo(entry.baseUrl, model.id);

          this.modelInfoMap.set(modelId, info);

          allModels.push({
            id: modelId,
            name: `${info.name} (${entry.serverName})`,
            family: info.architecture || 'unknown',
            version: '1',
            maxInputTokens: info.maxContextLength,
            maxOutputTokens: 4096,
            capabilities: {
              imageInput: info.supportsVision,
              toolCalling: info.supportsTools,
            },
          });
        }

        entry.connected = true;
        this.outputChannel.appendLine(`[LMStudioProvider] "${entry.serverName}": ${models.length} models`);
      } catch (err) {
        entry.connected = false;
        this.outputChannel.appendLine(`[LMStudioProvider] "${entry.serverName}" ERROR: ${err}`);
      }
    }

    this.models = allModels;
    this.lastFetch = Date.now();
  }

  private async detectModelInfo(baseUrl: string, modelId: string): Promise<LMStudioModelInfo> {
    // Default info
    const info: LMStudioModelInfo = {
      id: modelId,
      name: modelId.split('/').pop() || modelId,
      maxContextLength: 32768,
      supportsReasoning: false,
      supportsVision: false,
      supportsTools: false,
    };

    // Try to get model details from LMStudio
    try {
      const response = await fetch(`${baseUrl}/v1/models/${modelId}`, {
        signal: AbortSignal.timeout(3000),
      });

      if (response.ok) {
        const details = await response.json() as any;
        if (details.max_context_length) {
          info.maxContextLength = details.max_context_length;
        }
        if (details.quantization) {
          info.quantization = details.quantization;
        }
        if (details.parameters) {
          info.parameters = details.parameters;
        }
        if (details.architecture) {
          info.architecture = details.architecture;
        }
      }
    } catch {
      // Fallback to heuristic detection
    }

    // Heuristic detection based on model name
    const nameLower = modelId.toLowerCase();
    if (nameLower.includes('vision') || nameLower.includes('vl') || nameLower.includes('multimodal')) {
      info.supportsVision = true;
    }
    if (nameLower.includes('reasoning') || nameLower.includes('think') || nameLower.includes('deepseek') || nameLower.includes('qwen3')) {
      info.supportsReasoning = true;
    }
    if (nameLower.includes('tool') || nameLower.includes('function')) {
      info.supportsTools = true;
    }
    if (nameLower.includes('128k') || nameLower.includes('128k')) {
      info.maxContextLength = 128000;
    } else if (nameLower.includes('32k')) {
      info.maxContextLength = 32768;
    } else if (nameLower.includes('8k')) {
      info.maxContextLength = 8192;
    }

    return info;
  }

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatMessage[],
    _options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    const [serverId, modelId] = model.id.split(':');
    const entry = this.modelServerMap.get(serverId);
    if (!entry) throw new Error(`Server ${serverId} not found`);

    try {
      // Convert messages to OpenAI format
      const openaiMessages = messages.map(msg => {
        const role = msg.role === vscode.LanguageModelChatMessageRole.Assistant ? 'assistant' : 'user';
        const content = msg.content
          .filter(part => part instanceof vscode.LanguageModelTextPart)
          .map(part => (part as vscode.LanguageModelTextPart).value)
          .join('');
        return { role, content };
      });

      const abortController = new AbortController();
      token.onCancellationRequested(() => abortController.abort());

      // Use streaming API
      const response = await fetch(`${entry.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: openaiMessages,
          temperature: 0.7,
          max_tokens: 4096,
          stream: true,
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${body}`);
      }

      if (!response.body) {
        throw new Error('No response body for streaming');
      }

      // Process SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

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
                  progress.report(new vscode.LanguageModelTextPart(delta.content));
                }

                if (delta?.reasoning_content) {
                  progress.report(new vscode.LanguageModelTextPart(`[reasoning]\n${delta.reasoning_content}\n[/reasoning]\n\n`));
                }

                if (data.choices?.[0]?.finish_reason) {
                  // Stream finished
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

      // Ensure we emit something if stream was empty
      // (LMStudio sometimes returns empty content)

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.outputChannel.appendLine(`[LMStudioProvider] ERROR: ${errorMessage}`);
      throw err;
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
