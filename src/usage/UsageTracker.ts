import * as vscode from 'vscode';
import { TokenUsage, RequestMeta } from '../client/types';

/**
 * Pricing information for a model (per 1M tokens).
 */
export interface ModelPricing {
  inputTokenPrice?: number;   // $ per 1M tokens
  outputTokenPrice?: number;  // $ per 1M tokens
  reasoningTokenPrice?: number; // $ per 1M tokens
  cachedTokenPrice?: number;  // $ per 1M tokens (often 10% of input)
  currency?: string;
}

/**
 * Extended usage record with cost tracking.
 */
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
  /** Estimated cost in USD for this request */
  cost?: number;
}

/**
 * Period-based usage summary (5h, weekly, monthly).
 */
export interface PeriodUsage {
  spent: number;      // USD spent
  limit: number;      // USD limit
  percent: number;    // 0-100 (or >100 if over limit)
  resetsAt: Date;
}

/**
 * Go subscription limits in USD.
 * From https://opencode.ai/docs/go
 */
export const GO_LIMITS = {
  session: 12,  // $12 per rolling 5-hour window
  weekly: 30,   // $30 per week (Mon-Mon UTC)
  monthly: 60,  // $60 per month
};

export interface UsageStats {
  totalRequests: number;
  totalTokens: TokenUsage;
  totalCost: number;
  byModel: Record<string, { requests: number; tokens: TokenUsage; cost: number }>;
  byProvider: Record<string, { requests: number; tokens: TokenUsage; cost: number }>;
  history: UsageRecord[];
  /** Go subscription usage summary (only for opencode-go provider) */
  goUsage?: {
    session: PeriodUsage;
    weekly: PeriodUsage;
    monthly: PeriodUsage;
    today: { cost: number; requests: number; tokens: number };
    yesterday: { cost: number; requests: number; tokens: number };
  };
}

/**
 * Estimate cost for a request based on token usage and model pricing.
 * Formula: (billablePrompt × input + completion × output) / 1_000_000
 */
export function estimateCost(
  promptTokens: number,
  completionTokens: number,
  pricing: ModelPricing,
  cachedTokens?: number
): number {
  if (!pricing) return 0;

  const billablePrompt = Math.max(0, promptTokens - (cachedTokens ?? 0));
  const inputCost = billablePrompt * (pricing.inputTokenPrice ?? 0) / 1_000_000;
  const outputCost = completionTokens * (pricing.outputTokenPrice ?? 0) / 1_000_000;
  const cachedCost = (cachedTokens ?? 0) * (pricing.cachedTokenPrice ?? (pricing.inputTokenPrice ?? 0) * 0.1) / 1_000_000;

  return inputCost + outputCost + cachedCost;
}

// ─── Time window helpers ─────────────────────────────────────────────────────

