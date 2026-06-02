import * as vscode from 'vscode';
import { TokenUsage, SessionStats, ModelSummary } from '../client/types';

export interface UsageRecord {
  timestamp: number;
  modelId: string;
  modelName: string;
  provider: string;
  usage: TokenUsage;
  requestDuration?: number;
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
    modelId: string,
    modelName: string,
    provider: string,
    usage: TokenUsage,
    duration?: number
  ): void {
    this.records.push({
      timestamp: Date.now(),
      modelId,
      modelName,
      provider,
      usage,
      requestDuration: duration,
    });
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

      // By model
      const modelStats = byModel.get(record.modelId) || { requests: 0, tokens: { prompt: 0, completion: 0, total: 0 } };
      modelStats.requests++;
      modelStats.tokens.prompt += record.usage.prompt;
      modelStats.tokens.completion += record.usage.completion;
      modelStats.tokens.total += record.usage.total;
      byModel.set(record.modelId, modelStats);

      // By provider
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

  // Summary
  lines.push('📊 SUMMARY');
  lines.push('─────────────────────────────────────────────────────────────');
  lines.push(`  Total Requests:  ${stats.totalRequests}`);
  lines.push(`  Total Tokens:    ${stats.totalTokens.total.toLocaleString()}`);
  lines.push(`    ├─ Prompt:     ${stats.totalTokens.prompt.toLocaleString()}`);
  lines.push(`    └─ Completion: ${stats.totalTokens.completion.toLocaleString()}`);
  lines.push('');

  // By Provider
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

  // By Model
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

  // Recent History
  if (stats.history.length > 0) {
    lines.push('📝 RECENT HISTORY (last 10)');
    lines.push('─────────────────────────────────────────────────────────────');
    const recent = stats.history.slice(-10).reverse();
    for (const record of recent) {
      const time = new Date(record.timestamp).toLocaleTimeString();
      const duration = record.requestDuration ? ` (${record.requestDuration}ms)` : '';
      lines.push(`  ${time} | ${record.modelName} | ${record.usage.total.toLocaleString()} tokens${duration}`);
    }
  }

  return lines.join('\n');
}
