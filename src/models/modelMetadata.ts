import { ZenModelDefinition } from '../client/types';

const ZEN_BASE_URL = 'https://opencode.ai/zen/v1';

function openaiCompatible(id: string, displayName: string, family: string, contextInput: number, contextOutput: number, pricing: { input: number; output: number }, caps: Partial<ZenModelDefinition['capabilities']> = {}): ZenModelDefinition {
  return {
    id,
    displayName,
    family,
    provider: 'opencode',
    endpoint: `${ZEN_BASE_URL}/chat/completions`,
    apiFormat: 'openai-compatible',
    status: 'active',
    capabilities: {
      reasoning: caps.reasoning ?? false,
      toolCalling: caps.toolCalling ?? false,
      imageInput: caps.imageInput ?? false,
      streaming: true,
      structuredOutput: caps.structuredOutput ?? false,
    },
    context: { input: contextInput, output: contextOutput },
    pricing,
    tags: [
      ...(pricing.input === 0 ? ['free'] : []),
      ...(caps.reasoning ? ['reasoning'] : []),
      ...(caps.toolCalling ? ['tools'] : []),
      ...(caps.imageInput ? ['vision'] : []),
    ],
  };
}

function anthropicCompatible(id: string, displayName: string, family: string, contextInput: number, contextOutput: number, pricing: { input: number; output: number }, caps: Partial<ZenModelDefinition['capabilities']> = {}): ZenModelDefinition {
  return {
    id,
    displayName,
    family,
    provider: 'opencode',
    endpoint: `${ZEN_BASE_URL}/messages`,
    apiFormat: 'anthropic',
    status: 'active',
    capabilities: {
      reasoning: caps.reasoning ?? false,
      toolCalling: caps.toolCalling ?? true,
      imageInput: caps.imageInput ?? true,
      streaming: true,
      structuredOutput: caps.structuredOutput ?? false,
    },
    context: { input: contextInput, output: contextOutput },
    pricing,
    tags: [
      ...(pricing.input === 0 ? ['free'] : []),
      ...(caps.reasoning ? ['reasoning'] : []),
      ...(caps.toolCalling !== false ? ['tools'] : []),
      ...(caps.imageInput !== false ? ['vision'] : []),
    ],
  };
}

