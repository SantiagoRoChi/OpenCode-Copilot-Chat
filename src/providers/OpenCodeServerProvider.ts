import * as vscode from 'vscode';
import { ServerApiClient } from '../client/multiServerManager';
import { UsageTracker } from '../usage/UsageTracker';
import { TokenUsage, SessionStats, LastRequest, ChatMessage } from '../client/types';
import { getModelCapabilities } from '../client/modelRegistry';
import {
  TOKEN_CONSTANTS,
  estimateTextTokens,
  calculateMaxInputTokens,
  truncateMessagesToFit,
  buildInputText,
} from '../utils/tokenEstimate';

export type ServerRequestStateEvent =
  | { kind: 'start'; modelId: string; modelName: string }
  | { kind: 'complete'; modelId: string; modelName: string; usage?: TokenUsage }
  | { kind: 'error'; modelId: string; modelName: string; errorMessage: string };

export interface ServerModelInfo {
  id: string;
  name: string;
  family: string;
  providerID: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  contextLabel: string;
  capabilityLabels: string[];
}

interface ServerEntry {
  serverId: string;
  serverName: string;
  baseUrl: string;
  client: ServerApiClient;
  connected: boolean;
}

export class OpenCodeServerProvider implements vscode.LanguageModelChatProvider {
  private models: vscode.LanguageModelChatInformation[] = [];
  private modelInfoMap = new Map<string, ServerModelInfo>();
  private modelServerMap = new Map<string, ServerEntry>();
  private lastFetch = 0;
  private readonly usageTracker: UsageTracker;
  private readonly outputChannel: vscode.OutputChannel;
  private sessionStats: SessionStats = { requestCount: 0, totalTokens: { prompt: 0, completion: 0, total: 0 } };
  private lastRequest?: LastRequest;
  private readonly _onDidChangeLanguageModelChatInformation = new vscode.EventEmitter<void>();
  private readonly _onDidChangeRequestState = new vscode.EventEmitter<ServerRequestStateEvent>();

  readonly onDidChangeLanguageModelChatInformation = this._onDidChangeLanguageModelChatInformation.event;
  readonly onDidChangeRequestState = this._onDidChangeRequestState.event;

  public get vendor(): string { return 'opencode-server'; }
  get displayName(): string { return 'OpenCode Servers'; }

  constructor() {
    this.usageTracker = new UsageTracker();
    this.outputChannel = vscode.window.createOutputChannel('OpenCode Servers');
    this.outputChannel.appendLine('[ServerProvider] Created');
  }

  addServer(entry: ServerEntry): void {
    this.modelServerMap.set(entry.serverId, entry);
    this.outputChannel.appendLine(`[ServerProvider] Added "${entry.serverName}" (${entry.baseUrl})`);
    this.lastFetch = 0;
    void this.fetchModels().then(() => this._onDidChangeLanguageModelChatInformation.fire());
  }

  removeServer(serverId: string): void {
    this.modelServerMap.delete(serverId);
    this.lastFetch = 0;
    void this.fetchModels().then(() => this._onDidChangeLanguageModelChatInformation.fire());
  }

  getUsageTracker(): UsageTracker { return this.usageTracker; }

  getStatusSnapshot() {
    return { connected: true, modelCount: this.models.length, lastRequest: this.lastRequest, sessionStats: this.sessionStats };
  }

