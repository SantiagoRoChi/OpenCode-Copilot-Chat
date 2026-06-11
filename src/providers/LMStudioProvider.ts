import * as vscode from 'vscode';

// LM Studio native API v1 model response
export interface LMStudioApiModel {
  type: 'llm' | 'embedding';
  publisher: string;
  key: string;
  display_name: string;
  architecture?: string | null;
  quantization?: { name: string; bits_per_weight: number } | null;
  size_bytes: number;
  params_string?: string | null;
  loaded_instances: Array<{
    id: string;
    config: {
      context_length: number;
      eval_batch_size?: number;
      parallel?: number;
      flash_attention?: boolean;
      num_experts?: number;
      offload_kv_cache_to_gpu?: boolean;
    };
  }>;
  max_context_length: number;
  format?: 'gguf' | 'mlx' | null;
  capabilities?: {
    vision?: boolean;
    trained_for_tool_use?: boolean;
    reasoning?: {
      allowed_options: Array<'off' | 'on' | 'low' | 'medium' | 'high'>;
      default: 'off' | 'on' | 'low' | 'medium' | 'high';
    };
  };
  description?: string | null;
  variants?: string[];
  selected_variant?: string;
}

export interface LMStudioModelInfo {
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
        vendor: 'lmstudio',
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
        // Use LM Studio native API v1 for rich model info
        const response = await fetch(`${entry.baseUrl}/api/v1/models`, {
          signal: AbortSignal.timeout(5000),
        });

        if (!response.ok) {
          entry.connected = false;
          continue;
        }

        const data = await response.json() as { models: LMStudioApiModel[] };
        const models = (data.models || []).filter(m => m.type === 'llm');

        for (const model of models) {
          const modelId = `${serverId}:${model.key}`;
          const info = this.extractModelInfo(model);

          this.modelInfoMap.set(modelId, info);

          const reasoningLabel = info.supportsReasoning
            ? ` · reasoning (${info.reasoningDefault || 'off'})`
            : '';

          allModels.push({
            id: modelId,
            name: `${info.name} (${entry.serverName})`,
            vendor: 'lmstudio',
            family: info.architecture || 'unknown',
            version: '1',
            maxInputTokens: info.maxContextLength,
            maxOutputTokens: 4096,
            detail: `${info.architecture || 'unknown'} · ${info.parameters || '?'} · ${Math.round(info.maxContextLength / 1000)}K context${info.supportsVision ? ' · vision' : ''}${info.supportsTools ? ' · tools' : ''}${reasoningLabel}`,
            tooltip: `${info.name}\n\nServer: ${entry.serverName}\nArchitecture: ${info.architecture || 'unknown'}\nParameters: ${info.parameters || '?'}\nQuantization: ${info.quantization || '?'}\nContext: ${Math.round(info.maxContextLength / 1000)}K\nVision: ${info.supportsVision ? 'Yes' : 'No'}\nTools: ${info.supportsTools ? 'Yes' : 'No'}\nReasoning: ${info.supportsReasoning ? `Yes (${info.reasoningOptions?.join(', ') || 'on'})` : 'No'}`,
            capabilities: {
              imageInput: info.supportsVision,
              toolCalling: info.supportsTools,
            },
          });
        }

