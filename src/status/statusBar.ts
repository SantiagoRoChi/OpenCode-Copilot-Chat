import * as vscode from 'vscode';
import { StatusSnapshot } from '../client/types';
import { UsageStats } from '../usage/UsageTracker';

type StatusBarState =
  | { kind: 'probing' }
  | { kind: 'idle'; modelCount: number }
  | { kind: 'noModels' }
  | { kind: 'error'; errorMessage: string }
  | { kind: 'streaming'; modelId: string; modelName: string }
  | { kind: 'responded'; modelId: string; modelName: string };

function renderStatusBarText(state: StatusBarState, usageStats?: UsageStats): string {
  // Build Go burn-rate indicator if available
  let goBurnRate = '';
  if (usageStats?.goUsage) {
    const go = usageStats.goUsage;
    const warn = go.session.percent > 80 || go.weekly.percent > 80 || go.monthly.percent > 80;
    const icon = warn ? '⚠️' : '🚀';
    goBurnRate = ` ${icon}Go:${go.session.percent}%·${go.weekly.percent}%·${go.monthly.percent}%`;
  }

  const usageText = usageStats && usageStats.totalRequests > 0
    ? ` (${usageStats.totalRequests} req · $${usageStats.totalCost.toFixed(2)} · ${formatTokens(usageStats.totalTokens.total)})`
    : '';

  switch (state.kind) {
    case 'probing':
      return `$(sync~spin) Zen${goBurnRate}${usageText}`;
    case 'idle':
      return `$(check) Zen${goBurnRate}${usageText}`;
    case 'noModels':
      return `$(warning) Zen${goBurnRate}${usageText}`;
    case 'error':
      return `$(error) Zen${goBurnRate}${usageText}`;
    case 'streaming':
      return `$(loading~spin) Zen${goBurnRate}${usageText}`;
    case 'responded':
      return `$(check) Zen${goBurnRate}${usageText}`;
  }
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
  return tokens.toString();
}

function renderTooltip(snapshot: StatusSnapshot, usageStats?: UsageStats): string {
  const lines: string[] = [];
  lines.push('**OpenCode Zen**');
  lines.push('');

  // Connection
  switch (snapshot.connection.state) {
    case 'ok':
      lines.push('$(check) Connected');
      break;
    case 'error':
      lines.push(`$(error) Error: ${snapshot.connection.errorMessage || 'Unknown'}`);
      break;
    case 'noModels':
      lines.push('$(warning) No models available');
      break;
    case 'unknown':
      lines.push('$(question) Connection unknown');
      break;
  }
  lines.push('');

  // Models
  lines.push(`**${snapshot.models.length} models** available`);
  const freeCount = snapshot.models.filter(m => m.capabilityLabels.includes('free')).length;
  if (freeCount > 0) {
    lines.push(`${freeCount} free models`);
  }
  lines.push('');

  // Session stats from snapshot
  if (snapshot.sessionStats.requestCount > 0) {
    lines.push('**Session**');
    lines.push(`${snapshot.sessionStats.requestCount} requests`);
    lines.push(`${snapshot.sessionStats.totalTokens.total.toLocaleString()} tokens`);
    lines.push('');
  }

  // Usage stats from tracker
  if (usageStats && usageStats.totalRequests > 0) {
    lines.push('**Usage**');
    lines.push(`${usageStats.totalRequests} requests · ${usageStats.totalTokens.total.toLocaleString()} tokens · $${usageStats.totalCost.toFixed(4)}`);
    if (Object.keys(usageStats.byProvider).length > 0) {
      for (const [provider, data] of Object.entries(usageStats.byProvider)) {
        const name = provider === 'opencode-go' ? 'Go' : 
                     provider === 'opencode-free' ? 'Free' :
                     provider === 'lmstudio' ? 'LM Studio' :
                     provider === 'ollama-plus' ? 'Ollama' : 'Zen';
        lines.push(`  ${name}: ${data.requests} req · $${data.cost.toFixed(4)}`);
      }
    }
    lines.push('');
  }

  // Go burn-rate details
  if (usageStats?.goUsage) {
    const go = usageStats.goUsage;
    lines.push('**🚀 Go Subscription Usage**');
    lines.push(`  Session (5h): ${go.session.percent}% · $${go.session.spent.toFixed(2)}/$${go.session.limit}`);
    lines.push(`  Weekly:       ${go.weekly.percent}% · $${go.weekly.spent.toFixed(2)}/$${go.weekly.limit}`);
    lines.push(`  Monthly:      ${go.monthly.percent}% · $${go.monthly.spent.toFixed(2)}/$${go.monthly.limit}`);
    if (go.today.requests > 0) {
      lines.push(`  Today: $${go.today.cost.toFixed(2)} · ${go.today.requests} req`);
    }
    lines.push('');
  }

  // Last request
  if (snapshot.lastRequest) {
    const ago = formatTimeAgo(snapshot.lastRequest.completedAt, snapshot.now);
    lines.push('**Last Request**');
    lines.push(`${snapshot.lastRequest.modelName} · ${ago}`);
    if (snapshot.lastRequest.usage) {
      lines.push(`${snapshot.lastRequest.usage.total.toLocaleString()} tokens`);
    }
    lines.push('');
  }

  // Features
  lines.push('**Features**');
  lines.push(`Tool calling: ${snapshot.features.toolCalling ? 'on' : 'off'}`);
  lines.push(`Vision: ${snapshot.features.imageInput ? 'on' : 'off'}`);

  return lines.join('\n');
}