  async provideLanguageModelChatInformation(
    options: { silent: boolean; configuration?: { [key: string]: unknown } },
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelChatInformation[]> {
    if (Date.now() - this.lastFetch > 5 * 60 * 1000 || this.models.length === 0) {
      await this.fetchModels();
    }
    return this.models;
  }

  async fetchModels(): Promise<void> {
    const allModels: vscode.LanguageModelChatInformation[] = [];

    for (const [serverId, entry] of this.modelServerMap) {
      try {
        const providers = await entry.client.getProviders();
        if (!providers) { entry.connected = false; continue; }

        const connectedIds = providers.connected || [];
        let count = 0;

        for (const provider of providers.all || []) {
          if (!(provider.connected || connectedIds.includes(provider.id))) continue;

          for (const [modelId, modelData] of Object.entries(provider.models || {}) as [string, any][]) {
            const uniqueId = `${serverId}:${modelId}`;
            const caps = getModelCapabilities(modelId);
            const maxInput = modelData.maxTokens || caps.maxInputTokens;
            const maxOutput = modelData.maxOutputTokens || caps.maxOutputTokens;

            const info: ServerModelInfo = {
              id: modelId,
              name: caps.name !== modelId ? caps.name : (modelData.name || modelId),
              family: provider.name,
              providerID: provider.id,
              maxInputTokens: maxInput,
              maxOutputTokens: maxOutput,
              contextLabel: `${Math.round(maxInput / 1000)}K`,
              capabilityLabels: [
                ...(caps.toolCalling ? ['Tools'] : []),
                ...(caps.imageInput ? ['Vision'] : []),
                ...(caps.reasoning ? ['Reasoning'] : []),
              ],
            };
            this.modelInfoMap.set(uniqueId, info);

            let costStr = '';
            if (caps.pricePerMillionInput != null || caps.pricePerMillionOutput != null) {
              const parts: string[] = [];
              if (caps.pricePerMillionInput != null) parts.push(`In: $${caps.pricePerMillionInput}/M`);
              if (caps.pricePerMillionOutput != null) parts.push(`Out: $${caps.pricePerMillionOutput}/M`);
              if (caps.pricePerMillionCacheRead != null) parts.push(`Cache: $${caps.pricePerMillionCacheRead}/M`);
              costStr = parts.join(' · ');
            }

            allModels.push({
              id: uniqueId,
              name: `${info.name} (${entry.serverName})`,
              detail: costStr || `${provider.name} · ${info.contextLabel} in`,
              family: provider.name,
              version: modelData.version || '1',
              maxInputTokens: maxInput,
              maxOutputTokens: maxOutput,
              tooltip: `${info.name}\n\nServer: ${entry.serverName}\nProvider: ${provider.name}\nContext: ${info.contextLabel}\nMax Output: ${Math.round(maxOutput / 1000)}K${costStr ? '\n\nPricing:\n' + costStr.replace(/ · /g, '\n') : ''}`,
              capabilities: { imageInput: caps.imageInput, toolCalling: caps.toolCalling },
            });
            count++;
          }
        }
        entry.connected = true;
        this.outputChannel.appendLine(`[ServerProvider] "${entry.serverName}": ${count} models`);
      } catch (err) {
        entry.connected = false;
        this.outputChannel.appendLine(`[ServerProvider] "${entry.serverName}" ERROR: ${err}`);
      }
    }

    this.models = allModels;
    this.lastFetch = Date.now();
  }

  refreshModels(): void {
    this.lastFetch = 0;
    this._onDidChangeLanguageModelChatInformation.fire();
  }

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    const [serverId, modelId] = model.id.split(':');
    const entry = this.modelServerMap.get(serverId);
    if (!entry) throw new Error(`Server ${serverId} not found`);

    const info = this.modelInfoMap.get(model.id);
    const modelName = info?.name ?? modelId;

    try {
      // Build messages
      const openaiMessages = this.convertAllMessages(messages);
      const modelMaxContext = model.maxInputTokens || TOKEN_CONSTANTS.DEFAULT_CONTEXT_TOKENS;
      const truncatedMessages = truncateMessagesToFit(
        openaiMessages as unknown as Record<string, unknown>[],
        calculateMaxInputTokens({ modelMaxContext, configuredMaxOutput: model.maxOutputTokens || 32000, toolsSerializedLength: 0 }),
        (msg) => this.outputChannel.appendLine(msg)
      ) as unknown as ChatMessage[];

      const textParts = truncatedMessages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({
          type: 'text',
          text: typeof m.content === 'string' ? m.content : m.content.map((c: any) => c.text || '').join(''),
        }))
        .filter((p: any) => p.text);

      // Auth headers
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      Object.assign(headers, entry.client.buildHeaders());

      const abortController = new AbortController();
      token.onCancellationRequested(() => abortController.abort());

      // Step 1: Create session
      const sessionRes = await fetch(`${entry.baseUrl}/session`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ title: `VS Code: ${modelName}` }),
        signal: abortController.signal,
      });
      if (!sessionRes.ok) throw new Error(`Session create failed: HTTP ${sessionRes.status}`);
      const sessionData = await sessionRes.json() as any;
      const sessionId = sessionData.id;
      this.outputChannel.appendLine(`[${entry.serverName}] Session: ${sessionId}`);

      // Step 2: Send message y leer respuesta como SSE stream
      const messageUrl = `${entry.baseUrl}/session/${sessionId}/message`;
      this.outputChannel.appendLine(`[${entry.serverName}] POST ${messageUrl} (SSE stream)`);

      const messageRes = await fetch(messageUrl, {
        method: 'POST',
        headers: {
          ...headers,
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify({
          model: { providerID: info?.providerID || 'opencode', modelID: modelId },
          parts: textParts,
        }),
        signal: abortController.signal,
      });

      if (!messageRes.ok) {
        const body = await messageRes.text().catch(() => '');
        throw new Error(`HTTP ${messageRes.status}: ${body}`);
      }

      // Step 3: Leer toda la respuesta cruda del stream
      const reader = messageRes.body?.getReader();
      if (!reader) throw new Error('No response body');

      const rawData = await this.readAllStreamData(reader, token, abortController);
      this.outputChannel.appendLine(`[${entry.serverName}] Raw response: ${rawData.length} bytes`);

      // Step 4: Procesar la respuesta — intenta múltiples formatos (SSE, NDJSON, JSON plano)
      const processed = await this.processAnyFormatResponse(
        rawData, progress, token, entry, modelId, modelName, info
      );

      if (processed > 0) {
        this.outputChannel.appendLine(`[${entry.serverName}] Response complete (${processed} chunks reported)`);
      } else {
        this.outputChannel.appendLine(`[${entry.serverName}] WARNING: No content extracted from response`);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.outputChannel.appendLine(`[${entry.serverName}] ERROR: ${errorMessage}`);
      throw err;
    }
  }

  async provideTokenCount(
    _model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatMessage,
    _token: vscode.CancellationToken
  ): Promise<number> {
    if (typeof text === 'string') return estimateTextTokens(text);
    let tokens = 0;
    for (const part of text.content) {
      if (part instanceof vscode.LanguageModelTextPart) tokens += estimateTextTokens(part.value);
      else if (part instanceof vscode.LanguageModelToolCallPart) tokens += estimateTextTokens(part.name + JSON.stringify(part.input ?? {}));
      else if (part instanceof vscode.LanguageModelToolResultPart) {
        const body = typeof part.content === 'string' ? part.content : JSON.stringify(part.content);
        tokens += estimateTextTokens(body);
      }
    }
    return tokens;
  }

  private convertAllMessages(messages: readonly vscode.LanguageModelChatMessage[]): ChatMessage[] {
    const result: ChatMessage[] = [];
    for (const msg of messages) {
      const role = msg.role === vscode.LanguageModelChatMessageRole.Assistant ? 'assistant' : 'user';
      const textParts: string[] = [];
      for (const part of msg.content) {
        if (part instanceof vscode.LanguageModelTextPart) textParts.push(part.value);
        else if (part instanceof vscode.LanguageModelToolResultPart) {
          const body = typeof part.content === 'string' ? part.content : JSON.stringify(part.content);
          textParts.push(`[Tool result: ${body}]`);
        } else if (part instanceof vscode.LanguageModelToolCallPart) {
          textParts.push(`[Tool call: ${part.name}(${JSON.stringify(part.input)})]`);
        }
      }
      if (textParts.length > 0) {
        result.push({ role: role as 'user' | 'assistant', content: textParts.join('\n') });
      }
    }
    return result;
  }

  /**
   * Lee todo el contenido de un ReadableStream como string.
   */
  private async readAllStreamData(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    token: vscode.CancellationToken,
    abortController: AbortController
  ): Promise<string> {
    const decoder = new TextDecoder();
    let result = '';
    while (true) {
      if (token.isCancellationRequested) { abortController.abort(); break; }
      const { done, value } = await reader.read();
      if (done) break;
      result += decoder.decode(value, { stream: true });
    }
    return result;
  }

  /**
   * Intenta procesar la respuesta del servidor en múltiples formatos:
   * 1. SSE estándar (event: + data:)
   * 2. SSE sin event type (solo data:)
   * 3. NDJSON (cada línea es JSON)
   * 4. OpenAI-compatible SSE (choices[].delta)
   * 5. JSON plano con array parts[]
   * 6. Array JSON directo
   *
   * Devuelve el número de chunks reportados a VS Code.
   */
  private async processAnyFormatResponse(
    rawData: string,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
    entry: ServerEntry,
    modelId: string,
    modelName: string,
    info: ServerModelInfo | undefined
  ): Promise<number> {
    if (!rawData || !rawData.trim()) return 0;

    // ── 1. Intentar parsear como SSE (event: / data: lines) ──
    const events = this.parseSSE(rawData);
    if (events.length > 0) {
      this.outputChannel.appendLine(`[${entry.serverName}] Parsed as SSE: ${events.length} events`);
      return await this.processParsedEvents(events, progress, token, entry, modelId, modelName, info);
    }

    // ── 2. Intentar parsear como NDJSON (cada línea es JSON) ──
    // Solo usamos NDJSON si al menos un evento se procesa correctamente
    const ndjsonEvents = this.parseNDJSON(rawData);
    if (ndjsonEvents.length > 0) {
      this.outputChannel.appendLine(`[${entry.serverName}] Parsed as NDJSON: ${ndjsonEvents.length} events`);
      const ndjsonResult = await this.processParsedEvents(ndjsonEvents, progress, token, entry, modelId, modelName, info);
      if (ndjsonResult > 0) return ndjsonResult;
      this.outputChannel.appendLine(`[${entry.serverName}] NDJSON events had no recognizable type, trying next format...`);
    }

    // ── 3. Intentar parsear como JSON plano ──
    try {
      const parsed = JSON.parse(rawData.trim());
      const parts = parsed.parts || parsed.events || (Array.isArray(parsed) ? parsed : null);
      if (parts && Array.isArray(parts) && parts.length > 0) {
        this.outputChannel.appendLine(`[${entry.serverName}] Parsed as JSON with ${parts.length} parts`);
        return await this.processParsedEvents(parts, progress, token, entry, modelId, modelName, info);
      }
      // Si es un solo evento con type
      if (parsed.type) {
        this.outputChannel.appendLine(`[${entry.serverName}] Parsed as single JSON event: ${parsed.type}`);
        return await this.processParsedEvents([parsed], progress, token, entry, modelId, modelName, info);
      }
    } catch {
      // No es JSON válido
    }

    // ── 4. Fallback: tratar todo como texto plano ──
    const trimmed = rawData.trim();
    if (trimmed.length > 0) {
      this.outputChannel.appendLine(`[${entry.serverName}] Fallback: raw text (${trimmed.length} chars)`);
      progress.report(new vscode.LanguageModelTextPart(trimmed));
      return 1;
    }

    return 0;
  }

  /**
   * Parsea SSE estándar: maneja event: + data: y solo data:
   */
  private parseSSE(rawData: string): any[] {
    const events: any[] = [];
    let currentEvent = '';
    let hasSseData = false;

    for (const line of rawData.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) { currentEvent = ''; continue; }
      if (trimmed.startsWith(':')) continue; // comentario SSE

      if (trimmed.startsWith('event: ')) {
        currentEvent = trimmed.slice(7).trim();
        continue;
      }

      if (trimmed.startsWith('data: ')) {
        const data = trimmed.slice(6).trim();
        hasSseData = true;
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          // Si tiene event type asignado, lo añadimos
          if (currentEvent && !parsed.type) parsed._sseEvent = currentEvent;
          events.push(parsed);
        } catch { /* ignorar */ }
        continue;
      }

      // Línea sin prefijo SSE — posible NDJSON o basura
      // No la procesamos aquí
    }

    // Si no encontramos data:, no era SSE — devolver vacío
    if (!hasSseData) return [];
    return events;
  }

  /**
   * Parsea NDJSON: cada línea no vacía es un JSON independiente
   */
  private parseNDJSON(rawData: string): any[] {
    const events: any[] = [];
    let hasNonSseJson = false;

    for (const line of rawData.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // Saltar líneas que parecen SSE (las maneja parseSSE)
      if (trimmed.startsWith('data:') || trimmed.startsWith('event:') || trimmed.startsWith(':')) continue;
      try {
        const parsed = JSON.parse(trimmed);
        hasNonSseJson = true;
        events.push(parsed);
      } catch { /* ignorar */ }
    }

    return hasNonSseJson ? events : [];
  }

  /**
   * Procesa una lista de eventos parseados y los reporta a VS Code.
   */
  private async processParsedEvents(
    events: any[],
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
    entry: ServerEntry,
    modelId: string,
    modelName: string,
    info: ServerModelInfo | undefined
  ): Promise<number> {
    let reportedChunks = 0;
    let totalText = '';
    let isReasoningBlock = false;
    let reasoningBuffer = '';
    let lastProgressReport = Date.now();
    const expireReasoning = () => { isReasoningBlock = false; reasoningBuffer = ''; };
    const flushReasoning = () => {
      if (reasoningBuffer.length > 0) {
        try {
          const tp = new (vscode as any).LanguageModelThinkingPart(reasoningBuffer, `reasoner-${Date.now()}`);
          progress.report(tp);
        } catch {
          progress.report(new vscode.LanguageModelTextPart(`\n[reasoning]${reasoningBuffer}[/reasoning]\n`));
        }
        reportedChunks++;
        reasoningBuffer = '';
      }
    };

    for (let i = 0; i < events.length; i++) {
      if (token.isCancellationRequested) break;

      const event = events[i];
      // Usar event.type, o event._sseEvent, o detectar por campos presentes
      const type = event.type || event._sseEvent || this.inferEventType(event);
      if (!type) continue;

      switch (type) {
        // ── Texto ──
        case 'text':
        case 'content':
        case 'delta': {
          const text = event.text ?? event.content ?? event.delta ?? '';
          if (text) {
            totalText += text;
            progress.report(new vscode.LanguageModelTextPart(text));
            reportedChunks++;
            lastProgressReport = Date.now();
          }
          break;
        }

        // ── Razonamiento ──
        case 'reasoning':
        case 'thinking':
        case 'reason': {
          const text = event.text ?? event.content ?? event.thinking ?? '';
          if (text) {
            if (!isReasoningBlock) { isReasoningBlock = true; reasoningBuffer = ''; }
            reasoningBuffer += text;
            const now = Date.now();
            if (now - lastProgressReport > 200) {
              try {
                const tp = new (vscode as any).LanguageModelThinkingPart(text, `reasoner-${Date.now()}`);
                progress.report(tp);
              } catch {
                progress.report(new vscode.LanguageModelTextPart(text));
              }
              lastProgressReport = now;
              reportedChunks++;
            }
          }
          break;
        }

        // ── OpenAI delta ──
        case 'openai-delta':
        case 'chat.completion.chunk': {
          const choice = event.choices?.[0]?.delta || event.choices?.[0];
          if (choice) {
            if (choice.content) {
              totalText += choice.content;
              progress.report(new vscode.LanguageModelTextPart(choice.content));
              reportedChunks++;
            }
            if (choice.reasoning_content || choice.reasoningContent) {
              const rt = choice.reasoning_content || choice.reasoningContent;
              try {
                const tp = new (vscode as any).LanguageModelThinkingPart(rt, `reasoner-${Date.now()}`);
                progress.report(tp);
              } catch {
                progress.report(new vscode.LanguageModelTextPart(rt));
              }
              reportedChunks++;
            }
            if (choice.tool_calls) {
              for (const tc of choice.tool_calls) {
                progress.report(new vscode.LanguageModelToolCallPart(tc.id || `call_${i}`, tc.function?.name || 'unknown', this.safeParseJson(tc.function?.arguments || '{}')));
                reportedChunks++;
              }
            }
          }
          if (event.usage) this.recordUsage(event.usage, entry, modelId, modelName);
          lastProgressReport = Date.now();
          break;
        }

        // ── Tool calls ──
        case 'tool_call':
        case 'tool_use':
        case 'function_call': {
          flushReasoning();
          const id = event.id || event.callId || event.call_id || `call_${i}`;
          const name = event.name || event.function?.name || event.toolName || event.tool_name || 'unknown';
          const args = event.arguments || event.args || event.input || event.function?.arguments || {};
          progress.report(new vscode.LanguageModelToolCallPart(id, name, typeof args === 'string' ? this.safeParseJson(args) : args));
          reportedChunks++;
          break;
        }

        // ── Tool results (servidor devolviendo resultado de tool) ──
        case 'tool_result':
        case 'tool-result': {
          const body = event.content ?? event.text ?? event.result ?? '';
          const payload = new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body));
          progress.report(new vscode.LanguageModelDataPart(payload, 'application/json'));
          reportedChunks++;
          break;
        }

        // ── Uso / tokens ──
        case 'usage':
        case 'step-finish':
        case 'complete':
        case 'done': {
          expireReasoning();
          const tokens = event.tokens ?? event.usage ?? event;
          if (tokens?.input !== undefined || tokens?.output !== undefined || tokens?.total !== undefined ||
              tokens?.prompt !== undefined || tokens?.completion !== undefined) {
            this.recordUsage(tokens, entry, modelId, modelName);
          }
          break;
        }

        // ── Step markers ──
        case 'step-start':
        case 'reasoning_start': {
          expireReasoning();
          isReasoningBlock = true;
          reasoningBuffer = '';
          break;
        }

        case 'reasoning_end':
        case 'thinking_done': {
          flushReasoning();
          expireReasoning();
          break;
        }

        // ── Errores ──
        case 'error':
        case 'error_event': {
          throw new Error(event.text || event.message || event.error || 'Unknown server error');
        }

        // ── Heartbeat ──
        case 'status':
        case 'ping':
        case 'heartbeat':
          break;

        // ── Intentar detectar OpenAI delta ──
        default: {
          if (event.choices?.[0]?.delta) {
            const choice = event.choices[0];
            if (choice.delta.content) {
              totalText += choice.delta.content;
              progress.report(new vscode.LanguageModelTextPart(choice.delta.content));
              reportedChunks++;
            }
            if (choice.delta.reasoning_content) {
              try {
                const tp = new (vscode as any).LanguageModelThinkingPart(choice.delta.reasoning_content, `reasoner-${Date.now()}`);
                progress.report(tp);
              } catch {
                progress.report(new vscode.LanguageModelTextPart(choice.delta.reasoning_content));
              }
              reportedChunks++;
            }
            if (choice.delta.tool_calls) {
              for (const tc of choice.delta.tool_calls) {
                progress.report(new vscode.LanguageModelToolCallPart(tc.id || `call_${i}`, tc.function?.name || 'unknown', this.safeParseJson(tc.function?.arguments || '{}')));
                reportedChunks++;
              }
            }
            if (event.usage) this.recordUsage(event.usage, entry, modelId, modelName);
            lastProgressReport = Date.now();
          } else if (Array.isArray(event.parts)) {
            // Evento con sub-parts — procesar recursivamente
            const sub = await this.processParsedEvents(event.parts, progress, token, entry, modelId, modelName, info);
            reportedChunks += sub;
          }
          break;
        }
      }

      // Heartbeat periódico
      if (reportedChunks > 0 && Date.now() - lastProgressReport > 2500) {
        progress.report(new vscode.LanguageModelTextPart(''));
        lastProgressReport = Date.now();
      }
    }

    flushReasoning();
    return reportedChunks;
  }

  /**
   * Infiere el tipo de evento cuando no hay campo `type`.
   */
  private inferEventType(event: any): string | null {
    if (!event || typeof event !== 'object') return null;
    if (event.choices?.[0]?.delta) return 'openai-delta';
    if (event.choices?.[0]?.content) return 'openai-delta';
    if (event.id && event.name && (event.arguments || event.args)) return 'tool_call';
    if (event.tool_calls) return 'openai-delta';
    if (event.text !== undefined) return 'text';
    if (event.content !== undefined && !event.choices) return 'text';
    if (event.delta !== undefined) return 'text';
    if (event.thinking !== undefined) return 'reasoning';
    if (event.reasoning !== undefined) return 'reasoning';
    if (event.tokens && (event.tokens.input || event.tokens.output)) return 'usage';
    if (event.usage) return 'usage';
    if (event.message) return 'error';
    if (event._sseEvent) return event._sseEvent;
    return null;
  }

  private safeParseJson(str: string): Record<string, unknown> {
    try { return JSON.parse(str); } catch { return { raw: str }; }
  }

  /**
   * Registra uso de tokens en las estadísticas.
   */
  private recordUsage(
    tokens: any,
    entry: ServerEntry,
    modelId: string,
    modelName: string
  ): void {
    const usage: TokenUsage = {
      prompt: tokens.prompt ?? tokens.input ?? tokens.prompt_tokens ?? 0,
      completion: tokens.completion ?? tokens.output ?? tokens.completion_tokens ?? 0,
      total: tokens.total ?? tokens.total_tokens ?? ((tokens.prompt ?? 0) + (tokens.completion ?? 0)),
    };
    this.sessionStats.requestCount++;
    this.sessionStats.totalTokens.prompt += usage.prompt;
    this.sessionStats.totalTokens.completion += usage.completion;
    this.sessionStats.totalTokens.total += usage.total;
    this.lastRequest = { modelId, modelName, completedAt: Date.now(), usage };
    this.usageTracker.recordRequest(`server-${Date.now()}`, entry.serverId, modelId, modelName, 'server', usage);
    this.outputChannel.appendLine(`[${entry.serverName}] Tokens: in=${usage.prompt} out=${usage.completion} total=${usage.total}`);
  }

  showOutput(): void { this.outputChannel.show(); }
  dispose(): void {
    this.outputChannel.dispose();
    this._onDidChangeLanguageModelChatInformation.dispose();
    this._onDidChangeRequestState.dispose();
  }
}
