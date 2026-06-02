// src/client/modelRegistry.ts
// Central registry mapping OpenCode model IDs to API format, endpoint, token limits, and capabilities.
// Single source of truth for all model metadata.

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
}

export interface ModelRegistration extends ModelEndpoint, ModelCapabilities {
  id: string;
}

interface RegistryEntry {
  chatEndpoint: string;
  apiFormat: ApiFormat;
  name: string;
  family: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  imageInput: boolean;
  toolCalling: boolean;
  reasoning: boolean;
}

const DEFAULT_INPUT = 128000;
const DEFAULT_OUTPUT = 32000;

function gpt(name: string): RegistryEntry {
  return {
    chatEndpoint: '/responses',
    apiFormat: 'openai',
    name,
    family: 'openai',
    maxInputTokens: DEFAULT_INPUT,
    maxOutputTokens: DEFAULT_OUTPUT,
    imageInput: true,
    toolCalling: true,
    reasoning: true,
  };
}

function claude(name: string): RegistryEntry {
  return {
    chatEndpoint: '/messages',
    apiFormat: 'anthropic',
    name,
    family: 'anthropic',
    maxInputTokens: DEFAULT_INPUT,
    maxOutputTokens: DEFAULT_OUTPUT,
    imageInput: true,
    toolCalling: true,
    reasoning: true,
  };
}

function gemini(name: string): RegistryEntry {
  return {
    chatEndpoint: '/models/{id}',
    apiFormat: 'google',
    name,
    family: 'google',
    maxInputTokens: DEFAULT_INPUT,
    maxOutputTokens: DEFAULT_OUTPUT,
    imageInput: true,
    toolCalling: true,
    reasoning: true,
  };
}

function openaiCompat(
  name: string,
  family: string,
  overrides?: Partial<Pick<RegistryEntry, 'toolCalling' | 'reasoning' | 'imageInput' | 'maxInputTokens' | 'maxOutputTokens'>>
): RegistryEntry {
  return {
    chatEndpoint: '/chat/completions',
    apiFormat: 'openai-compatible',
    name,
    family,
    maxInputTokens: overrides?.maxInputTokens ?? DEFAULT_INPUT,
    maxOutputTokens: overrides?.maxOutputTokens ?? DEFAULT_OUTPUT,
    imageInput: overrides?.imageInput ?? false,
    toolCalling: overrides?.toolCalling ?? true,
    reasoning: overrides?.reasoning ?? false,
  };
}

function anthropicCompat(
  name: string,
  family: string,
  overrides?: Partial<Pick<RegistryEntry, 'toolCalling' | 'reasoning' | 'imageInput' | 'maxInputTokens' | 'maxOutputTokens'>>
): RegistryEntry {
  return {
    chatEndpoint: '/messages',
    apiFormat: 'anthropic',
    name,
    family,
    maxInputTokens: overrides?.maxInputTokens ?? DEFAULT_INPUT,
    maxOutputTokens: overrides?.maxOutputTokens ?? DEFAULT_OUTPUT,
    imageInput: overrides?.imageInput ?? false,
    toolCalling: overrides?.toolCalling ?? true,
    reasoning: overrides?.reasoning ?? false,
  };
}

// Zen models
const zenModels: Record<string, RegistryEntry> = {
  // GPT models → openai + /responses
  'gpt-5.5': gpt('GPT-5.5'),
  'gpt-5.5-pro': gpt('GPT-5.5 Pro'),
  'gpt-5.4': gpt('GPT-5.4'),
  'gpt-5.4-pro': gpt('GPT-5.4 Pro'),
  'gpt-5.4-mini': gpt('GPT-5.4 Mini'),
  'gpt-5.4-nano': gpt('GPT-5.4 Nano'),
  'gpt-5.3-codex': gpt('GPT-5.3 Codex'),
  'gpt-5.3-codex-spark': gpt('GPT-5.3 Codex Spark'),
  'gpt-5.2': gpt('GPT-5.2'),
  'gpt-5.2-codex': gpt('GPT-5.2 Codex'),
  'gpt-5.1': gpt('GPT-5.1'),
  'gpt-5.1-codex': gpt('GPT-5.1 Codex'),
  'gpt-5.1-codex-max': gpt('GPT-5.1 Codex Max'),
  'gpt-5.1-codex-mini': gpt('GPT-5.1 Codex Mini'),
  'gpt-5': gpt('GPT-5'),
  'gpt-5-codex': gpt('GPT-5 Codex'),
  'gpt-5-nano': gpt('GPT-5 Nano'),

  // Claude models → anthropic + /messages
  'claude-opus-4-8': claude('Claude Opus 4.8'),
  'claude-opus-4-7': claude('Claude Opus 4.7'),
  'claude-opus-4-6': claude('Claude Opus 4.6'),
  'claude-opus-4-5': claude('Claude Opus 4.5'),
  'claude-opus-4-1': claude('Claude Opus 4.1'),
  'claude-sonnet-4-6': claude('Claude Sonnet 4.6'),
  'claude-sonnet-4-5': claude('Claude Sonnet 4.5'),
  'claude-sonnet-4': claude('Claude Sonnet 4'),
  'claude-haiku-4-5': claude('Claude Haiku 4.5'),
  'claude-3-5-haiku': claude('Claude 3.5 Haiku'),

  // Gemini models → google + /models/{id}
  'gemini-3.5-flash': gemini('Gemini 3.5 Flash'),
  'gemini-3.1-pro': gemini('Gemini 3.1 Pro'),
  'gemini-3-flash': gemini('Gemini 3 Flash'),

  // OpenAI-compatible models → openai-compatible + /chat/completions
  'kimi-k2.6': openaiCompat('Kimi K2.6', 'kimi'),
  'kimi-k2.5': openaiCompat('Kimi K2.5', 'kimi'),
  'deepseek-v4-flash': openaiCompat('DeepSeek V4 Flash', 'deepseek', { reasoning: true }),
  'glm-5.1': openaiCompat('GLM 5.1', 'glm'),
  'glm-5': openaiCompat('GLM 5', 'glm'),
  'minimax-m2.7': openaiCompat('MiniMax M2.7', 'minimax'),
  'minimax-m2.5': openaiCompat('MiniMax M2.5', 'minimax'),
  'grok-build-0.1': openaiCompat('Grok Build 0.1', 'grok'),
  'big-pickle': openaiCompat('Big Pickle', 'bigpickle'),
  'mimo-v2.5-free': openaiCompat('MiMo V2.5 Free', 'mimo', { toolCalling: false }),
  'nemotron-3-super-free': openaiCompat('Nemotron 3 Super Free', 'nvidia', { toolCalling: false }),
  'deepseek-v4-flash-free': openaiCompat('DeepSeek V4 Flash Free', 'deepseek', { reasoning: true }),
  'qwen3.7-max': openaiCompat('Qwen 3.7 Max', 'qwen'),
  'qwen3.6-plus': openaiCompat('Qwen 3.6 Plus', 'qwen'),
  'qwen3.5-plus': openaiCompat('Qwen 3.5 Plus', 'qwen'),
};

