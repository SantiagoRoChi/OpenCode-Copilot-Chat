import * as vscode from 'vscode';
import { UsageStats } from './usageTracker';

export class UsageWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'opencode-zen-usage-view';
  private view?: vscode.WebviewView;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [],
    };

    webviewView.webview.html = this.getHtml();

    webviewView.webview.onDidReceiveMessage((message) => {
      if (message.command === 'refresh') {
        webviewView.webview.html = this.getHtml();
      }
    });
  }

  updateStats(stats: UsageStats): void {
    if (this.view) {
      this.view.webview.postMessage({ 
        type: 'update', 
        stats: {
          totalRequests: stats.totalRequests,
          totalTokens: stats.totalTokens,
          byModel: Array.from(stats.byModel.entries()).map(([id, data]) => ({
            id,
            requests: data.requests,
            tokens: data.tokens,
          })),
          byProvider: Array.from(stats.byProvider.entries()).map(([id, data]) => ({
            id: id === 'opencode-go' ? 'Go' : 'Zen',
            requests: data.requests,
            tokens: data.tokens,
          })),
        }
      });
    }
  }

  updateError(error: string): void {
    if (this.view) {
      this.view.webview.postMessage({ type: 'error', message: error });
    }
  }

  private getHtml(): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Usage Stats</title>
  <style>
    body { padding: 10px; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); }
    .card { background: var(--vscode-editor-inactiveSelectionBackground); border-radius: 6px; padding: 10px; margin-bottom: 8px; }
    .label { font-size: 11px; color: var(--vscode-descriptionForeground); }
    .value { font-size: 16px; font-weight: bold; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px; }
    .row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 11px; border-bottom: 1px solid var(--vscode-widget-border); }
    .empty { text-align: center; padding: 20px; color: var(--vscode-descriptionForeground); }
    .error { color: var(--vscode-errorForeground); background: var(--vscode-inputValidation-errorBackground); padding: 10px; border-radius: 4px; }
  </style>
</head>
<body>
  <div id="app">
    <div class="empty">No usage data yet.<br>Start chatting to see stats.</div>
  </div>
  <script>
    (function() {
      const app = document.getElementById('app');
      
      function formatNum(n) {
        if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
        if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
        return String(n);
      }

      window.addEventListener('message', function(event) {
        var msg = event.data;
        if (msg.type === 'error') {
          app.innerHTML = '<div class="error">Error: ' + msg.message + '</div>';
          return;
        }
        if (msg.type !== 'update' || !msg.stats) return;
        var s = msg.stats;
        if (s.totalRequests === 0) {
          app.innerHTML = '<div class="empty">No usage data yet.<br>Start chatting to see stats.</div>';
          return;
        }
        var h = '<div class="grid"><div class="card"><div class="label">Requests</div><div class="value">' + s.totalRequests + '</div></div>';
        h += '<div class="card"><div class="label">Tokens</div><div class="value">' + formatNum(s.totalTokens.total) + '</div></div></div>';
        h += '<div class="grid"><div class="card"><div class="label">Prompt</div><div class="value">' + formatNum(s.totalTokens.prompt) + '</div></div>';
        h += '<div class="card"><div class="label">Completion</div><div class="value">' + formatNum(s.totalTokens.completion) + '</div></div></div>';
        if (s.byProvider && s.byProvider.length > 0) {
          h += '<div style="font-weight:bold;margin-bottom:4px">By Provider</div>';
          s.byProvider.forEach(function(p) { h += '<div class="row"><span>' + p.id + '</span><span>' + p.requests + ' req</span></div>'; });
        }
        if (s.byModel && s.byModel.length > 0) {
          h += '<div style="font-weight:bold;margin:8px 0 4px">By Model</div>';
          s.byModel.sort(function(a,b) { return b.tokens.total - a.tokens.total; }).forEach(function(m) {
            h += '<div class="row"><span>' + m.id + '</span><span>' + formatNum(m.tokens.total) + '</span></div>';
          });
        }
        app.innerHTML = h;
      });
    })();
  </script>
</body>
</html>`;
  }
}
