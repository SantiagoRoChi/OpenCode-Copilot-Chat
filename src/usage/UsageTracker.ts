import * as vscode from 'vscode';
import { TokenUsage, RequestMeta } from '../client/types';

export interface UsageRecord {
  requestId: string;
  sessionId: string;
  timestamp: number;
  modelId: string;
  modelName: string;
  provider: string;
  usage: TokenUsage;
  requestDuration?: number;
  meta?: RequestMeta;
}

export interface UsageStats {
  totalRequests: number;
  totalTokens: TokenUsage;
  byModel: Map<string, { requests: number; tokens: TokenUsage }>;
  byProvider: Map<string, { requests: number; tokens: TokenUsage }>;
  history: UsageRecord[];
}

export class UsageTracker {
  private records: UsageRecord[] = [];
  private readonly _onDidChangeUsage = new vscode.EventEmitter<UsageStats>();
  readonly onDidChangeUsage = this._onDidChangeUsage.event;

  recordRequest(
    requestId: string,
    sessionId: string,
    modelId: string,
    modelName: string,
    provider: string,
    usage: TokenUsage,
    duration?: number,
    meta?: RequestMeta
  ): void {
    const existing = this.records.findIndex(r => r.requestId === requestId);
    if (existing >= 0) {
      this.records[existing] = {
        timestamp: Date.now(),
        requestId,
        sessionId,
        modelId,
        modelName,
        provider,
        usage,
        requestDuration: duration,
        meta,
      };
    } else {
      this.records.push({
        timestamp: Date.now(),
        requestId,
        sessionId,
        modelId,
        modelName,
        provider,
        usage,
        requestDuration: duration,
        meta,
      });
    }
    this._onDidChangeUsage.fire(this.getStats());
  }

  getStats(): UsageStats {
    const totalTokens: TokenUsage = { prompt: 0, completion: 0, total: 0 };
    const byModel = new Map<string, { requests: number; tokens: TokenUsage }>();
    const byProvider = new Map<string, { requests: number; tokens: TokenUsage }>();

    for (const record of this.records) {
      totalTokens.prompt += record.usage.prompt;
      totalTokens.completion += record.usage.completion;
      totalTokens.total += record.usage.total;

      const modelStats = byModel.get(record.modelId) || { requests: 0, tokens: { prompt: 0, completion: 0, total: 0 } };
      modelStats.requests++;
      modelStats.tokens.prompt += record.usage.prompt;
      modelStats.tokens.completion += record.usage.completion;
      modelStats.tokens.total += record.usage.total;
      byModel.set(record.modelId, modelStats);

      const providerStats = byProvider.get(record.provider) || { requests: 0, tokens: { prompt: 0, completion: 0, total: 0 } };
      providerStats.requests++;
      providerStats.tokens.prompt += record.usage.prompt;
      providerStats.tokens.completion += record.usage.completion;
      providerStats.tokens.total += record.usage.total;
      byProvider.set(record.provider, providerStats);
    }

    return {
      totalRequests: this.records.length,
      totalTokens,
      byModel,
      byProvider,
      history: [...this.records],
    };
  }

  getSessions(): { sessionId: string; records: UsageRecord[]; tokens: TokenUsage }[] {
    const map = new Map<string, { sessionId: string; records: UsageRecord[]; tokens: TokenUsage }>();
    for (const record of this.records) {
      let session = map.get(record.sessionId);
      if (!session) {
        session = { sessionId: record.sessionId, records: [], tokens: { prompt: 0, completion: 0, total: 0 } };
        map.set(record.sessionId, session);
      }
      session.records.push(record);
      session.tokens.prompt += record.usage.prompt;
      session.tokens.completion += record.usage.completion;
      session.tokens.total += record.usage.total;
    }
    return Array.from(map.values()).sort((a, b) => b.records[0].timestamp - a.records[0].timestamp);
  }

  clear(): void {
    this.records = [];
    this._onDidChangeUsage.fire(this.getStats());
  }

  dispose(): void {
    this._onDidChangeUsage.dispose();
  }
}

export function formatUsageOutput(stats: UsageStats): string {
  const lines: string[] = [];
  lines.push('╔════════════════════════════════════════════════════════════╗');
  lines.push('║                  OPENCODE ZEN - USAGE STATS               ║');
  lines.push('╚════════════════════════════════════════════════════════════╝');
  lines.push('');

  lines.push('📊 SUMMARY');
  lines.push('─────────────────────────────────────────────────────────────');
  lines.push(`  Total Requests:  ${stats.totalRequests}`);
  lines.push(`  Total Tokens:    ${stats.totalTokens.total.toLocaleString()}`);
  lines.push(`    ├─ Prompt:     ${stats.totalTokens.prompt.toLocaleString()}`);
  lines.push(`    └─ Completion: ${stats.totalTokens.completion.toLocaleString()}`);
  lines.push('');

  if (stats.byProvider.size > 0) {
    lines.push('🏢 BY PROVIDER');
    lines.push('─────────────────────────────────────────────────────────────');
    for (const [provider, data] of stats.byProvider) {
      const name = provider === 'opencode-go' ? 'OpenCode Go' : 'OpenCode Zen';
      lines.push(`  ${name}:`);
      lines.push(`    Requests: ${data.requests} | Tokens: ${data.tokens.total.toLocaleString()}`);
    }
    lines.push('');
  }

  if (stats.history.length > 0) {
    lines.push('🔀 BY SESSION');
    lines.push('─────────────────────────────────────────────────────────────');
    const sessionMap = new Map<string, { sid: string; count: number; tokens: TokenUsage }>();
    for (const record of stats.history) {
      let s = sessionMap.get(record.sessionId);
      if (!s) {
        s = { sid: record.sessionId, count: 0, tokens: { prompt: 0, completion: 0, total: 0 } };
        sessionMap.set(record.sessionId, s);
      }
      s.count++;
      s.tokens.prompt += record.usage.prompt;
      s.tokens.completion += record.usage.completion;
      s.tokens.total += record.usage.total;
    }
    const sorted = Array.from(sessionMap.values()).sort((a, b) => b.tokens.total - a.tokens.total);
    for (const s of sorted) {
      lines.push(`  Session ${s.sid.slice(0, 8)}…: ${s.count} req · ${s.tokens.total.toLocaleString()} tok`);
    }
    lines.push('');
  }

  if (stats.byModel.size > 0) {
    lines.push('🤖 BY MODEL');
    lines.push('─────────────────────────────────────────────────────────────');
    const sortedModels = Array.from(stats.byModel.entries())
      .sort((a, b) => b[1].tokens.total - a[1].tokens.total);

    for (const [modelId, data] of sortedModels) {
      const pct = stats.totalTokens.total > 0
        ? ((data.tokens.total / stats.totalTokens.total) * 100).toFixed(1)
        : '0.0';
      lines.push(`  ${modelId}:`);
      lines.push(`    ${data.requests} requests | ${data.tokens.total.toLocaleString()} tokens (${pct}%)`);
    }
    lines.push('');
  }

  if (stats.history.length > 0) {
    lines.push('📝 RECENT HISTORY (last 10)');
    lines.push('─────────────────────────────────────────────────────────────');
    const recent = stats.history.slice(-10).reverse();
    for (const record of recent) {
      const time = new Date(record.timestamp).toLocaleTimeString();
      const sid = record.sessionId.slice(0, 8);
      const duration = record.requestDuration ? ` (${record.requestDuration}ms)` : '';
      lines.push(`  ${time} | sid:${sid} | ${record.modelName} | ${record.usage.total.toLocaleString()} tok${duration}`);
    }
  }

  return lines.join('\n');
}
