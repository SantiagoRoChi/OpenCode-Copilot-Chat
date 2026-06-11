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

      // Step 3: Leer SSE stream y reportar progreso incremental
      const reader = messageRes.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      let totalText = '';
      let isReasoningBlock = false;
      let reasoningBuffer = '';
      let lastProgressReport = Date.now();
      let reportedChunks = 0;

      while (true) {
        if (token.isCancellationRequested) {
          abortController.abort();
          break;
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;

          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6);
            if (data === '[DONE]') continue;

            try {
              const event = JSON.parse(data) as any;
              const part = event.type ? event : (event.parts?.[0] || event);

              switch (part.type) {
                case 'text':
                  if (part.text) {
                    totalText += part.text;
                    progress.report(new vscode.LanguageModelTextPart(part.text));
                    reportedChunks++;
                    lastProgressReport = Date.now();
                  }
                  break;

                case 'reasoning':
                  if (part.text) {
                    if (!isReasoningBlock) {
                      isReasoningBlock = true;
                      reasoningBuffer = '';
                    }
                    reasoningBuffer += part.text;
                    // Reportar razonamiento cada ~200ms para no saturar
                    const now = Date.now();
                    if (now - lastProgressReport > 200) {
                      try {
                        const thinkingPart = new (vscode as any).LanguageModelThinkingPart(part.text, `reasoner-${Date.now()}`);
                        progress.report(thinkingPart);
                      } catch {
                        progress.report(new vscode.LanguageModelTextPart(part.text));
                      }
                      lastProgressReport = now;
                      reportedChunks++;
                    }
                  }
                  break;

                case 'step-start':
                  // Nuevo paso de razonamiento — resetear buffer
                  if (isReasoningBlock) {
                    isReasoningBlock = false;
                    reasoningBuffer = '';
                  }
                  break;

                case 'step-finish':
                  // Cerrar bloque de razonamiento si estaba abierto
                  isReasoningBlock = false;
                  reasoningBuffer = '';
                  // Token usage
                  if (part.tokens) {
                    const usage: TokenUsage = {
                      prompt: part.tokens.input || 0,
                      completion: part.tokens.output || 0,
                      total: part.tokens.total || 0,
                    };
                    this.sessionStats.requestCount++;
                    this.sessionStats.totalTokens.prompt += usage.prompt;
                    this.sessionStats.totalTokens.completion += usage.completion;
                    this.sessionStats.totalTokens.total += usage.total;
                    this.lastRequest = { modelId, modelName, completedAt: Date.now(), usage };
                    this.usageTracker.recordRequest(
                      `server-${Date.now()}`, entry.serverId, modelId, modelName, 'server', usage
                    );
                    this.outputChannel.appendLine(
                      `[${entry.serverName}] Tokens: in=${usage.prompt} out=${usage.completion} total=${usage.total}`
                    );
                  }
                  break;

                case 'error':
                  throw new Error(part.text || 'Unknown server error');

                case 'status':
                case 'ping':
                  // Heartbeat — ignorar pero actualizar timestamp
                  break;

                default:
                  // Intentar parsear como delta de OpenAI (para LM Studio / servidores compatibles)
                  if (part.choices?.[0]?.delta) {
                    const delta = part.choices[0].delta;
                    if (delta.content) {
                      totalText += delta.content;
                      progress.report(new vscode.LanguageModelTextPart(delta.content));
                      reportedChunks++;
                      lastProgressReport = Date.now();
                    }
                    if (delta.reasoning_content) {
                      try {
                        const thinkingPart = new (vscode as any).LanguageModelThinkingPart(delta.reasoning_content, `reasoner-${Date.now()}`);
                        progress.report(thinkingPart);
                      } catch {
                        progress.report(new vscode.LanguageModelTextPart(delta.reasoning_content));
                      }
                      reportedChunks++;
                      lastProgressReport = Date.now();
                    }
                  }
                  break;
              }
            } catch {
              // Ignorar eventos malformados
            }
          }
        }

        // Reportar heartbeat periódico para evitar timeout incluso sin nuevo contenido
        if (reportedChunks > 0 && Date.now() - lastProgressReport > 2000) {
          // Enviar un espacio invisible para mantener el flujo vivo
          progress.report(new vscode.LanguageModelTextPart(''));
          lastProgressReport = Date.now();
        }
      }

      // Si quedó razonamiento sin cerrar, descartarlo (ya se reportó)
      isReasoningBlock = false;

      if (!totalText && reportedChunks === 0) {
        this.outputChannel.appendLine(`[${entry.serverName}] WARNING: No text in response`);
      }

      this.outputChannel.appendLine(`[${entry.serverName}] Response complete (${totalText.length} chars, ${reportedChunks} chunks)`);
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

  showOutput(): void { this.outputChannel.show(); }
  dispose(): void {
    this.outputChannel.dispose();
    this._onDidChangeLanguageModelChatInformation.dispose();
    this._onDidChangeRequestState.dispose();
  }
}
