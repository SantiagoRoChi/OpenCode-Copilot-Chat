import * as vscode from 'vscode';
import { ApiFormat } from '../client/modelRegistry';

/**
 * Routing data embedded directly in each model object.
 * VS Code returns the exact object from provideLanguageModelChatInformation
 * back to provideLanguageModelChatResponse, so we can read _url/_headers/_apiFormat
 * without any server lookup map.
 */
export interface RoutedModelInfo extends vscode.LanguageModelChatInformation {
  readonly _url: string;
  readonly _headers: Record<string, string>;
  readonly _apiId: string;      // Model ID to send to the API (no serverId: prefix)
  readonly _apiFormat: ApiFormat;
  readonly _pricing?: {
    inputTokenPrice?: number;
    outputTokenPrice?: number;
    reasoningTokenPrice?: number;
    currency?: string;
  };
}

/**
 * Base class for all providers in this extension.
 *
 * Responsibilities:
 *  - provideLanguageModelChatInformation: delegates to getModels() (subclass)
 *  - provideLanguageModelChatResponse: converts VS Code messages → OpenAI format,
 *    calls getEndpoint() (subclass), streams SSE, reports LanguageModelResponsePart
 *  - provideTokenCount: character-based estimate
 *
 * Subclasses only implement:
 *  - getModels(): discover and return LanguageModelChatInformation[]
 *  - getEndpoint(modelId): return the {url, headers} for chat/completions
 */
export abstract class OpenAICompatibleProvider implements vscode.LanguageModelChatProvider {
  protected models: RoutedModelInfo[] = [];
  protected lastFetch = 0;
  protected readonly cacheTtlMs = 5 * 60 * 1000;

  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeLanguageModelChatInformation = this._onDidChange.event;

  protected fire(): void {
    this._onDidChange.fire();
  }

  dispose(): void {
    this._onDidChange.dispose();
  }

  // ── Subclass contract ─────────────────────────────────────────────────────

  /** Discover models and return them with routing data embedded. */
  protected abstract getModels(): Promise<RoutedModelInfo[]>;

  // ── provideLanguageModelChatInformation ───────────────────────────────────

  async provideLanguageModelChatInformation(
    _options: { silent: boolean; configuration?: Record<string, unknown> },
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelChatInformation[]> {
    if (Date.now() - this.lastFetch > this.cacheTtlMs || this.models.length === 0) {
      this.models = await this.getModels().catch(() => this.models);
      this.lastFetch = Date.now();
    }
    return this.models as vscode.LanguageModelChatInformation[];
  }

  invalidateCache(): void {
    this.lastFetch = 0;
  }

  refreshModels(): void {
    this.invalidateCache();
    void this.getModels().then(m => {
      this.models = m;
      this.fire();
    }).catch(() => undefined);
  }

  // ── provideLanguageModelChatResponse ─────────────────────────────────────

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    const rm = model as RoutedModelInfo;
    // VS Code passes back the exact object returned from provideLanguageModelChatInformation,
    // so _url / _headers / _apiFormat are guaranteed to be present.
    switch (rm._apiFormat) {
      case 'anthropic': return this.callAnthropic(rm, messages, options, progress, token);
      case 'openai':    return this.callResponses(rm, messages, options, progress, token);
      default:          return this.callChatCompletions(rm, messages, options, progress, token);
    }
  }

  // ── Model options mapping ──────────────────────────────────────────────────

