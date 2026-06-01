import * as vscode from 'vscode';
import { StatusSnapshot } from '../client/types';

type StatusBarState =
  | { kind: 'probing' }
  | { kind: 'idle'; modelCount: number }
  | { kind: 'noModels' }
  | { kind: 'error'; errorMessage: string }
  | { kind: 'streaming'; modelId: string; modelName: string }
  | { kind: 'responded'; modelId: string; modelName: string };

function renderStatusBarText(state: StatusBarState): string {
  switch (state.kind) {
    case 'probing':
      return '$(sync~spin) Zen';
    case 'idle':
      return `$(check) Zen`;
    case 'noModels':
      return '$(warning) Zen';
    case 'error':
      return '$(error) Zen';
    case 'streaming':
      return `$(loading~spin) Zen`;
    case 'responded':
      return '$(check) Zen';
  }
}

function renderTooltip(snapshot: StatusSnapshot): string {
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

  // Session stats
  if (snapshot.sessionStats.requestCount > 0) {
    lines.push('**Session**');
    lines.push(`${snapshot.sessionStats.requestCount} requests`);
    lines.push(`${snapshot.sessionStats.totalTokens.total.toLocaleString()} tokens`);
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
  private respondedRevertTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly getSnapshot: () => StatusSnapshot
  ) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.name = 'OpenCode Zen';
    this.item.command = 'opencode-zen.refreshModels';
    this.render();
  }

  show(): void {
    this.item.show();
  }

  hide(): void {
    this.item.hide();
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
    this.item.text = renderStatusBarText(this.state);
    const snapshot = this.getSnapshot();
    const md = new vscode.MarkdownString(renderTooltip(snapshot));
    md.isTrusted = true;
    md.supportThemeIcons = true;
    md.supportHtml = false;
    this.item.tooltip = md;
  }
}
