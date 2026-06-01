import * as vscode from 'vscode';
import { ZenModelDefinition, ModelsDevResponse, ZenModelsResponse } from '../client/types';
import { BUILTIN_MODELS } from './modelMetadata';

const MODELS_DEV_URL = 'https://models.dev/api.json';
const ZEN_MODELS_URL = 'https://opencode.ai/zen/v1/models';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export class ModelRegistry {
  private models: ZenModelDefinition[] = [...BUILTIN_MODELS];
  private lastFetch = 0;
  private fetchInFlight?: Promise<void>;
  private outputChannel: vscode.OutputChannel;

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
  }

  getModels(): ZenModelDefinition[] {
    return this.models.filter(m => m.status === 'active');
  }

  getModel(id: string): ZenModelDefinition | undefined {
    return this.models.find(m => m.id === id && m.status === 'active');
  }

  async refresh(apiKey?: string): Promise<void> {
    const now = Date.now();
    if (now - this.lastFetch < CACHE_TTL_MS && this.models.length > BUILTIN_MODELS.length) {
      return;
    }
    if (this.fetchInFlight) {
      return;
    }

    this.fetchInFlight = this.doRefresh(apiKey);
    this.fetchInFlight.then(() => {
      this.fetchInFlight = undefined;
    }).catch(() => {
      this.fetchInFlight = undefined;
    });
  }

  private async doRefresh(apiKey?: string): Promise<void> {
    this.outputChannel.appendLine('Refreshing model catalog...');

    try {
      const devModels = await this.fetchModelsDev();
      this.mergeModelsDev(devModels);
    } catch (err) {
      this.outputChannel.appendLine(`Failed to fetch models.dev: ${err}`);
    }

    if (apiKey) {
      try {
        const zenModels = await this.fetchZenModels(apiKey);
        this.mergeZenModels(zenModels);
      } catch (err) {
        this.outputChannel.appendLine(`Failed to fetch Zen models: ${err}`);
      }
    }

    this.lastFetch = Date.now();
    const activeCount = this.models.filter(m => m.status === 'active').length;
    this.outputChannel.appendLine(`Model catalog refreshed: ${activeCount} active models`);
  }

  private async fetchModelsDev(): Promise<ModelsDevResponse> {
    this.outputChannel.appendLine('Fetching models.dev...');
    const response = await fetch(MODELS_DEV_URL, {
      signal: AbortSignal.timeout(15000),
    });
    this.outputChannel.appendLine(`models.dev response: ${response.status}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json() as Promise<ModelsDevResponse>;
    this.outputChannel.appendLine('models.dev parsed OK');
    return data;
  }

  private async fetchZenModels(apiKey: string): Promise<ZenModelsResponse> {
    this.outputChannel.appendLine('Fetching Zen models...');
    const response = await fetch(ZEN_MODELS_URL, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15000),
    });
    this.outputChannel.appendLine(`Zen models response: ${response.status}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json() as Promise<ZenModelsResponse>;
    this.outputChannel.appendLine('Zen models parsed OK');
    return data;
  }

  private mergeModelsDev(catalog: ModelsDevResponse): void {
    const opencodeProvider = catalog['opencode'];
    if (!opencodeProvider?.models) {
      return;
    }

    for (const [modelId, devModel] of Object.entries(opencodeProvider.models)) {
      if (devModel.status === 'deprecated') {
        const existing = this.models.find(m => m.id === modelId);
        if (existing) {
          existing.status = 'deprecated';
        }
        continue;
      }

      const existing = this.models.find(m => m.id === modelId);
      if (existing) {
        if (devModel.limit) {
          existing.context.input = devModel.limit.context;
          existing.context.output = devModel.limit.output;
        }
        if (devModel.cost) {
          existing.pricing.input = devModel.cost.input;
          existing.pricing.output = devModel.cost.output;
          if (devModel.cost.cache_read !== undefined) {
            existing.pricing.cachedRead = devModel.cost.cache_read;
          }
        }
        if (devModel.reasoning !== undefined) {
          existing.capabilities.reasoning = devModel.reasoning;
        }
        if (devModel.tool_call !== undefined) {
          existing.capabilities.toolCalling = devModel.tool_call;
        }
        if (devModel.modalities?.input?.includes('image')) {
          existing.capabilities.imageInput = true;
        }
      } else {
        const isFree = devModel.cost?.input === 0 && devModel.cost?.output === 0;
        this.models.push({
          id: modelId,
          displayName: devModel.name || modelId,
          family: modelId.split('-')[0],
          provider: 'opencode',
          endpoint: `${ZEN_MODELS_URL.replace('/models', '/chat/completions')}`,
          apiFormat: 'openai-compatible',
          status: 'active',
          capabilities: {
            reasoning: devModel.reasoning ?? false,
            toolCalling: devModel.tool_call ?? false,
            imageInput: devModel.modalities?.input?.includes('image') ?? false,
            streaming: true,
            structuredOutput: false,
          },
          context: {
            input: devModel.limit?.context ?? 131072,
            output: devModel.limit?.output ?? 32000,
          },
          pricing: {
            input: devModel.cost?.input ?? 0,
            output: devModel.cost?.output ?? 0,
            cachedRead: devModel.cost?.cache_read,
          },
          tags: [
            ...(isFree ? ['free'] : []),
            ...(devModel.reasoning ? ['reasoning'] : []),
            ...(devModel.tool_call ? ['tools'] : []),
          ],
        });
      }
    }
  }

  private mergeZenModels(response: ZenModelsResponse): void {
    for (const zenModel of response.data) {
      const existing = this.models.find(m => m.id === zenModel.id);
      if (existing) {
        const context = zenModel.max_model_len ?? zenModel.context_length ?? zenModel.context_window;
        if (context) {
          existing.context.input = context;
        }
      }
    }
  }
}
