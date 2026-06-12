import * as vscode from 'vscode';
import { BaseLocalProvider, LocalModelInfo } from './BaseLocalProvider';

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

export class OllamaProvider extends BaseLocalProvider {
  public get vendor(): string { return 'ollama-plus'; }
  get displayName(): string { return 'Ollama'; }

  constructor() {
    super('Ollama');
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
            vendor: 'ollama-plus',
            family: info.family || 'unknown',
            version: '1',
            maxInputTokens: info.maxContextLength,
            maxOutputTokens: 4096,
            detail: `${info.family || 'unknown'} · ${info.parameterSize || '?'} · ${Math.round(info.maxContextLength / 1000)}K context`,
            tooltip: `${info.name}\n\nServer: ${entry.serverName}\nFamily: ${info.family || 'unknown'}\nSize: ${info.parameterSize || '?'}\nQuantization: ${info.quantizationLevel || '?'}\nContext: ${Math.round(info.maxContextLength / 1000)}K\nVision: ${info.supportsVision ? 'Yes' : 'No'}\nTools: ${info.supportsTools ? 'Yes' : 'No'}`,
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

  private extractModelInfo(model: OllamaModel): LocalModelInfo {
    const name = model.model || model.name;
    const details = model.details || {};

    const info: LocalModelInfo = {
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

  /**
   * Override to use Ollama's native /api/generate endpoint with NDJSON streaming.
   */
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

    try {
      const ollamaMessages = this.convertMessages(messages);

      const abortController = new AbortController();
      token.onCancellationRequested(() => abortController.abort());

      const ollamaOptions: any = {
        temperature: 0.7,
        num_predict: 4096,
      };

      if (options.modelOptions) {
        for (const [key, value] of Object.entries(options.modelOptions)) {
          if (value !== undefined && value !== null) {
            if (key === 'max_tokens') {
              ollamaOptions.num_predict = value;
            } else if (key === 'top_p') {
              ollamaOptions.top_p = value;
            } else if (key === 'top_k') {
              ollamaOptions.top_k = value;
            } else if (key === 'seed') {
              ollamaOptions.seed = value;
            } else if (key === 'repeat_penalty') {
              ollamaOptions.repeat_penalty = value;
            } else {
              ollamaOptions[key] = value;
            }
          }
        }
      }

      const response = await fetch(`${entry.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: ollamaMessages,
          stream: true,
          options: ollamaOptions,
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

      // Ollama uses NDJSON, not SSE
      await this.streamOllamaResponse(response.body, progress);

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.outputChannel.appendLine(`[OllamaProvider] ERROR: ${errorMessage}`);
      throw err;
    }
  }

  /**
   * Stream NDJSON response from Ollama.
   */
  protected async streamOllamaResponse(
    body: ReadableStream<Uint8Array>,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>
  ): Promise<void> {
    const reader = body.getReader();
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
  }
}
