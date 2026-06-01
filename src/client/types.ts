export interface ZenModelDefinition {
  id: string;
  displayName: string;
  family: string;
  provider: string;
  endpoint: string;
  apiFormat: 'openai-compatible' | 'anthropic' | 'google';
  status: 'active' | 'deprecated';
  capabilities: {
    reasoning: boolean;
    toolCalling: boolean;
    imageInput: boolean;
    streaming: boolean;
    structuredOutput: boolean;
  };
  context: {
    input: number;
    output: number;
  };
  pricing: {
    input: number;
    output: number;
    cachedRead?: number;
    cachedWrite?: number;
  };
  tags: string[];
}

export interface ZenConfig {
  apiKey: string;
  requestTimeout: number;
  enableToolCalling: boolean;
  enableImageInput: boolean;
  parallelToolCalling: boolean;
  agentTemperature: number;
  verboseLogging: boolean;
  autoDetectOpenCode: boolean;
}

export interface OpenCodeAuthEntry {
  type: string;
  apiKey: string;
}

export interface OpenCodeAuthFile {
  [provider: string]: OpenCodeAuthEntry;
}

export interface OpenCodeHealthResponse {
  healthy: boolean;
  version: string;
}

export interface ZenModelsResponse {
  object: string;
  data: ZenApiModel[];
}

export interface ZenApiModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
  max_model_len?: number;
  context_length?: number;
  context_window?: number;
}

export interface ModelsDevResponse {
  [providerId: string]: ModelsDevProvider;
}

export interface ModelsDevProvider {
  id: string;
  name: string;
  npm: string;
  models: {
    [modelId: string]: ModelsDevModel;
  };
}

export interface ModelsDevModel {
  id: string;
  name: string;
  attachment?: boolean;
  reasoning?: boolean;
  tool_call?: boolean;
  temperature?: boolean;
  knowledge?: string;
  release_date?: string;
  last_updated?: string;
  modalities?: {
    input: string[];
    output: string[];
  };
  open_weights?: boolean;
  limit?: {
    context: number;
    output: number;
  };
  cost?: {
    input: number;
    output: number;
    cache_read?: number;
  };
  status?: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  tools?: ToolDefinition[];
  tool_choice?: 'auto' | 'required' | 'none';
  parallel_tool_calls?: boolean;
  [key: string]: unknown;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[];
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: string } };

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: unknown;
  };
}

export interface ToolCall {
  index?: number;
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatCompletionChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ChunkChoice[];
  usage?: Usage;
}

export interface ChunkChoice {
  index: number;
  delta: {
    role?: string;
    content?: string;
    reasoning_content?: string;
    tool_calls?: ToolCall[];
  };
  finish_reason: string | null;
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
  };
}

export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

export type ConnectionState = 'ok' | 'error' | 'noModels' | 'unknown';

export interface StatusSnapshot {
  host: string;
  connection: { state: ConnectionState; errorMessage?: string };
  lastSuccessfulFetchAt?: number;
  models: ModelSummary[];
  sessionStats: SessionStats;
  lastRequest?: LastRequest;
  features: {
    toolCalling: boolean;
    imageInput: boolean;
    parallelToolCalling: boolean;
    agentTemperature: number;
  };
  now: number;
}

export interface ModelSummary {
  id: string;
  name: string;
  contextLabel: string;
  totalContext?: number;
  capabilityLabels: string[];
}

export interface SessionStats {
  requestCount: number;
  totalTokens: TokenUsage;
}

export interface LastRequest {
  modelId: string;
  modelName: string;
  completedAt: number;
  usage?: TokenUsage;
}
