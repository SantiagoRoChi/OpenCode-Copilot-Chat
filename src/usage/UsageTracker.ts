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
  byModel: Record<string, { requests: number; tokens: TokenUsage }>;
  byProvider: Record<string, { requests: number; tokens: TokenUsage }>;
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
    const byModel: Record<string, { requests: number; tokens: TokenUsage }> = {};
    const byProvider: Record<string, { requests: number; tokens: TokenUsage }> = {};

    for (const record of this.records) {
      totalTokens.prompt += record.usage.prompt;
      totalTokens.completion += record.usage.completion;
      totalTokens.total += record.usage.total;

      if (!byModel[record.modelId]) {
        byModel[record.modelId] = { requests: 0, tokens: { prompt: 0, completion: 0, total: 0 } };
      }
      byModel[record.modelId].requests++;
      byModel[record.modelId].tokens.prompt += record.usage.prompt;
      byModel[record.modelId].tokens.completion += record.usage.completion;
      byModel[record.modelId].tokens.total += record.usage.total;

      if (!byProvider[record.provider]) {
        byProvider[record.provider] = { requests: 0, tokens: { prompt: 0, completion: 0, total: 0 } };
      }
      byProvider[record.provider].requests++;
      byProvider[record.provider].tokens.prompt += record.usage.prompt;
      byProvider[record.provider].tokens.completion += record.usage.completion;
      byProvider[record.provider].tokens.total += record.usage.total;
    }

    return {
      totalRequests: this.records.length,
      totalTokens,
      byModel,
      byProvider,
      history: [...this.records],
    };
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

  if (Object.keys(stats.byProvider).length > 0) {
    lines.push('🏢 BY PROVIDER');
    lines.push('─────────────────────────────────────────────────────────────');
    for (const [provider, data] of Object.entries(stats.byProvider)) {
      const name = provider === 'opencode-go' ? 'OpenCode Go' : 'OpenCode Zen';
      lines.push(`  ${name}:`);
      lines.push(`    Requests: ${data.requests} | Tokens: ${data.tokens.total.toLocaleString()}`);
    }
    lines.push('');
  }

  if (stats.history.length > 0) {
    lines.push('🔀 BY SESSION');
    lines.push('─────────────────────────────────────────────────────────────');
    const sessionMap: Record<string, { sid: string; count: number; tokens: TokenUsage }> = {};
    for (const record of stats.history) {
      if (!sessionMap[record.sessionId]) {
        sessionMap[record.sessionId] = { sid: record.sessionId, count: 0, tokens: { prompt: 0, completion: 0, total: 0 } };
      }
      sessionMap[record.sessionId].count++;
      sessionMap[record.sessionId].tokens.prompt += record.usage.prompt;
      sessionMap[record.sessionId].tokens.completion += record.usage.completion;
      sessionMap[record.sessionId].tokens.total += record.usage.total;
    }
    const sorted = Object.values(sessionMap).sort((a, b) => b.tokens.total - a.tokens.total);
    for (const s of sorted) {
      lines.push(`  Session ${s.sid.slice(0, 8)}…: ${s.count} req · ${s.tokens.total.toLocaleString()} tok`);
    }
    lines.push('');
  }

  if (Object.keys(stats.byModel).length > 0) {
    lines.push('🤖 BY MODEL');
    lines.push('─────────────────────────────────────────────────────────────');
    const sortedModels = Object.entries(stats.byModel)
      .map(([id, data]) => ({ id, data }))
      .sort((a, b) => b.data.tokens.total - a.data.tokens.total);

    for (const m of sortedModels) {
      const pct = stats.totalTokens.total > 0
        ? ((m.data.tokens.total / stats.totalTokens.total) * 100).toFixed(1)
        : '0.0';
      lines.push(`  ${m.id}:`);
      lines.push(`    ${m.data.requests} requests | ${m.data.tokens.total.toLocaleString()} tokens (${pct}%)`);
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