// Go models
const goModels: Record<string, RegistryEntry> = {
  // OpenAI-compatible → /chat/completions
  'kimi-k2.6': openaiCompat('Kimi K2.6', 'kimi'),
  'kimi-k2.5': openaiCompat('Kimi K2.5', 'kimi'),
  'deepseek-v4-pro': openaiCompat('DeepSeek V4 Pro', 'deepseek', { reasoning: true }),
  'deepseek-v4-flash': openaiCompat('DeepSeek V4 Flash', 'deepseek', { reasoning: true }),
  'glm-5.1': openaiCompat('GLM 5.1', 'glm'),
  'glm-5': openaiCompat('GLM 5', 'glm'),
  'mimo-v2.5': openaiCompat('MiMo V2.5', 'mimo'),
  'mimo-v2.5-pro': openaiCompat('MiMo V2.5 Pro', 'mimo'),

  // Anthropic-compatible → /messages
  'minimax-m3': anthropicCompat('MiniMax M3', 'minimax'),
  'minimax-m2.7': anthropicCompat('MiniMax M2.7', 'minimax'),
  'minimax-m2.5': anthropicCompat('MiniMax M2.5', 'minimax'),
  'qwen3.7-max': anthropicCompat('Qwen 3.7 Max', 'qwen'),
  'qwen3.6-plus': anthropicCompat('Qwen 3.6 Plus', 'qwen'),
};

// Free models (subset of Zen free-tier models)
const freeModels: Record<string, RegistryEntry> = {
  'mimo-v2.5-free': openaiCompat('MiMo V2.5 Free', 'mimo', { toolCalling: false }),
  'nemotron-3-super-free': openaiCompat('Nemotron 3 Super Free', 'nvidia', { toolCalling: false }),
  'deepseek-v4-flash-free': openaiCompat('DeepSeek V4 Flash Free', 'deepseek', { reasoning: true }),
  'big-pickle': openaiCompat('Big Pickle', 'bigpickle'),
};

function getRegistry(provider: Provider): Record<string, RegistryEntry> {
  switch (provider) {
    case 'zen':
      return zenModels;
    case 'go':
      return goModels;
    case 'free':
      return freeModels;
  }
}

export function getModelEndpoint(provider: Provider, modelId: string): ModelEndpoint {
  const registry = getRegistry(provider);
  const entry = registry[modelId];
  if (!entry) {
    // Fallback for unknown models: assume openai-compatible /chat/completions
    return { chatEndpoint: '/chat/completions', apiFormat: 'openai-compatible' };
  }
  return { chatEndpoint: entry.chatEndpoint, apiFormat: entry.apiFormat };
}

export function getModelCapabilities(modelId: string): ModelCapabilities {
  // Search all providers for the first matching entry
  for (const registry of [zenModels, goModels, freeModels]) {
    const entry = registry[modelId];
    if (entry) {
      return {
        name: entry.name,
        family: entry.family,
        maxInputTokens: entry.maxInputTokens,
        maxOutputTokens: entry.maxOutputTokens,
        imageInput: entry.imageInput,
        toolCalling: entry.toolCalling,
        reasoning: entry.reasoning,
      };
    }
  }
  // Fallback for unknown models
  return {
    name: modelId,
    family: modelId.split('-')[0],
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
