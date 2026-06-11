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
} from '../utils/tokenEstimate';

// SDK opencode — ESM puro. @ts-ignore evita el error de moduleResolution: node.
// esbuild detecta el import dinámico y lo bundleiza correctamente.
let sdkModule: any;

async function getSdk(): Promise<any> {
  if (!sdkModule) {
    // @ts-ignore
    sdkModule = await import('@opencode-ai/sdk');
  }
  return sdkModule;
}

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
    _options: { silent: boolean; configuration?: { [key: string]: unknown } },
    _token: vscode.CancellationToken
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
    _options: vscode.ProvideLanguageModelChatResponseOptions,
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
          type: 'text' as const,
          text: typeof m.content === 'string' ? m.content : m.content.map((c: any) => c.text || '').join(''),
        }))
        .filter((p: any) => p.text);

      // ── SDK opencode: streaming real vía SSE ──
      const sdk = await getSdk();
      const { createOpencodeClient } = sdk;

      // Auth del servidor — pasamos headers directamente para compatibilidad Basic/Bearer
      const client = createOpencodeClient({
        baseUrl: entry.baseUrl,
        headers: entry.client.buildHeaders(),
      });

      this.outputChannel.appendLine(`[${entry.serverName}] SDK client created for ${entry.baseUrl}`);

      // 1. Crear sesión
      const sessionRes = await client.session.create({
        body: { title: `VS Code: ${modelName}` },
      });
      if (sessionRes.error) {
        throw new Error(`Session create failed: ${JSON.stringify(sessionRes.error)}`);
      }
      const sessionId = (sessionRes.data as any)?.id;
      if (!sessionId) throw new Error('Session created but no ID returned');
      this.outputChannel.appendLine(`[${entry.serverName}] Session: ${sessionId}`);

      // 2. Iniciar consumidor SSE de eventos globales ANTES de enviar el mensaje
      const sseRes = await client.global.event({});
      const eventStream = sseRes.stream;

      // 3. Enviar mensaje (async — no esperamos la respuesta completa)
      const promptRes = await client.session.promptAsync({
        path: { id: sessionId },
        body: {
          model: { providerID: info?.providerID || 'opencode', modelID: modelId },
          parts: textParts,
        },
      });
      if (promptRes.error) {
        throw new Error(`Prompt failed: ${JSON.stringify(promptRes.error)}`);
      }
      this.outputChannel.appendLine(`[${entry.serverName}] Prompt async sent`);

      // 4. Consumir SSE en tiempo real y streamear a VS Code
      let reportedChunks = 0;
      let lastProgressReport = Date.now();
      let isReasoningBlock = false;
      let reasoningBuffer = '';
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

      for await (const event of eventStream) {
        if (token.isCancellationRequested) break;

        const ev = event as any;
        const type = ev.type;

        // Solo nos interesan eventos de la sesión actual
        if (ev.properties?.sessionID && ev.properties.sessionID !== sessionId) continue;

        switch (type) {
          case 'message.part.updated': {
            const part = ev.properties?.part;
            const delta = ev.properties?.delta;
            if (!part) break;

            switch (part.type) {
              case 'text': {
                const text = delta ?? part.text ?? '';
                if (text) {
                  progress.report(new vscode.LanguageModelTextPart(text));
                  reportedChunks++;
                  lastProgressReport = Date.now();
                }
                break;
              }
              case 'reasoning': {
                const text = delta ?? part.text ?? '';
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
              case 'tool': {
                flushReasoning();
                const toolPart = part as any;
                if (toolPart.state?.status === 'pending') {
                  progress.report(new vscode.LanguageModelToolCallPart(
                    toolPart.callID || `call_${Date.now()}`,
                    toolPart.tool || 'unknown',
                    toolPart.state.input || {}
                  ));
                  reportedChunks++;
                }
                break;
              }
              case 'step-finish': {
                flushReasoning();
                expireReasoning();
                const tokens = part.tokens;
                if (tokens) {
                  this.recordUsage(tokens, entry, modelId, modelName);
                }
                break;
              }
              case 'step-start': {
                expireReasoning();
                isReasoningBlock = true;
                reasoningBuffer = '';
                break;
              }
            }
            break;
          }

          case 'message.updated': {
            const msg = ev.properties?.info;
            if (msg?.error) {
              throw new Error(msg.error.message || 'Server error');
            }
            if (msg?.finish) {
              flushReasoning();
              expireReasoning();
            }
            break;
          }

          case 'session.error': {
            const err = ev.properties?.error;
            if (err) throw new Error(err.message || 'Session error');
            break;
          }

          case 'session.idle': {
            // Sesión terminó de procesar
            flushReasoning();
            expireReasoning();
            break;
          }
        }

        // Heartbeat periódico para mantener vivo el chat
        if (reportedChunks > 0 && Date.now() - lastProgressReport > 2500) {
          progress.report(new vscode.LanguageModelTextPart(''));
          lastProgressReport = Date.now();
        }
      }

      flushReasoning();
      this.outputChannel.appendLine(`[${entry.serverName}] Response complete (${reportedChunks} chunks streamed)`);

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