        entry.connected = true;
        this.outputChannel.appendLine(`[LMStudioProvider] "${entry.serverName}": ${models.length} LLM models`);
      } catch (err) {
        entry.connected = false;
        this.outputChannel.appendLine(`[LMStudioProvider] "${entry.serverName}" ERROR: ${err}`);
      }
    }

    this.models = allModels;
    this.lastFetch = Date.now();
  }

  private extractModelInfo(model: LMStudioApiModel): LMStudioModelInfo {
    const info: LMStudioModelInfo = {
      id: model.key,
      name: model.display_name || model.key.split('/').pop() || model.key,
      maxContextLength: model.max_context_length || 32768,
      supportsReasoning: false,
      supportsVision: false,
      supportsTools: false,
      architecture: model.architecture || undefined,
      parameters: model.params_string || undefined,
      quantization: model.quantization?.name || undefined,
    };

    // Extract capabilities from LM Studio API
    if (model.capabilities) {
      info.supportsVision = !!model.capabilities.vision;
      info.supportsTools = !!model.capabilities.trained_for_tool_use;

      if (model.capabilities.reasoning) {
        info.supportsReasoning = true;
        info.reasoningOptions = model.capabilities.reasoning.allowed_options;
        info.reasoningDefault = model.capabilities.reasoning.default;
      }
    }

    return info;
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
      // Convert messages to LM Studio native format
      const input: any[] = [];
      let systemPrompt = '';

      for (const msg of messages) {
        const role = msg.role === vscode.LanguageModelChatMessageRole.Assistant ? 'assistant' : 'user';
        const content = msg.content
          .filter(part => part instanceof vscode.LanguageModelTextPart)
          .map(part => (part as vscode.LanguageModelTextPart).value)
          .join('');

        if (role === 'assistant') {
          input.push({ type: 'message', role: 'assistant', content });
        } else {
          // Check for images in user messages
          const imageParts = msg.content.filter(part => part instanceof vscode.LanguageModelDataPart);
          if (imageParts.length > 0) {
            const items: any[] = [{ type: 'text', text: content }];
            for (const img of imageParts) {
              const dataPart = img as vscode.LanguageModelDataPart;
              if (dataPart.data && dataPart.mimeType) {
                const base64 = Buffer.from(dataPart.data).toString('base64');
                items.push({
                  type: 'image',
                  data_url: `data:${dataPart.mimeType};base64,${base64}`,
                });
              }
            }
            input.push({ type: 'message', role: 'user', content: items });
          } else {
            input.push({ type: 'message', role: 'user', content });
          }
        }
      }

      const abortController = new AbortController();
      token.onCancellationRequested(() => abortController.abort());

      // Build LM Studio native request body
      const requestBody: any = {
        model: modelId,
        input,
        stream: true,
      };

      // Apply modelOptions from VS Code
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
              // LM Studio reasoning: { enabled: true } or { level: 'low'|'medium'|'high' }
              if (typeof value === 'boolean') {
                requestBody.reasoning = { enabled: value };
              } else if (typeof value === 'string') {
                requestBody.reasoning = { level: value };
              } else if (typeof value === 'object') {
                requestBody.reasoning = value;
              }
            } else {
              requestBody[key] = value;
            }
          }
        }
      }

      // Set defaults
      if (requestBody.temperature === undefined) {
        requestBody.temperature = 0.7;
      }
      if (requestBody.max_tokens === undefined) {
        requestBody.max_tokens = 4096;
      }

      // Enable reasoning if model supports it and user hasn't explicitly disabled it
      if (modelInfo?.supportsReasoning && !requestBody.reasoning) {
        const defaultLevel = modelInfo.reasoningDefault || 'on';
        if (defaultLevel === 'on' || defaultLevel === 'low' || defaultLevel === 'medium' || defaultLevel === 'high') {
          requestBody.reasoning = { level: defaultLevel };
        } else {
          requestBody.reasoning = { enabled: true };
        }
      }

      // Use LM Studio native streaming API
      const response = await fetch(`${entry.baseUrl}/api/v1/chat`, {
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

      // Process LM Studio SSE stream with named events
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let inReasoning = false;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          let currentEvent = '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) {
              currentEvent = '';
              continue;
            }

            if (trimmed.startsWith('event: ')) {
              currentEvent = trimmed.slice(7);
            } else if (trimmed.startsWith('data: ')) {
              try {
                const data = JSON.parse(trimmed.slice(6));

                switch (currentEvent) {
                  case 'reasoning.start':
                    inReasoning = true;
                    break;
                  case 'reasoning.delta':
                    if (data.delta) {
                      progress.report(new vscode.LanguageModelTextPart(data.delta));
                    }
                    break;
                  case 'reasoning.end':
                    inReasoning = false;
                    break;
                  case 'message.delta':
                    if (data.delta) {
                      progress.report(new vscode.LanguageModelTextPart(data.delta));
                    }
                    break;
                  case 'error':
                    throw new Error(data.message || 'LM Studio streaming error');
                  case 'chat.end':
                    // Stream complete
                    break;
                }
              } catch (parseErr) {
                if (parseErr instanceof Error && !parseErr.message.includes('LM Studio streaming error')) {
                  // Skip malformed lines
                } else {
                  throw parseErr;
                }
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

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