function formatTimeAgo(past: number, now: number): string {
  const diff = Math.max(0, now - past);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export class StatusBarManager implements vscode.Disposable {
  private item: vscode.StatusBarItem;
  private state: StatusBarState = { kind: 'probing' };
  private usageStats?: UsageStats;
  private respondedRevertTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly getSnapshot: () => StatusSnapshot
  ) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.name = 'OpenCode Zen';
    this.item.command = 'opencode-zen.showUsage';
    this.render();
  }

  show(): void {
    this.item.show();
  }

  hide(): void {
    this.item.hide();
  }

  updateUsage(stats: UsageStats): void {
    this.usageStats = stats;
    this.render();
  }

  setIdle(modelCount: number): void {
    this.cancelRespondedRevert();
    this.state = { kind: 'idle', modelCount };
    this.render();
  }

  setNoModels(): void {
    this.cancelRespondedRevert();
    this.state = { kind: 'noModels' };
    this.render();
  }

  setError(errorMessage: string): void {
    this.cancelRespondedRevert();
    this.state = { kind: 'error', errorMessage };
    this.render();
  }

  setStreaming(modelId: string, modelName: string): void {
    this.cancelRespondedRevert();
    this.state = { kind: 'streaming', modelId, modelName };
    this.render();
  }

  setResponded(modelId: string, modelName: string): void {
    this.cancelRespondedRevert();
    this.state = { kind: 'responded', modelId, modelName };
    this.render();
    this.respondedRevertTimer = setTimeout(() => {
      const snapshot = this.getSnapshot();
      this.state = { kind: 'idle', modelCount: snapshot.models.length };
      this.render();
    }, 10000);
  }

  refreshTooltip(): void {
    this.render();
  }

  dispose(): void {
    this.cancelRespondedRevert();
    this.item.dispose();
  }

  private cancelRespondedRevert(): void {
    if (this.respondedRevertTimer) {
      clearTimeout(this.respondedRevertTimer);
      this.respondedRevertTimer = undefined;
    }
  }

  private render(): void {
    this.item.text = renderStatusBarText(this.state, this.usageStats);
    const snapshot = this.getSnapshot();
    const md = new vscode.MarkdownString(renderTooltip(snapshot, this.usageStats));
    md.isTrusted = true;
    md.supportThemeIcons = true;
    md.supportHtml = false;
    this.item.tooltip = md;
  }
}
