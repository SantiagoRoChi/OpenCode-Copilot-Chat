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
  supportedReasoningLevels?: string[];
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
  supportedReasoningLevels?: string[];
  pricePerMillionInput?: number;
  pricePerMillionOutput?: number;
  pricePerMillionCacheRead?: number;
}

// ── Static fallback data (minimal, used when models.dev is unreachable) ──

const DEFAULT_INPUT = 128000;
const DEFAULT_OUTPUT = 32000;

/**
 * Fallback data for core models to ensure functionality even if models.dev is offline.
 * This is populated during initModelRegistry if fetchModelsDev fails.
 */
const FALLBACK_MODELS: Record<string, ModelsDevModel> = {
  'zen:gpt-4o': {
    id: 'zen:gpt-4o',
    name: 'GPT-4o',
    family: 'openai',
    reasoning: false,
    tool_call: true,
    limit: { context: 128000, output: 4096 },
    cost: { input: 5.0, output: 15.0 }
  },
  'zen:claude-3-5-sonnet-latest': {
    id: 'zen:claude-3-5-sonnet-latest',
    name: 'Claude 3.5 Sonnet',
    family: 'anthropic',
    reasoning: false,
    tool_call: true,
    limit: { context: 200000, output: 4096 },
    cost: { input: 3.0, output: 15.0 }
  },
  'go:qwen-2.5-72b': {
    id: 'go:qwen-2.5-72b',
    name: 'Qwen 2.5 72B',
    family: 'qwen',
    reasoning: false,
    tool_call: true,
    limit: { context: 128000, output: 8192 },
    cost: { input: 2.0, output: 6.0 }
  }
};

// Provider-specific format hints (derived from https://opencode.ai/docs/zen/#endpoints and /go/#endpoints)
const ZEN_FORMAT_HINTS: Array<[string, { chatEndpoint: string; apiFormat: ApiFormat }]> = [
  ['gpt-',    { chatEndpoint: '/responses', apiFormat: 'openai' }],
  ['claude-', { chatEndpoint: '/messages',  apiFormat: 'anthropic' }],
  ['qwen',    { chatEndpoint: '/messages',  apiFormat: 'anthropic' }],
  // gemini-* uses a non-standard /models/{id} Google format — excluded from provider
];

const GO_FORMAT_HINTS: Array<[string, { chatEndpoint: string; apiFormat: ApiFormat }]> = [
  ['minimax-', { chatEndpoint: '/messages', apiFormat: 'anthropic' }],
  ['qwen',     { chatEndpoint: '/messages', apiFormat: 'anthropic' }],
];

