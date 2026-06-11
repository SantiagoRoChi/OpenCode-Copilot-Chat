import * as vscode from 'vscode';

export interface OllamaModel {
  name: string;
  model: string;
  modified_at: string;
  size: number;
  digest: string;
  details?: {
    parent_model?: string;
    format?: string;
    family?: string;
    families?: string[];
    parameter_size?: string;
    quantization_level?: string;
  };
}

export interface OllamaModelInfo {
  id: string;
  name: string;
  maxContextLength: number;
  supportsReasoning: boolean;
  supportsVision: boolean;
  supportsTools: boolean;
  family?: string;
  parameterSize?: string;
  quantizationLevel?: string;
}

interface ServerEntry {
  serverId: string;
  serverName: string;
  baseUrl: string;
  connected: boolean;
}

export class OllamaProvider implements vscode.LanguageModelChatProvider {
  private models: vscode.LanguageModelChatInformation[] = [];
  private modelInfoMap = new Map<string, OllamaModelInfo>();
  private modelServerMap = new Map<string, ServerEntry>();
  private lastFetch = 0;
  private readonly outputChannel: vscode.OutputChannel;
  private readonly _onDidChangeLanguageModelChatInformation = new vscode.EventEmitter<void>();

  readonly onDidChangeLanguageModelChatInformation = this._onDidChangeLanguageModelChatInformation.event;

  public get vendor(): string { return 'ollama'; }
  get displayName(): string { return 'Ollama'; }

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel('Ollama');
    this.outputChannel.appendLine('[OllamaProvider] Created');
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
    this.outputChannel.appendLine(`[OllamaProvider] Added "${serverName}" (${baseUrl})`);
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
    return this.models;
  }

  async fetchModels(): Promise<void> {
    const allModels: vscode.LanguageModelChatInformation[] = [];

    for (const [serverId, entry] of this.modelServerMap) {
      try {
        const response = await fetch(`${entry.baseUrl}/api/tags`, {
          signal: AbortSignal.timeout(5000),
        });

        if (!response.ok) {
          entry.connected = false;
          continue;
        }

        const data = await response.json() as { models: OllamaModel[] };
        const models = data.models || [];

        for (const model of models) {
          const modelId = `${serverId}:${model.model || model.name}`;
          const info = this.extractModelInfo(model);

          this.modelInfoMap.set(modelId, info);

          allModels.push({
            id: modelId,
            name: `${info.name} (${entry.serverName})`,
            family: info.family || 'unknown',
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
        this.outputChannel.appendLine(`[OllamaProvider] "${entry.serverName}": ${models.length} models`);
      } catch (err) {
        entry.connected = false;
        this.outputChannel.appendLine(`[OllamaProvider] "${entry.serverName}" ERROR: ${err}`);
      }
    }

    this.models = allModels;
    this.lastFetch = Date.now();
  }

  private extractModelInfo(model: OllamaModel): OllamaModelInfo {
    const name = model.model || model.name;
    const details = model.details || {};

    const info: OllamaModelInfo = {
      id: name,
      name: name.split(':')[0],
      maxContextLength: 32768,
      supportsReasoning: false,
      supportsVision: false,
      supportsTools: false,
      family: details.family,
      parameterSize: details.parameter_size,
      quantizationLevel: details.quantization_level,
    };

    // Heuristic detection based on model name and details
    const nameLower = name.toLowerCase();
    const familyLower = (details.family || '').toLowerCase();

    if (nameLower.includes('vision') || nameLower.includes('vl') || familyLower.includes('llava')) {
      info.supportsVision = true;
    }
    if (nameLower.includes('reasoning') || nameLower.includes('think') || familyLower.includes('deepseek')) {
      info.supportsReasoning = true;
    }
    if (nameLower.includes('tool') || familyLower.includes('qwen') || familyLower.includes('llama3')) {
      info.supportsTools = true;
    }

    // Context length heuristics
    if (details.parameter_size) {
      const size = details.parameter_size.toLowerCase();
      if (size.includes('70b') || size.includes('65b')) {
        info.maxContextLength = 128000;
      } else if (size.includes('13b') || size.includes('14b')) {
        info.maxContextLength = 32768;
      } else if (size.includes('7b') || size.includes('8b')) {
        info.maxContextLength = 32768;
      }
    }

    if (nameLower.includes('128k')) {
      info.maxContextLength = 128000;
    } else if (nameLower.includes('32k')) {
      info.maxContextLength = 32768;
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
      // Convert messages to Ollama format
      const ollamaMessages = messages.map(msg => {
        const role = msg.role === vscode.LanguageModelChatMessageRole.Assistant ? 'assistant' : 'user';
        const content = msg.content
          .filter(part => part instanceof vscode.LanguageModelTextPart)
          .map(part => (part as vscode.LanguageModelTextPart).value)
          .join('');
        return { role, content };
      });

      const abortController = new AbortController();
      token.onCancellationRequested(() => abortController.abort());

      // Use Ollama generate API with streaming
      const response = await fetch(`${entry.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: ollamaMessages,
          stream: true,
          options: {
            temperature: 0.7,
            num_predict: 4096,
          },
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

      // Process NDJSON stream
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
            if (!line.trim()) continue;

            try {
              const data = JSON.parse(line);

              if (data.response) {
                progress.report(new vscode.LanguageModelTextPart(data.response));
              }

              if (data.done) {
                // Generation complete
              }
            } catch {
              // Skip malformed lines
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.outputChannel.appendLine(`[OllamaProvider] ERROR: ${errorMessage}`);
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
