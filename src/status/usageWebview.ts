import * as vscode from 'vscode';
import { UsageStats } from '../usage/UsageTracker';
import { ApiUsageResponse } from '../client/types';

export interface WebviewData {
  zenKey: string;
  goKey: string;
  zenUsage?: ApiUsageResponse;
  goUsage?: ApiUsageResponse;
  sessionStats: UsageStats;
}

export class UsageWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'opencode-zen-usage-view';
  private view?: vscode.WebviewView;
  private currentData?: WebviewData;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [] };
    webviewView.webview.html = this.getHtml();

    webviewView.webview.onDidReceiveMessage((message) => {
      if (message.command === 'refresh' && this.currentData) {
        webviewView.webview.postMessage({ type: 'update', data: this.currentData });
      }
      if (message.command === 'clear') {
        vscode.commands.executeCommand('opencode-zen.clearUsage');
      }
      if (message.command === 'configureZen') {
        vscode.commands.executeCommand('opencode-zen.configureZen');
      }
      if (message.command === 'configureGo') {
        vscode.commands.executeCommand('opencode-zen.configureGo');
      }
    });
  }

  update(data: WebviewData): void {
    this.currentData = data;
    if (this.view) {
      this.view.webview.postMessage({ type: 'update', data });
    }
  }

  private maskKey(key: string): string {
    if (!key) return 'Not configured';
    if (key.length <= 8) return '****';
    return `${key.slice(0, 6)}...${key.slice(-4)}`;
  }

  private getHtml(): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { padding: 12px; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); }
    h2 { font-size: 13px; font-weight: 600; margin: 12px 0 6px; color: var(--vscode-titleBar-activeForeground); }
    .section { background: var(--vscode-editor-inactiveSelectionBackground); border-radius: 6px; padding: 10px 12px; margin-bottom: 8px; }
    .row { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; font-size: 11px; }
    .row + .row { border-top: 1px solid var(--vscode-widget-border); }
    .label { color: var(--vscode-descriptionForeground); }
    .value { font-weight: 600; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 8px; }
    .card { background: var(--vscode-editor-inactiveSelectionBackground); border-radius: 6px; padding: 8px 10px; }
    .card-label { font-size: 10px; color: var(--vscode-descriptionForeground); }
    .card-value { font-size: 16px; font-weight: 700; }
    .key-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; font-size: 11px; }
    .key-status { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
    .key-status.active { background: #4ec9b0; }
    .key-status.inactive { background: #f48771; }
    .empty { text-align: center; padding: 20px; color: var(--vscode-descriptionForeground); }
    .btn { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 12px; border-radius: 4px; cursor: pointer; font-size: 11px; width: 100%; margin-top: 4px; }
    .btn:hover { background: var(--vscode-button-hoverBackground); }
    .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .bar { display: inline-block; height: 6px; background: var(--vscode-progressBar-background); border-radius: 3px; vertical-align: middle; margin-left: 6px; }
    .small { font-size: 10px; color: var(--vscode-descriptionForeground); }
  </style>
</head>
<body>
  <div id="app">
    <div class="empty">Loading usage data...</div>
  </div>
  <script>
    (function() {
      const app = document.getElementById('app');
      
      function formatNum(n) {
        if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
        if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
        return String(n);
      }
      
      function maskKey(key) {
        if (!key) return 'Not configured';
        if (key.length <= 8) return '****';
        return key.slice(0, 6) + '...' + key.slice(-4);
      }
      
      function providerName(id) {
        if (id === 'zen') return 'OpenCode Zen';
        if (id === 'go') return 'OpenCode Go';
        if (id === 'free') return 'OpenCode Free';
        return id;
      }
      
      function renderUsage(d) {
        const s = d.sessionStats;
        let h = '';
        
        // API Keys section
        h += '<h2>🔑 API Keys</h2>';
        h += '<div class="section">';
        h += '<div class="key-row"><div><span class="key-status ' + (d.zenKey ? 'active' : 'inactive') + '"></span><strong>Zen:</strong> ' + maskKey(d.zenKey) + '</div>';
        h += '<button class="btn btn-secondary" style="width:auto;padding:2px 8px" data-cmd="configureZen">Edit</button></div>';
        h += '<div class="key-row"><div><span class="key-status ' + (d.goKey ? 'active' : 'inactive') + '"></span><strong>Go:</strong> ' + maskKey(d.goKey) + '</div>';
        h += '<button class="btn btn-secondary" style="width:auto;padding:2px 8px" data-cmd="configureGo">Edit</button></div>';
        h += '</div>';
        
        // Account Balance
        if (d.zenUsage || d.goUsage) {
          h += '<h2>💰 Account Balance</h2>';
          h += '<div class="section">';
          if (d.zenUsage) {
            h += '<div class="row"><span class="label">Zen Balance</span><span class="value">$' + (d.zenUsage.balance ?? 'N/A') + '</span></div>';
          }
          if (d.goUsage) {
            h += '<div class="row"><span class="label">Go Used</span><span class="value">$' + (d.goUsage.used ?? 'N/A') + ' / $' + (d.goUsage.limit ?? 'N/A') + '</span></div>';
          }
          h += '</div>';
        }
        
        // Session stats
        h += '<h2>📈 Session Statistics</h2>';
        h += '<div class="grid">';
        h += '<div class="card"><div class="card-label">Requests</div><div class="card-value">' + s.totalRequests + '</div></div>';
        h += '<div class="card"><div class="card-label">Total Tokens</div><div class="card-value">' + formatNum(s.totalTokens.total) + '</div></div>';
        h += '</div>';
        h += '<div class="grid">';
        h += '<div class="card"><div class="card-label">Prompt</div><div class="card-value">' + formatNum(s.totalTokens.prompt) + '</div></div>';
        h += '<div class="card"><div class="card-label">Completion</div><div class="card-value">' + formatNum(s.totalTokens.completion) + '</div></div>';
        h += '</div>';
        
        // By Provider
        if (s.byProvider && s.byProvider.size > 0) {
          h += '<h2>📊 By Provider</h2>';
          h += '<div class="section">';
          const providers = Array.from(s.byProvider.entries()).map(([id, data]) => ({ id, data }));
          providers.sort((a, b) => b.data.tokens.total - a.data.tokens.total);
          providers.forEach(p => {
            h += '<div class="row"><span class="label">' + providerName(p.id) + '</span><span class="value">' + p.data.requests + ' req · ' + formatNum(p.data.tokens.total) + ' tok</span></div>';
          });
          h += '</div>';
        }
        
        // By Model (top 10)
        if (s.byModel && s.byModel.size > 0) {
          h += '<h2>🤖 By Model (Top 10)</h2>';
          h += '<div class="section">';
          const models = Array.from(s.byModel.entries())
            .map(([id, data]) => ({ id, data }))
            .sort((a, b) => b.data.tokens.total - a.data.tokens.total)
            .slice(0, 10);
          models.forEach(m => {
            const pct = s.totalTokens.total > 0 ? ((m.data.tokens.total / s.totalTokens.total) * 100).toFixed(1) : '0.0';
            h += '<div class="row"><span class="label" style="flex:1">' + m.id + '</span>';
            h += '<div style="flex:1"><div class="bar" style="width:' + pct + '%"></div></div>';
            h += '<span class="value" style="width:60px;text-align:right">' + formatNum(m.data.tokens.total) + '</span></div>';
          });
          h += '</div>';
        }
        
        // Recent requests
        if (s.history && s.history.length > 0) {
          h += '<h2>📝 Recent Requests</h2>';
          h += '<div class="section">';
          const recent = s.history.slice(-20).reverse().slice(0, 10);
          recent.forEach(r => {
            const time = new Date(r.timestamp).toLocaleTimeString();
            h += '<div class="row"><span class="label">' + time + ' · ' + r.modelName + '</span><span class="value">' + formatNum(r.usage.total) + ' tok</span></div>';
          });
          h += '</div>';
        }
        
        // Action buttons
        h += '<button class="btn" data-cmd="refresh">🔄 Refresh</button>';
        h += '<button class="btn btn-secondary" data-cmd="clear">🗑️ Clear Stats</button>';
        
        app.innerHTML = h;
        
        // Wire up buttons
        app.querySelectorAll('button[data-cmd]').forEach(btn => {
          btn.addEventListener('click', () => {
            const cmd = btn.getAttribute('data-cmd');
            // Use vscode messaging
            const evt = new CustomEvent('vscode-message', { detail: { command: cmd } });
            window.dispatchEvent(evt);
          });
        });
      }
      
      // Listen for messages from extension
      window.addEventListener('message', event => {
        const msg = event.data;
        if (msg.type === 'update' && msg.data) {
          renderUsage(msg.data);
        }
      });
      
      // Forward custom events to vscode
      window.addEventListener('vscode-message', event => {
        const vscode = acquireVsCodeApi();
        vscode.postMessage(event.detail);
      });
    })();
  </script>
</body>
</html>`;
  }
}
