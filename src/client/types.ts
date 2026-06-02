import { ApiEndpoint } from './endpoints';

export interface ApiModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

export interface ApiModelsResponse {
  object: string;
  data: ApiModel[];
}

export interface ApiUsageResponse {
  object?: string;
  balance?: number;
  currency?: string;
  limit?: number;
  used?: number;
  remaining?: number;
  reset_at?: string;
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

export interface ToolCall {
  index?: number;
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ToolDefinition {
  type: 'function';
  function: { name: string; description?: string; parameters?: unknown };
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
  prompt_tokens_details?: { cached_tokens?: number };
}

export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

export interface ReasonerStep {
  stepId: string;
  label: string;
  startedAt: number;
  endedAt?: number;
  tokens?: number;
}

export interface RequestMeta {
  requestId: string;
  sessionId: string;
  parentRequestId?: string;
  reasonerSteps: ReasonerStep[];
  modelId: string;
  modelName: string;
  startedAt: number;
  completedAt?: number;
}

export type ConnectionState = 'ok' | 'error' | 'noModels' | 'unknown';

export interface StatusSnapshot {
  host: string;
  connection: { state: ConnectionState; errorMessage?: string };
  lastSuccessfulFetchAt?: number;
  models: ModelSummary[];
  sessionStats: SessionStats;
  lastRequest?: LastRequest;
  features: { toolCalling: boolean; imageInput: boolean; parallelToolCalling: boolean; agentTemperature: number };
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

export interface OpenCodeAuthEntry {
  type?: string;
  apiKey: string;
}

export interface OpenCodeAuthFile {
  [provider: string]: OpenCodeAuthEntry;
}

export interface OpenCodeHealthResponse {
  healthy: boolean;
  version?: string;
}
