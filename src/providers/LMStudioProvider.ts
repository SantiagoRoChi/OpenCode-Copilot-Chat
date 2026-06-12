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
}