function startOfUtcDay(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function startOfUtcWeek(ms: number): number {
  const day = startOfUtcDay(ms);
  const d = new Date(day);
  const dayOfWeek = d.getUTCDay();
  return day - dayOfWeek * 24 * 60 * 60 * 1000;
}

/** Rolling 5h reset: oldest entry in window + 5h */
function nextSessionReset(entries: UsageLogEntry[], nowMs: number): Date {
  const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
  const sessionStart = nowMs - FIVE_HOURS_MS;
  let oldest = nowMs;
  for (const e of entries) {
    if (e.timestamp >= sessionStart && e.timestamp < nowMs && e.timestamp < oldest) {
      oldest = e.timestamp;
    }
  }
  return new Date(oldest + FIVE_HOURS_MS);
}

/**
 * Simple in-memory usage log entry for cost tracking.
 */
interface UsageLogEntry {
  timestamp: number;
  modelId: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  cost: number;
}

export class UsageTracker {
  private records: UsageRecord[] = [];
  private costEntries: UsageLogEntry[] = [];  // For cost calculation
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
    meta?: RequestMeta,
    pricing?: ModelPricing
  ): void {
    // Calculate cost if pricing is available
    const cost = pricing ? estimateCost(usage.prompt, usage.completion, pricing) : 0;

    const existing = this.records.findIndex(r => r.requestId === requestId);
    const record: UsageRecord = {
      timestamp: Date.now(),
      requestId,
      sessionId,
      modelId,
      modelName,
      provider,
      usage,
      requestDuration: duration,
      meta,
      cost,
    };

    if (existing >= 0) {
      this.records[existing] = record;
    } else {
      this.records.push(record);
    }

    // Track cost entries for period calculation
    this.costEntries.push({
      timestamp: record.timestamp,
      modelId,
      provider,
      promptTokens: usage.prompt,
      completionTokens: usage.completion,
      cost,
    });

    // Prune old entries (keep last 31 days)
    const cutoff = Date.now() - 31 * 24 * 60 * 60 * 1000;
    this.costEntries = this.costEntries.filter(e => e.timestamp >= cutoff);

    this._onDidChangeUsage.fire(this.getStats());
  }

  getStats(): UsageStats {
    const totalTokens: TokenUsage = { prompt: 0, completion: 0, total: 0 };
    let totalCost = 0;
    const byModel: Record<string, { requests: number; tokens: TokenUsage; cost: number }> = {};
    const byProvider: Record<string, { requests: number; tokens: TokenUsage; cost: number }> = {};

    for (const record of this.records) {
      totalTokens.prompt += record.usage.prompt;
      totalTokens.completion += record.usage.completion;
      totalTokens.total += record.usage.total;
      totalCost += record.cost ?? 0;

      if (!byModel[record.modelId]) {
        byModel[record.modelId] = { requests: 0, tokens: { prompt: 0, completion: 0, total: 0 }, cost: 0 };
      }
      byModel[record.modelId].requests++;
      byModel[record.modelId].tokens.prompt += record.usage.prompt;
      byModel[record.modelId].tokens.completion += record.usage.completion;
      byModel[record.modelId].tokens.total += record.usage.total;
      byModel[record.modelId].cost += record.cost ?? 0;

      if (!byProvider[record.provider]) {
        byProvider[record.provider] = { requests: 0, tokens: { prompt: 0, completion: 0, total: 0 }, cost: 0 };
      }
      byProvider[record.provider].requests++;
      byProvider[record.provider].tokens.prompt += record.usage.prompt;
      byProvider[record.provider].tokens.completion += record.usage.completion;
      byProvider[record.provider].tokens.total += record.usage.total;
      byProvider[record.provider].cost += record.cost ?? 0;
    }

    // Calculate Go usage periods
    const goUsage = this.calculateGoUsage();

    return {
      totalRequests: this.records.length,
      totalTokens,
      totalCost: Math.round(totalCost * 10000) / 10000,
      byModel,
      byProvider,
      history: [...this.records],
      goUsage,
    };
  }

  /**
   * Calculate Go subscription usage for session/weekly/monthly periods.
   */
  private calculateGoUsage(): UsageStats['goUsage'] {
    const goEntries = this.costEntries.filter(e => e.provider === 'opencode-go');
    if (goEntries.length === 0) return undefined;

    const nowMs = Date.now();
    const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

    const dayMs = startOfUtcDay(nowMs);
    const yesterdayMs = dayMs - 24 * 60 * 60 * 1000;
    const weekMs = startOfUtcWeek(nowMs);
    const weekEnd = weekMs + WEEK_MS;

    // Calculate period costs
    let sessionCost = 0;
    let weeklyCost = 0;
    let monthlyCost = 0;
    let todayCost = 0;
    let todayReq = 0;
    let todayTokens = 0;
    let yestCost = 0;
    let yestReq = 0;
    let yestTokens = 0;

    for (const e of goEntries) {
      // Session: rolling 5h
      if (e.timestamp >= nowMs - FIVE_HOURS_MS && e.timestamp <= nowMs) {
        sessionCost += e.cost;
      }
      // Weekly: UTC week
      if (e.timestamp >= weekMs && e.timestamp <= nowMs) {
        weeklyCost += e.cost;
      }
      // Monthly: use first entry of month as anchor (simplified)
      if (e.timestamp >= dayMs - 30 * 24 * 60 * 60 * 1000 && e.timestamp <= nowMs) {
        monthlyCost += e.cost;
      }
      // Today
      if (e.timestamp >= dayMs) {
        todayCost += e.cost;
        todayReq++;
        todayTokens += e.promptTokens + e.completionTokens;
      }
      // Yesterday
      if (e.timestamp >= yesterdayMs && e.timestamp < dayMs) {
        yestCost += e.cost;
        yestReq++;
        yestTokens += e.promptTokens + e.completionTokens;
      }
    }

    const clamp = (v: number, limit: number) => Math.round((v / limit) * 100);

    return {
      session: {
        spent: Math.round(sessionCost * 10000) / 10000,
        limit: GO_LIMITS.session,
        percent: clamp(sessionCost, GO_LIMITS.session),
        resetsAt: nextSessionReset(goEntries, nowMs),
      },
      weekly: {
        spent: Math.round(weeklyCost * 10000) / 10000,
        limit: GO_LIMITS.weekly,
        percent: clamp(weeklyCost, GO_LIMITS.weekly),
        resetsAt: new Date(weekEnd),
      },
      monthly: {
        spent: Math.round(monthlyCost * 10000) / 10000,
        limit: GO_LIMITS.monthly,
        percent: clamp(monthlyCost, GO_LIMITS.monthly),
        resetsAt: new Date(dayMs + 30 * 24 * 60 * 60 * 1000), // Approximate
      },
      today: {
        cost: Math.round(todayCost * 10000) / 10000,
        requests: todayReq,
        tokens: todayTokens,
      },
      yesterday: {
        cost: Math.round(yestCost * 10000) / 10000,
        requests: yestReq,
        tokens: yestTokens,
      },
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

/**
 * Render a progress bar for percentage (0-100).
 */
function progressBar(percent: number): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round(clamped / 10);
  const empty = 10 - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

/**
 * Format cost as USD string.
 */
function fmtUsd(v: number): string {
  return `$${v.toFixed(2)}`;
}

/**
 * Format token count with K/M suffix.
 */
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
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
  lines.push(`  Total Cost:      $${stats.totalCost.toFixed(4)}`);
  lines.push('');

  // Go Usage Summary (if available)
  if (stats.goUsage) {
    const go = stats.goUsage;
    lines.push('🚀 OPENCODE GO USAGE');
    lines.push('─────────────────────────────────────────────────────────────');
    
    const sessionBar = progressBar(go.session.percent);
    const weeklyBar = progressBar(go.weekly.percent);
    const monthlyBar = progressBar(go.monthly.percent);
    
    lines.push(`  Session (5h):   ${sessionBar} ${go.session.percent}% · $${go.session.spent.toFixed(2)} / $${go.session.limit}`);
    lines.push(`  Weekly:         ${weeklyBar} ${go.weekly.percent}% · $${go.weekly.spent.toFixed(2)} / $${go.weekly.limit}`);
    lines.push(`  Monthly:        ${monthlyBar} ${go.monthly.percent}% · $${go.monthly.spent.toFixed(2)} / $${go.monthly.limit}`);
    lines.push('');
    
    if (go.today.requests > 0) {
      lines.push(`  Today:          $${go.today.cost.toFixed(2)} · ${go.today.requests} req · ${go.today.tokens.toLocaleString()} tokens`);
    }
    if (go.yesterday.requests > 0) {
      lines.push(`  Yesterday:      $${go.yesterday.cost.toFixed(2)} · ${go.yesterday.requests} req · ${go.yesterday.tokens.toLocaleString()} tokens`);
    }
    lines.push('');
  }

  if (Object.keys(stats.byProvider).length > 0) {
    lines.push('🏢 BY PROVIDER');
    lines.push('─────────────────────────────────────────────────────────────');
    for (const [provider, data] of Object.entries(stats.byProvider)) {
      const name = provider === 'opencode-go' ? 'OpenCode Go' : 
                   provider === 'opencode-free' ? 'OpenCode Free' :
                   provider === 'opencode-zen' ? 'OpenCode Zen' :
                   provider === 'lmstudio' ? 'LM Studio' :
                   provider === 'ollama-plus' ? 'Ollama' : provider;
      lines.push(`  ${name}:`);
      lines.push(`    Requests: ${data.requests} | Tokens: ${data.tokens.total.toLocaleString()} | Cost: $${data.cost.toFixed(4)}`);
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
