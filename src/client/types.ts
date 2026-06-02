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
  quotas?: ApiQuota[];
}

export interface ApiQuota {
  id: string;
  name: string;
  unit: string;
  limit: number;
  used: number;
  remaining: number;
  reset_at?: string;
  period?: 'hour' | 'day' | 'week' | 'month' | 'year';
}

export interface ApiUserResponse {
  id: string;
  email: string;
  url: string;
  active_org_id?: string;
}

export interface ApiOrg {
  id: string;
  name: string;
}

export interface ApiOrgsResponse {
  orgs: ApiOrg[];
}

export interface ConsoleOrg {
  accountID: string;
  accountEmail: string;
  accountUrl: string;
  orgID: string;
  orgName: string;
  active: boolean;
}

export interface ApiConsoleOrgsResponse {
  orgs: ConsoleOrg[];
}

export interface ApiConsoleResponse {
  accountID: string;
  accountEmail: string;
  accountUrl: string;
  orgID: string;
  orgName: string;
  providerIDs: string[];
  active: boolean;
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

// --- Anthropic Messages API ---

export interface AnthropicMessageResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | null;
  usage: { input_tokens: number; output_tokens: number };
}

export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicToolUseBlock
  | AnthropicThinkingBlock;

export interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

export interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AnthropicThinkingBlock {
  type: 'thinking';
  thinking: string;
}

// Anthropic SSE event types
export type AnthropicSSEEvent =
  | { type: 'message_start'; message: AnthropicMessageResponse }
  | { type: 'content_block_start'; index: number; content_block: AnthropicContentBlock }
  | { type: 'content_block_delta'; index: number; delta: AnthropicDelta }
  | { type: 'content_block_stop'; index: number }
  | { type: 'message_delta'; delta: { stop_reason: string }; usage: { output_tokens: number } }
  | { type: 'message_stop' };

export type AnthropicDelta =
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; thinking: string }
  | { type: 'input_json_delta'; partial_json: string };

// --- OpenAI Responses API ---

export interface ResponsesAPIResponse {
  id: string;
  object: 'response';
  model: string;
  output: ResponsesOutputItem[];
  usage: ResponsesUsage;
}

export type ResponsesOutputItem =
  | ResponsesMessageOutput
  | ResponsesFunctionCallOutput;

export interface ResponsesMessageOutput {
  type: 'message';
  role: 'assistant';
  content: ResponsesContentPart[];
}

export interface ResponsesContentPart {
  type: 'output_text';
  text: string;
}

export interface ResponsesFunctionCallOutput {
  type: 'function_call';
  id: string;
  call_id: string;
  name: string;
  arguments: string;
}

export interface ResponsesUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  output_tokens_details?: { reasoning_tokens?: number };
}

// Responses API SSE event types
export type ResponsesSSEEvent =
  | { type: 'response.created'; response: ResponsesAPIResponse }
  | { type: 'response.output_item.added'; output_index: number; item: ResponsesOutputItem }
  | { type: 'response.content_part.added'; output_index: number; content_index: number; part: ResponsesContentPart }
  | { type: 'response.output_text.delta'; output_index: number; content_index: number; delta: string }
  | { type: 'response.function_call_arguments.delta'; output_index: number; item_index: number; delta: string }
  | { type: 'response.output_item.done'; output_index: number; item: ResponsesOutputItem }
  | { type: 'response.completed'; response: ResponsesAPIResponse };

// --- Google Gemini API ---

export interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content: {
      parts: GeminiPart[];
      role: string;
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
    thoughtsTokenCount?: number;
  };
}

export type GeminiPart =
  | { text: string }
  | { thought: boolean; text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { thoughtSignature: string };
