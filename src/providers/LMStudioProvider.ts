import * as vscode from 'vscode';
import { BaseLocalProvider, LocalModelInfo } from './BaseLocalProvider';

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

export class LMStudioProvider extends BaseLocalProvider {
  public get vendor(): string { return 'lmstudio'; }
  get displayName(): string { return 'LM Studio'; }

  constructor() {
    super('LM Studio');
  }

  async fetchModels(): Promise<void> {
    const allModels: vscode.LanguageModelChatInformation[] = [];

    for (const [serverId, entry] of this.modelServerMap) {
      try {
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

          const chatInfo: vscode.LanguageModelChatInformation = {
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
          };

          // Add reasoning effort configuration for reasoning models
          if (info.supportsReasoning) {
            (chatInfo as any).configurationSchema = {
              properties: {
                reasoningEffort: {
                  type: 'string',
                  enum: info.reasoningOptions || ['off', 'low', 'medium', 'high'],
                  default: info.reasoningDefault || 'medium',
                  description: 'Controls reasoning depth. Higher = more thorough but slower.',
                },
              },
            };
          }

          allModels.push(chatInfo);
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

  private extractModelInfo(model: LMStudioApiModel): LocalModelInfo {
    const info: LocalModelInfo = {
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
      const openaiMessages = this.convertMessages(messages);

      // Build request body
      const requestBody: any = {
        model: modelId,
        messages: openaiMessages,
        stream: true,
      };

      // Apply modelOptions
      if (options.modelOptions) {
        for (const [key, value] of Object.entries(options.modelOptions)) {
          if (value !== undefined && value !== null) {
            if (key === 'temperature') {
              requestBody.temperature = value;
            } else if (key === 'max_tokens') {
              requestBody.max_tokens = value;
            } else if (key === 'top_p') {
              requestBody.top_p = value;
            } else if (key === 'reasoningEffort') {
              if (!requestBody.extra_body) requestBody.extra_body = {};
              requestBody.extra_body.reasoning = { level: value };
            } else {
              requestBody[key] = value;
            }
          }
        }
      }

      // Defaults
      if (requestBody.temperature === undefined) requestBody.temperature = 0.7;
      if (requestBody.max_tokens === undefined) requestBody.max_tokens = 4096;

      // Auto-enable reasoning if model supports it
      if (modelInfo?.supportsReasoning && !requestBody.extra_body?.reasoning) {
        const level = modelInfo.reasoningDefault || 'medium';
        if (!requestBody.extra_body) requestBody.extra_body = {};
        requestBody.extra_body.reasoning = { level };
      }

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

      // Stream SSE response
      await this.streamSSE(response.body, progress);

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.outputChannel.appendLine(`[LMStudioProvider] ERROR: ${errorMessage}`);
      throw err;
    }
  }

  /**
   * Stream SSE response from OpenAI-compatible endpoint.
   * Emits text incrementally, handles reasoning_content and tool_calls.
   */
  private async streamSSE(
    body: ReadableStream<Uint8Array>,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>
  ): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
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

              // reasoning_content comes as separate field in some models (DeepSeek R1)
              if (delta?.reasoning_content) {
                progress.report(new vscode.LanguageModelTextPart(delta.reasoning_content));
              }

              // Regular content - emit directly, VS Code handles thinking tags
              if (delta?.content) {
                progress.report(new vscode.LanguageModelTextPart(delta.content));
              }

              // Tool calls
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

              // Finish - emit accumulated tool calls
              if (data.choices?.[0]?.finish_reason) {
                for (const [, buf] of toolCallBuffers) {
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
}