  /**
   * Maps VS Code model options to the OpenAI request body.
   * Renames camelCase VS Code keys (reasoningEffort) to snake_case API keys.
   */
  protected mapModelOptions(opts: Record<string, unknown>): Record<string, unknown> {
    const mapped: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(opts)) {
      if (value === undefined || value === null) continue;
      if (key === 'reasoningEffort') {
        mapped['reasoning_effort'] = value;
      } else {
        mapped[key] = value;
      }
    }
    return mapped;
  }

  // ── SSE streaming ─────────────────────────────────────────────────────────

  private async streamSSE(
    body: ReadableStream<Uint8Array>,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>
  ): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const toolCalls = new Map<number, { id: string; name: string; args: string }>();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (!trimmed.startsWith('data: ')) continue;

          try {
            const data = JSON.parse(trimmed.slice(6));
            const delta = data.choices?.[0]?.delta;
            if (!delta) continue;

            // Text content (standard path)
            if (delta.content) {
              progress.report(new vscode.LanguageModelTextPart(delta.content));
            }

            // Thinking / reasoning content (collapsible in VS Code when languageModelThinkingPart is enabled)
            if (delta.reasoning_content) {
              const thinkingPart = new (vscode as any).LanguageModelThinkingPart(delta.reasoning_content);
              progress.report(thinkingPart as vscode.LanguageModelResponsePart);
            }

            // Tool calls (accumulate)
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx: number = tc.index ?? 0;
                let buf = toolCalls.get(idx);
                if (!buf) {
                  buf = { id: '', name: '', args: '' };
                  toolCalls.set(idx, buf);
                }
                if (tc.id) buf.id = tc.id;
                if (tc.function?.name) buf.name = tc.function.name;
                if (tc.function?.arguments) buf.args += tc.function.arguments;
              }
            }

            // Flush tool calls on finish
            if (data.choices?.[0]?.finish_reason === 'tool_calls') {
              for (const [, buf] of toolCalls) {
                if (buf.id && buf.name) {
                  let args: unknown;
                  try { args = JSON.parse(buf.args); } catch { args = buf.args; }
                  progress.report(new vscode.LanguageModelToolCallPart(buf.id, buf.name, args as Record<string, unknown>));
                }
              }
              toolCalls.clear();
            }
          } catch {
            // skip malformed line
          }
        }
      }

      // Flush any remaining tool calls
      for (const [, buf] of toolCalls) {
        if (buf.id && buf.name) {
          let args: unknown;
          try { args = JSON.parse(buf.args); } catch { args = buf.args; }
          progress.report(new vscode.LanguageModelToolCallPart(buf.id, buf.name, args as Record<string, unknown>));
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // ── OpenAI Chat Completions (openai-compatible) ───────────────────────────

  private async callChatCompletions(
    rm: RoutedModelInfo,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    const tools = (options as any).tools as vscode.LanguageModelChatTool[] | undefined;
    const body: Record<string, unknown> = {
      model: rm._apiId,
      messages: this.convertMessages(messages),
      stream: true,
      ...this.mapModelOptions(options.modelOptions ?? {}),
    };
    if (tools?.length) {
      body['tools'] = tools.map(t => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.inputSchema ?? { type: 'object', properties: {} } },
      }));
    }
    const response = await this.fetchStream(rm, JSON.stringify(body), token);
    await this.streamSSE(response.body!, progress);
  }

  // ── Anthropic Messages API ─────────────────────────────────────────────────

  private async callAnthropic(
    rm: RoutedModelInfo,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    const tools = (options as any).tools as vscode.LanguageModelChatTool[] | undefined;
    const { system, messages: anthropicMessages } = this.convertMessagesAnthropic(messages);
    const body: Record<string, unknown> = {
      model: rm._apiId,
      messages: anthropicMessages,
      max_tokens: rm.maxOutputTokens ?? 8192,
      stream: true,
    };
    if (system) body['system'] = system;
    if (tools?.length) {
      body['tools'] = tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema ?? { type: 'object', properties: {} },
      }));
    }
    const modelOpts = this.mapModelOptions(options.modelOptions ?? {});
    // Anthropic uses thinking budget, not reasoning_effort — drop it to avoid errors
    const { reasoning_effort: _re, ...safeOpts } = modelOpts as any;
    Object.assign(body, safeOpts);

    const response = await this.fetchStream(rm, JSON.stringify(body), token);
    await this.streamAnthropicSSE(response.body!, progress);
  }

  private convertMessagesAnthropic(messages: readonly vscode.LanguageModelChatRequestMessage[]): {
    system: string | undefined;
    messages: unknown[];
  } {
    const systemParts: string[] = [];
    const result: unknown[] = [];

    for (const msg of messages) {
      const isAssistant = msg.role === vscode.LanguageModelChatMessageRole.Assistant;
      const isSystem = msg.role === (vscode as any).LanguageModelChatMessageRole.System;

      if (isSystem) {
        for (const part of msg.content) {
          if (part instanceof vscode.LanguageModelTextPart) systemParts.push(part.value);
        }
        continue;
      }

      const role = isAssistant ? 'assistant' : 'user';
      const content: unknown[] = [];
      const toolResults: unknown[] = [];

      for (const part of msg.content) {
        if (part instanceof vscode.LanguageModelTextPart) {
          content.push({ type: 'text', text: part.value });
        } else if (part instanceof vscode.LanguageModelToolCallPart) {
          content.push({ type: 'tool_use', id: part.callId, name: part.name, input: part.input });
        } else if (part instanceof vscode.LanguageModelToolResultPart) {
          const text = part.content
            .filter((p): p is vscode.LanguageModelTextPart => p instanceof vscode.LanguageModelTextPart)
            .map(p => p.value).join('');
          toolResults.push({ type: 'tool_result', tool_use_id: part.callId, content: text });
        }
      }

      if (toolResults.length > 0) result.push({ role: 'user', content: toolResults });
      if (content.length > 0) result.push({ role, content });
    }

    return { system: systemParts.length > 0 ? systemParts.join('\n\n') : undefined, messages: result };
  }

  private async streamAnthropicSSE(
    body: ReadableStream<Uint8Array>,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>
  ): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let eventType = '';
    const toolBlocks = new Map<number, { id: string; name: string; args: string }>();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('event: ')) { eventType = trimmed.slice(7); continue; }
          if (!trimmed.startsWith('data: ')) continue;

          try {
            const data = JSON.parse(trimmed.slice(6));
            if (eventType === 'content_block_start' && data.content_block?.type === 'tool_use') {
              toolBlocks.set(data.index ?? 0, { id: data.content_block.id ?? '', name: data.content_block.name ?? '', args: '' });
            } else if (eventType === 'content_block_delta') {
              const delta = data.delta;
              const idx: number = data.index ?? 0;
              if (delta?.type === 'text_delta') {
                progress.report(new vscode.LanguageModelTextPart(delta.text ?? ''));
              } else if (delta?.type === 'input_json_delta') {
                const block = toolBlocks.get(idx);
                if (block) block.args += delta.partial_json ?? '';
              } else if (delta?.type === 'thinking_delta') {
                const thinkingPart = new (vscode as any).LanguageModelThinkingPart(delta.thinking ?? '');
                progress.report(thinkingPart as vscode.LanguageModelResponsePart);
              } else if (delta?.type === 'signature_delta') {
                // Signature deltas are part of thinking blocks; ignore standalone
              }
            } else if (eventType === 'content_block_stop') {
              const block = toolBlocks.get(data.index ?? 0);
              if (block?.name) {
                let args: unknown;
                try { args = JSON.parse(block.args); } catch { args = block.args; }
                progress.report(new vscode.LanguageModelToolCallPart(block.id, block.name, args as Record<string, unknown>));
                toolBlocks.delete(data.index ?? 0);
              }
            }
          } catch { /* skip malformed */ }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // ── OpenAI Responses API ──────────────────────────────────────────────────

  private async callResponses(
    rm: RoutedModelInfo,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    const tools = (options as any).tools as vscode.LanguageModelChatTool[] | undefined;
    const body: Record<string, unknown> = {
      model: rm._apiId,
      input: this.convertMessagesResponses(messages),
      stream: true,
      max_output_tokens: rm.maxOutputTokens ?? 8192,
      ...this.mapModelOptions(options.modelOptions ?? {}),
    };
    if (tools?.length) {
      body['tools'] = tools.map(t => ({
        type: 'function',
        name: t.name,
        description: t.description,
        parameters: t.inputSchema ?? { type: 'object', properties: {} },
      }));
    }
    const response = await this.fetchStream(rm, JSON.stringify(body), token);
    await this.streamResponsesSSE(response.body!, progress);
  }

  private convertMessagesResponses(messages: readonly vscode.LanguageModelChatRequestMessage[]): unknown[] {
    const result: unknown[] = [];
    for (const msg of messages) {
      const isAssistant = msg.role === vscode.LanguageModelChatMessageRole.Assistant;
      for (const part of msg.content) {
        if (part instanceof vscode.LanguageModelTextPart) {
          result.push({ role: isAssistant ? 'assistant' : 'user', content: part.value });
        } else if (part instanceof vscode.LanguageModelToolCallPart) {
          result.push({ type: 'function_call', call_id: part.callId, name: part.name, arguments: JSON.stringify(part.input) });
        } else if (part instanceof vscode.LanguageModelToolResultPart) {
          const text = part.content
            .filter((p): p is vscode.LanguageModelTextPart => p instanceof vscode.LanguageModelTextPart)
            .map(p => p.value).join('');
          result.push({ type: 'function_call_output', call_id: part.callId, output: text });
        }
      }
    }
    return result;
  }

  private async streamResponsesSSE(
    body: ReadableStream<Uint8Array>,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>
  ): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let eventType = '';
    const toolCalls = new Map<string, { id: string; name: string; args: string }>();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('event: ')) { eventType = trimmed.slice(7); continue; }
          if (!trimmed.startsWith('data: ') || trimmed === 'data: [DONE]') continue;

          try {
            const data = JSON.parse(trimmed.slice(6));
            if (eventType === 'response.output_text.delta') {
              progress.report(new vscode.LanguageModelTextPart(data.delta ?? ''));
            } else if (eventType === 'response.output_item.added' && data.item?.type === 'function_call') {
              const itemId: string = data.item.id ?? String(data.output_index ?? 0);
              toolCalls.set(itemId, { id: data.item.call_id ?? itemId, name: data.item.name ?? '', args: '' });
            } else if (eventType === 'response.function_call_arguments.delta') {
              const tc = toolCalls.get(data.item_id ?? '');
              if (tc) tc.args += data.delta ?? '';
            } else if (eventType === 'response.output_item.done' && data.item?.type === 'function_call') {
              const itemId: string = data.item.id ?? '';
              const tc = toolCalls.get(itemId);
              if (tc?.name) {
                let args: unknown;
                try { args = JSON.parse(tc.args); } catch { args = tc.args; }
                progress.report(new vscode.LanguageModelToolCallPart(tc.id, tc.name, args as Record<string, unknown>));
                toolCalls.delete(itemId);
              }
            }
          } catch { /* skip malformed */ }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // ── Shared fetch helper ───────────────────────────────────────────────────

  private async fetchStream(
    rm: RoutedModelInfo,
    body: string,
    token: vscode.CancellationToken
  ): Promise<Response> {
    const abort = new AbortController();
    token.onCancellationRequested(() => abort.abort());

    const response = await fetch(rm._url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...rm._headers },
      body,
      signal: abort.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${text}`);
    }
    if (!response.body) throw new Error('No response body');
    return response;
  }

  // ── Message conversion ────────────────────────────────────────────────────

  protected convertMessages(messages: readonly vscode.LanguageModelChatRequestMessage[]): unknown[] {
    const result: unknown[] = [];

    for (const msg of messages) {
      const role =
        msg.role === vscode.LanguageModelChatMessageRole.Assistant ? 'assistant' :
        msg.role === (vscode as any).LanguageModelChatMessageRole.System ? 'system' : 'user';

      const textParts: string[] = [];
      const toolCalls: unknown[] = [];
      const toolResults: unknown[] = [];

      for (const part of msg.content) {
        if (part instanceof vscode.LanguageModelTextPart) {
          textParts.push(part.value);
        } else if (part instanceof vscode.LanguageModelToolResultPart) {
          const contentStr =
            part.content
              .filter((p): p is vscode.LanguageModelTextPart => p instanceof vscode.LanguageModelTextPart)
              .map(p => p.value)
              .join('');
          toolResults.push({ role: 'tool', tool_call_id: part.callId, content: contentStr });
        } else if (part instanceof vscode.LanguageModelToolCallPart) {
          // Tool calls go in the top-level tool_calls field, NOT inside content
          toolCalls.push({
            id: part.callId,
            type: 'function',
            function: { name: part.name, arguments: JSON.stringify(part.input) },
          });
        }
      }

      for (const tr of toolResults) { result.push(tr); }

      if (textParts.length > 0 || toolCalls.length > 0) {
        const msgObj: Record<string, unknown> = { role };
        // content must only contain text/image_url entries; null when only tool_calls
        msgObj['content'] = textParts.length > 0 ? textParts.join('') : null;
        if (toolCalls.length > 0) {
          msgObj['tool_calls'] = toolCalls;
        }
        result.push(msgObj);
      }
    }

    return result;
  }

  // ── provideTokenCount ─────────────────────────────────────────────────────

  async provideTokenCount(
    _model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatMessage,
    _token: vscode.CancellationToken
  ): Promise<number> {
    if (typeof text === 'string') {
      return Math.ceil(text.length / 4);
    }
    let chars = 0;
    for (const part of text.content) {
      if (part instanceof vscode.LanguageModelTextPart) {
        chars += part.value.length;
      }
    }
    return Math.ceil(chars / 4);
  }
}