export const BUILTIN_MODELS: ZenModelDefinition[] = [
  // ═══════════════════════════════════════════════════════════
  // FREE MODELS
  // ═══════════════════════════════════════════════════════════
  openaiCompatible('deepseek-v4-flash-free', 'DeepSeek V4 Flash Free', 'deepseek', 131072, 131072, { input: 0, output: 0 }, { reasoning: true, toolCalling: true }),
  openaiCompatible('mimo-v2.5-free', 'MiMo-V2.5 Free', 'mimo', 131072, 131072, { input: 0, output: 0 }, { reasoning: true, toolCalling: true }),
  openaiCompatible('nemotron-3-super-free', 'Nemotron 3 Super Free', 'nemotron', 131072, 131072, { input: 0, output: 0 }, { reasoning: true, toolCalling: true }),
  openaiCompatible('big-pickle', 'Big Pickle', 'big-pickle', 131072, 131072, { input: 0, output: 0 }, { reasoning: true, toolCalling: true }),

  // ═══════════════════════════════════════════════════════════
  // OPENAI GPT MODELS
  // ═══════════════════════════════════════════════════════════
  openaiCompatible('gpt-5.5', 'GPT 5.5', 'gpt', 272000, 32000, { input: 5.0, output: 30.0 }, { reasoning: true, toolCalling: true, imageInput: true }),
  openaiCompatible('gpt-5.5-pro', 'GPT 5.5 Pro', 'gpt', 272000, 32000, { input: 30.0, output: 180.0 }, { reasoning: true, toolCalling: true, imageInput: true }),
  openaiCompatible('gpt-5.4', 'GPT 5.4', 'gpt', 272000, 32000, { input: 2.5, output: 15.0 }, { reasoning: true, toolCalling: true, imageInput: true }),
  openaiCompatible('gpt-5.4-pro', 'GPT 5.4 Pro', 'gpt', 272000, 32000, { input: 30.0, output: 180.0 }, { reasoning: true, toolCalling: true, imageInput: true }),
  openaiCompatible('gpt-5.4-mini', 'GPT 5.4 Mini', 'gpt', 272000, 32000, { input: 0.75, output: 4.5 }, { reasoning: true, toolCalling: true, imageInput: true }),
  openaiCompatible('gpt-5.4-nano', 'GPT 5.4 Nano', 'gpt', 272000, 32000, { input: 0.20, output: 1.25 }, { reasoning: true, toolCalling: true }),
  openaiCompatible('gpt-5.3-codex', 'GPT 5.3 Codex', 'gpt', 272000, 32000, { input: 1.75, output: 14.0 }, { reasoning: true, toolCalling: true }),
  openaiCompatible('gpt-5.3-codex-spark', 'GPT 5.3 Codex Spark', 'gpt', 272000, 32000, { input: 1.75, output: 14.0 }, { reasoning: true, toolCalling: true }),
  openaiCompatible('gpt-5.2', 'GPT 5.2', 'gpt', 272000, 32000, { input: 1.75, output: 14.0 }, { reasoning: true, toolCalling: true, imageInput: true }),
  openaiCompatible('gpt-5.1', 'GPT 5.1', 'gpt', 272000, 32000, { input: 1.07, output: 8.5 }, { reasoning: true, toolCalling: true, imageInput: true }),
  openaiCompatible('gpt-5.1-codex', 'GPT 5.1 Codex', 'gpt', 272000, 32000, { input: 1.07, output: 8.5 }, { reasoning: true, toolCalling: true }),
  openaiCompatible('gpt-5.1-codex-max', 'GPT 5.1 Codex Max', 'gpt', 272000, 32000, { input: 1.25, output: 10.0 }, { reasoning: true, toolCalling: true }),
  openaiCompatible('gpt-5.1-codex-mini', 'GPT 5.1 Codex Mini', 'gpt', 272000, 32000, { input: 0.25, output: 2.0 }, { reasoning: true, toolCalling: true }),
  openaiCompatible('gpt-5', 'GPT 5', 'gpt', 272000, 32000, { input: 1.07, output: 8.5 }, { reasoning: true, toolCalling: true, imageInput: true }),
  openaiCompatible('gpt-5-codex', 'GPT 5 Codex', 'gpt', 272000, 32000, { input: 1.07, output: 8.5 }, { reasoning: true, toolCalling: true }),
  openaiCompatible('gpt-5-nano', 'GPT 5 Nano', 'gpt', 272000, 32000, { input: 0.05, output: 0.4 }, { reasoning: true, toolCalling: true }),

  // ═══════════════════════════════════════════════════════════
  // ANTHROPIC CLAUDE MODELS
  // ═══════════════════════════════════════════════════════════
  anthropicCompatible('claude-opus-4-8', 'Claude Opus 4.8', 'claude', 200000, 32000, { input: 5.0, output: 25.0 }, { reasoning: true }),
  anthropicCompatible('claude-opus-4-7', 'Claude Opus 4.7', 'claude', 200000, 32000, { input: 5.0, output: 25.0 }, { reasoning: true }),
  anthropicCompatible('claude-opus-4-6', 'Claude Opus 4.6', 'claude', 200000, 32000, { input: 5.0, output: 25.0 }, { reasoning: true }),
  anthropicCompatible('claude-opus-4-5', 'Claude Opus 4.5', 'claude', 200000, 32000, { input: 5.0, output: 25.0 }, { reasoning: true }),
  anthropicCompatible('claude-opus-4-1', 'Claude Opus 4.1', 'claude', 200000, 32000, { input: 15.0, output: 75.0 }, { reasoning: true }),
  anthropicCompatible('claude-sonnet-4-6', 'Claude Sonnet 4.6', 'claude', 200000, 32000, { input: 3.0, output: 15.0 }, { reasoning: true }),
  anthropicCompatible('claude-sonnet-4-5', 'Claude Sonnet 4.5', 'claude', 200000, 32000, { input: 3.0, output: 15.0 }, { reasoning: true }),
  anthropicCompatible('claude-sonnet-4', 'Claude Sonnet 4', 'claude', 200000, 32000, { input: 3.0, output: 15.0 }, { reasoning: true }),
  anthropicCompatible('claude-haiku-4-5', 'Claude Haiku 4.5', 'claude', 200000, 32000, { input: 1.0, output: 5.0 }, { reasoning: true }),
  anthropicCompatible('claude-3-5-haiku', 'Claude Haiku 3.5', 'claude', 200000, 32000, { input: 0.8, output: 4.0 }, { reasoning: true }),

  // ═══════════════════════════════════════════════════════════
  // GOOGLE GEMINI MODELS
  // ═══════════════════════════════════════════════════════════
  openaiCompatible('gemini-3.5-flash', 'Gemini 3.5 Flash', 'gemini', 1000000, 32000, { input: 1.5, output: 9.0 }, { reasoning: true, toolCalling: true, imageInput: true }),
  openaiCompatible('gemini-3.1-pro', 'Gemini 3.1 Pro', 'gemini', 1000000, 32000, { input: 2.0, output: 12.0 }, { reasoning: true, toolCalling: true, imageInput: true }),
  openaiCompatible('gemini-3-flash', 'Gemini 3 Flash', 'gemini', 1000000, 32000, { input: 0.5, output: 3.0 }, { reasoning: true, toolCalling: true, imageInput: true }),

  // ═══════════════════════════════════════════════════════════
  // QWEN MODELS
  // ═══════════════════════════════════════════════════════════
  anthropicCompatible('qwen3.7-max', 'Qwen3.7 Max', 'qwen', 131072, 32000, { input: 2.5, output: 7.5 }, { reasoning: true }),
  anthropicCompatible('qwen3.6-plus', 'Qwen3.6 Plus', 'qwen', 131072, 32000, { input: 0.5, output: 3.0 }, { reasoning: true }),
  anthropicCompatible('qwen3.5-plus', 'Qwen3.5 Plus', 'qwen', 131072, 32000, { input: 0.2, output: 1.2 }, { reasoning: true }),

  // ═══════════════════════════════════════════════════════════
  // OTHER MODELS
  // ═══════════════════════════════════════════════════════════
  openaiCompatible('deepseek-v4-flash', 'DeepSeek V4 Flash', 'deepseek', 131072, 131072, { input: 0.14, output: 0.28 }, { reasoning: true, toolCalling: true }),
  openaiCompatible('minimax-m2.7', 'MiniMax M2.7', 'minimax', 204800, 131072, { input: 0.3, output: 1.2 }, { reasoning: true, toolCalling: true }),
  openaiCompatible('minimax-m2.5', 'MiniMax M2.5', 'minimax', 204800, 131072, { input: 0.3, output: 1.2 }, { reasoning: true, toolCalling: true }),
  openaiCompatible('glm-5.1', 'GLM 5.1', 'glm', 131072, 32000, { input: 1.4, output: 4.4 }, { reasoning: true, toolCalling: true }),
  openaiCompatible('glm-5', 'GLM 5', 'glm', 131072, 32000, { input: 1.0, output: 3.2 }, { reasoning: true, toolCalling: true }),
  openaiCompatible('kimi-k2.5', 'Kimi K2.5', 'kimi', 131072, 32000, { input: 0.6, output: 3.0 }, { reasoning: true, toolCalling: true }),
  openaiCompatible('kimi-k2.6', 'Kimi K2.6', 'kimi', 131072, 32000, { input: 0.95, output: 4.0 }, { reasoning: true, toolCalling: true }),
  openaiCompatible('grok-build-0.1', 'Grok Build 0.1', 'grok', 131072, 32000, { input: 1.0, output: 2.0 }, { reasoning: true, toolCalling: true }),
];