function inferApiFormat(
  modelId: string,
  provider: 'zen' | 'go' = 'zen'
): { chatEndpoint: string; apiFormat: ApiFormat } {
  const hints = provider === 'go' ? GO_FORMAT_HINTS : ZEN_FORMAT_HINTS;
  for (const [prefix, fmt] of hints) {
    if (modelId.startsWith(prefix)) return fmt;
  }
  return { chatEndpoint: '/chat/completions', apiFormat: 'openai-compatible' };
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
let fetchInProgress = false;
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

async function fetchModelsDev(): Promise<void> {
  if (Date.now() - lastFetch < CACHE_TTL && liveRegistry.size > 0) return;
  if (fetchInProgress) return;
  fetchInProgress = true;

  try {
    const response = await fetch('https://models.dev/api.json', {
      signal: AbortSignal.timeout(15000),
    }) as unknown as Response;
    if (!response.ok) {
      console.warn(`[modelRegistry] models.dev returned ${response.status}`);
      return;
    }

    const data = await response.json() as Record<string, ModelsDevProvider>;
    const opencode = data['opencode'];
    const opencodeGo = data['opencode-go'];

    liveRegistry.clear();

    // Index Zen models
    if (opencode?.models) {
      for (const [id, model] of Object.entries(opencode.models)) {
        liveRegistry.set(`zen:${id}`, modelsDevToRegistry(id, model, 'zen'));
      }
    }

    // Index Go models
    if (opencodeGo?.models) {
      for (const [id, model] of Object.entries(opencodeGo.models)) {
        liveRegistry.set(`go:${id}`, modelsDevToRegistry(id, model, 'go'));
      }
    }

    lastFetch = Date.now();
    console.log(`[modelRegistry] Loaded ${liveRegistry.size} models from models.dev`);
  } catch (err) {
    console.warn(`[modelRegistry] Failed to fetch models.dev: ${err}`);
    // Fallback to static data on network error
    if (liveRegistry.size === 0) {
      for (const [id, model] of Object.entries(FALLBACK_MODELS)) {
        liveRegistry.set(id, modelsDevToRegistry(id, model, 'zen' /* or 'go' based on prefix */));
      }
      console.log(`[modelRegistry] Loaded fallback models.`);
    }
  } finally {
    fetchInProgress = false;
  }
}

function modelsDevToRegistry(id: string, model: ModelsDevModel, provider: 'zen' | 'go'): RegistryEntry {
  const fmt = inferApiFormat(id, provider);

  // Vision = modalities.input includes "image" OR "pdf"
  const hasVision = model.modalities?.input?.some(m => m === 'image' || m === 'pdf') ?? false;

  return {
    chatEndpoint: fmt.chatEndpoint,
    apiFormat: fmt.apiFormat,
    name: model.name || id,
    family: inferFamily(id),
    maxInputTokens: model.limit?.context ?? DEFAULT_INPUT,
    maxOutputTokens: model.limit?.output ?? DEFAULT_OUTPUT,
    imageInput: model.attachment ?? hasVision,  // Use attachment OR modalities
    toolCalling: model.tool_call ?? true,
    reasoning: model.reasoning ?? false,
    supportedReasoningLevels: model.reasoning ? ['low', 'medium', 'high'] : undefined,
    npmPackage: fmt.apiFormat === 'anthropic' ? '@ai-sdk/anthropic' :
                fmt.apiFormat === 'google' ? '@ai-sdk/google' :
                '@ai-sdk/openai',
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

/** Force a refresh of the model registry, ignoring cache TTL */
export async function refreshModelRegistry(): Promise<void> {
  lastFetch = 0;
  await fetchModelsDev();
}

/** Check if the model registry has been populated */
export function isModelRegistryPopulated(): boolean {
  return liveRegistry.size > 0;
}

export function getModelEndpoint(provider: Provider, modelId: string): ModelEndpoint {
  const entry = liveRegistry.get(`${provider}:${modelId}`);
  if (entry) {
    return { chatEndpoint: entry.chatEndpoint, apiFormat: entry.apiFormat };
  }
  // Fallback: infer from model ID using provider-aware hints
  const hint: 'zen' | 'go' = provider === 'go' ? 'go' : 'zen';
  return inferApiFormat(modelId, hint);
}

export function getModelCapabilities(modelId: string): ModelCapabilities {
  // 1. Exact match
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
        supportedReasoningLevels: entry.supportedReasoningLevels,
        pricePerMillionInput: entry.pricePerMillionInput,
        pricePerMillionOutput: entry.pricePerMillionOutput,
        pricePerMillionCacheRead: entry.pricePerMillionCacheRead,
      };
    }
  }

  // 2. Try partial match: strip vendor prefix (e.g. "opencode/deepseek-v4-flash" → "deepseek-v4-flash")
  const slashIndex = modelId.lastIndexOf('/');
  if (slashIndex >= 0) {
    const shortId = modelId.slice(slashIndex + 1);
    const result = getModelCapabilities(shortId);
    if (result.name !== shortId) return result;
  }

  // 3. Try fuzzy match: find any registry entry whose ID contains the modelId
  for (const provider of ['zen', 'go', 'free'] as Provider[]) {
    for (const [key, entry] of liveRegistry) {
      if (key.startsWith(`${provider}:`) && key.includes(modelId)) {
        return {
          name: entry.name,
          family: entry.family,
          maxInputTokens: entry.maxInputTokens,
          maxOutputTokens: entry.maxOutputTokens,
          imageInput: entry.imageInput,
          toolCalling: entry.toolCalling,
          reasoning: entry.reasoning,
          supportedReasoningLevels: entry.supportedReasoningLevels,
          pricePerMillionInput: entry.pricePerMillionInput,
          pricePerMillionOutput: entry.pricePerMillionOutput,
          pricePerMillionCacheRead: entry.pricePerMillionCacheRead,
        };
      }
    }
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


