import { EventEmitter, Event, CancellationToken, workspace, languages, DiagnosticSeverity, Diagnostic, Disposable } from 'vscode';
import { ContextProvider, ContextItem } from './types';

const severityLabel: Record<DiagnosticSeverity, string> = {
  [DiagnosticSeverity.Error]: 'error',
  [DiagnosticSeverity.Warning]: 'warning',
  [DiagnosticSeverity.Information]: 'info',
  [DiagnosticSeverity.Hint]: 'hint',
};

function formatDiagnostic(d: Diagnostic): string {
  const sev = severityLabel[d.severity] ?? 'unknown';
  const range = `${d.range.start.line + 1}:${d.range.start.character + 1}`;
  const msg = d.message.replace(/\n/g, ' | ');
  const code = typeof d.code === 'object' && d.code?.value ? d.code.value : d.code;
  return `  ${sev} at ${range}${code ? ` [${code}]` : ''}: ${msg}`;
}

export class DiagnosticsProvider implements ContextProvider {
  private readonly _onDidChange = new EventEmitter<void>();
  readonly onDidChange: Event<void> = this._onDidChange.event;

  private _disposable: Disposable;

  constructor() {
    this._disposable = languages.onDidChangeDiagnostics(() => {
      this._onDidChange.fire();
    });
  }

  dispose(): void {
    this._disposable.dispose();
    this._onDidChange.dispose();
  }

  async provideContext(token: CancellationToken): Promise<ContextItem[]> {
    if (token.isCancellationRequested) return [];

    const items: ContextItem[] = [];
    const workspaceFolders = workspace.workspaceFolders;
    if (!workspaceFolders) return [];

    const wsRoots = workspaceFolders.map(f => f.uri.toString());

    for (const [uri, diags] of languages.getDiagnostics()) {
      if (token.isCancellationRequested) break;

      if (!wsRoots.some(root => uri.toString().startsWith(root))) continue;

      if (diags.length === 0) continue;

      const errors = diags.filter(d => d.severity === DiagnosticSeverity.Error);
      const warnings = diags.filter(d => d.severity === DiagnosticSeverity.Warning);
      const others = diags.filter(d => d.severity !== DiagnosticSeverity.Error && d.severity !== DiagnosticSeverity.Warning);

      const lines: string[] = [];
      if (errors.length > 0) {
        lines.push(`  Errors (${errors.length}):`);
        for (const e of errors) lines.push(formatDiagnostic(e));
      }
      if (warnings.length > 0) {
        lines.push(`  Warnings (${warnings.length}):`);
        for (const w of warnings) lines.push(formatDiagnostic(w));
      }
      if (others.length > 0 && (errors.length + warnings.length) < 5) {
        lines.push(`  Other (${others.length}):`);
        for (const o of others.slice(0, 10)) lines.push(formatDiagnostic(o));
      }

      if (lines.length === 0) continue;

      const filePath = workspace.asRelativePath(uri);
      items.push({
        kind: 'diagnostics',
        label: `Diagnostics: ${filePath}`,
        content: `File: ${filePath}\n${lines.join('\n')}`,
        priority: errors.length > 0 ? 80 : 40,
      });
    }

    items.sort((a, b) => b.priority - a.priority);

    const maxChars = 4000;
    const trimmed: ContextItem[] = [];
    let total = 0;
    for (const item of items) {
      if (total + item.content.length > maxChars) break;
      trimmed.push(item);
      total += item.content.length;
    }

    return trimmed;
  }
}
