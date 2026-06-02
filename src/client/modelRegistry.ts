// src/client/modelRegistry.ts
// Fetches model capabilities from models.dev API and maps them to OpenCode providers.
// Falls back to static data if the API is unavailable.

export type ApiFormat = 'openai' | 'openai-compatible' | 'anthropic' | 'google';
export type Provider = 'zen' | 'go' | 'free';

export interface ModelEndpoint {
  chatEndpoint: string;
  apiFormat: ApiFormat;
}

export interface ModelCapabilities {
  name: string;
  family: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  imageInput: boolean;
  toolCalling: boolean;
  reasoning: boolean;
  thinkingEffort?: 'low' | 'medium' | 'high';
  pricePerMillionInput?: number;
  pricePerMillionOutput?: number;
  pricePerMillionCacheRead?: number;
}

export interface ModelRegistration extends ModelEndpoint, ModelCapabilities {
  id: string;
}

export interface RegistryEntry {
  chatEndpoint: string;
  apiFormat: ApiFormat;
  npmPackage: string;  // @ai-sdk/anthropic, @ai-sdk/openai, etc.
  name: string;
  family: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  imageInput: boolean;
  toolCalling: boolean;
  reasoning: boolean;
  thinkingEffort?: 'low' | 'medium' | 'high';
  pricePerMillionInput?: number;
  pricePerMillionOutput?: number;
  pricePerMillionCacheRead?: number;
}

// ── Static fallback data (minimal, used when models.dev is unreachable) ──

const DEFAULT_INPUT = 128000;
const DEFAULT_OUTPUT = 32000;

// Map from model ID prefix → API format (used for fallback)
const FORMAT_HINTS: Record<string, { endpoint: string; apiFormat: ApiFormat }> = {
  'gpt-5':       { endpoint: '/responses', apiFormat: 'openai' },
  'gpt-4o':      { endpoint: '/responses', apiFormat: 'openai' },
  'claude-':     { endpoint: '/messages',  apiFormat: 'anthropic' },
  'gemini-':     { endpoint: '/models/{id}', apiFormat: 'google' },
};

function inferApiFormat(modelId: string): { endpoint: string; apiFormat: ApiFormat } {
  for (const [prefix, fmt] of Object.entries(FORMAT_HINTS)) {
    if (modelId.startsWith(prefix)) return fmt;
  }
  return { endpoint: '/chat/completions', apiFormat: 'openai-compatible' };
}

function inferFamily(modelId: string): string {
  const lower = modelId.toLowerCase();
  if (lower.includes('gpt'))     return 'openai';
  if (lower.includes('claude'))  return 'anthropic';
  if (lower.includes('gemini'))  return 'google';
  if (lower.includes('deepseek')) return 'deepseek';
  if (lower.includes('kimi'))    return 'kimi';
  if (lower.includes('glm'))     return 'glm';
  if (lower.includes('minimax')) return 'minimax';
  if (lower.includes('qwen'))    return 'qwen';
  if (lower.includes('mimo'))    return 'mimo';
  if (lower.includes('grok'))    return 'grok';
  if (lower.includes('nemotron')) return 'nvidia';
  return modelId.split('-')[0];
}

// ── models.dev API types ──

interface ModelsDevModel {
  id: string;
  name: string;
  family?: string;
  attachment?: boolean;
  reasoning?: boolean;
  tool_call?: boolean;
  temperature?: boolean;
  interleaved?: boolean | { field: string };
  limit?: { context?: number; output?: number; input?: number };
  cost?: { input?: number; output?: number; cache_read?: number; cache_write?: number };
  modalities?: { input?: string[]; output?: string[] };
  status?: string;
  structured_output?: boolean;
}

interface ModelsDevProvider {
  id: string;
  name: string;
  models: Record<string, ModelsDevModel>;
}

// ── Live registry (populated from models.dev) ──

let liveRegistry: Map<string, RegistryEntry> = new Map();
let lastFetch = 0;
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

async function fetchModelsDev(): Promise<void> {
  if (Date.now() - lastFetch < CACHE_TTL && liveRegistry.size > 0) return;

  try {
    const response = await fetch('https://models.dev/api.json', {
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return;

    const data = await response.json() as Record<string, ModelsDevProvider>;
    const opencode = data['opencode'];
    const opencodeGo = data['opencode-go'];

    liveRegistry.clear();

    // Index Zen models
    if (opencode?.models) {
      for (const [id, model] of Object.entries(opencode.models)) {
        liveRegistry.set(`zen:${id}`, modelsDevToRegistry(id, model));
      }
    }

    // Index Go models
    if (opencodeGo?.models) {
      for (const [id, model] of Object.entries(opencodeGo.models)) {
        liveRegistry.set(`go:${id}`, modelsDevToRegistry(id, model));
      }
    }

    lastFetch = Date.now();
  } catch {
    // Fallback to static data on network error
  }
}

function modelsDevToRegistry(id: string, model: ModelsDevModel): RegistryEntry {
  const fmt = inferApiFormat(id);

  // Vision = modalities.input includes "image" OR "pdf"
  const hasVision = model.modalities?.input?.some(m => m === 'image' || m === 'pdf') ?? false;

  return {
    chatEndpoint: fmt.endpoint,
    apiFormat: fmt.apiFormat,
    name: model.name || id,
    family: inferFamily(id),
    maxInputTokens: model.limit?.context ?? DEFAULT_INPUT,
    maxOutputTokens: model.limit?.output ?? DEFAULT_OUTPUT,
    imageInput: model.attachment ?? hasVision,  // Use attachment OR modalities
    toolCalling: model.tool_call ?? true,
    reasoning: model.reasoning ?? false,
    thinkingEffort: model.reasoning ? 'high' : undefined,
    // Cost is already in $/M tokens from models.dev
    pricePerMillionInput: model.cost?.input,
    pricePerMillionOutput: model.cost?.output,
    pricePerMillionCacheRead: model.cost?.cache_read,
  };
}

// ── Public API ──

export async function initModelRegistry(): Promise<void> {
  await fetchModelsDev();
}

export function getModelEndpoint(provider: Provider, modelId: string): ModelEndpoint {
  const entry = liveRegistry.get(`${provider}:${modelId}`);
  if (entry) {
    return { chatEndpoint: entry.chatEndpoint, apiFormat: entry.apiFormat };
  }
  // Fallback: infer from model ID
  return inferApiFormat(modelId);
}

export function getModelCapabilities(modelId: string): ModelCapabilities {
  // Search all providers for the first matching entry
  for (const provider of ['zen', 'go', 'free'] as Provider[]) {
    const entry = liveRegistry.get(`${provider}:${modelId}`);
    if (entry) {
      return {
        name: entry.name,
        family: entry.family,
        maxInputTokens: entry.maxInputTokens,
        maxOutputTokens: entry.maxOutputTokens,
        imageInput: entry.imageInput,
        toolCalling: entry.toolCalling,
        reasoning: entry.reasoning,
        thinkingEffort: entry.thinkingEffort,
        pricePerMillionInput: entry.pricePerMillionInput,
        pricePerMillionOutput: entry.pricePerMillionOutput,
        pricePerMillionCacheRead: entry.pricePerMillionCacheRead,
      };
    }
  }

  // Try partial match (e.g., "opencode/deepseek-v4-flash" → "deepseek-v4-flash")
  const slashIndex = modelId.lastIndexOf('/');
  if (slashIndex >= 0) {
    const shortId = modelId.slice(slashIndex + 1);
    const result = getModelCapabilities(shortId);
    if (result.name !== shortId) return result;
  }

  // Fallback for unknown models
  return {
    name: modelId,
    family: inferFamily(modelId),
    maxInputTokens: DEFAULT_INPUT,
    maxOutputTokens: DEFAULT_OUTPUT,
    imageInput: false,
    toolCalling: true,
    reasoning: false,
  };
}

export function getModelRegistration(provider: Provider, modelId: string): ModelRegistration {
  const endpoint = getModelEndpoint(provider, modelId);
  const caps = getModelCapabilities(modelId);
  return { id: modelId, ...endpoint, ...caps };
}

export function isModelDeprecated(modelId: string): boolean {
  for (const provider of ['zen', 'go', 'free'] as Provider[]) {
    const entry = liveRegistry.get(`${provider}:${modelId}`);
    if (entry) return false; // If we have it in registry, it's active
  }
  return false;
}

export function getRegistrySize(): { zen: number; go: number; total: number } {
  let zen = 0, go = 0;
  for (const key of liveRegistry.keys()) {
    if (key.startsWith('zen:')) zen++;
    else if (key.startsWith('go:')) go++;
  }
  return { zen, go, total: zen + go };
}
