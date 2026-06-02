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
      switch (message.command) {
        case 'configureZen':
          vscode.commands.executeCommand('opencode-zen.configureZen');
          break;
        case 'configureGo':
          vscode.commands.executeCommand('opencode-zen.configureGo');
          break;
        case 'clear':
          vscode.commands.executeCommand('opencode-zen.clearUsage');
          break;
        case 'refresh':
          if (this.currentData) {
            webviewView.webview.postMessage({ type: 'update', data: this.currentData });
          }
          break;
        case 'showLog':
          vscode.commands.executeCommand('opencode-zen.showOutputLog');
          break;
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
    if (!key) return '';
    if (key.length <= 8) return '••••';
    return `${key.slice(0, 6)}…${key.slice(-4)}`;
  }

  private getHtml(): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      padding: 8px 12px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      line-height: 1.4;
    }
    .empty {
      text-align: center;
      padding: 30px 10px;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }

    /* Section (collapsible tree) */
    .section {
      margin-bottom: 4px;
    }
    .section-header {
      display: flex;
      align-items: center;
      cursor: pointer;
      padding: 4px 6px;
      user-select: none;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
      color: var(--vscode-foreground);
    }
    .section-header:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .section-header .chevron {
      display: inline-block;
      width: 12px;
      font-size: 10px;
      transition: transform 0.1s;
      color: var(--vscode-descriptionForeground);
    }
    .section-header.collapsed .chevron {
      transform: rotate(-90deg);
    }
    .section-body {
      padding: 4px 0 8px 18px;
    }
    .section-body.collapsed {
      display: none;
    }

    /* Cards */
    .cards {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
      margin: 6px 0;
    }
    .card {
      background: var(--vscode-editor-inactiveSelectionBackground);
      border: 1px solid var(--vscode-widget-border);
      border-radius: 4px;
      padding: 8px 10px;
    }
    .card-label {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .card-value {
      font-size: 15px;
      font-weight: 600;
      margin-top: 2px;
    }

    /* Rows */
    .row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 4px 8px;
      font-size: 11px;
      border-bottom: 1px solid var(--vscode-widget-border);
    }
    .row:last-child { border-bottom: none; }
    .row-name { color: var(--vscode-foreground); }
    .row-meta { color: var(--vscode-descriptionForeground); font-size: 10px; }

    /* API Key item */
    .key-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 8px;
      font-size: 11px;
      gap: 8px;
    }
    .key-info { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1; }
    .key-status {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .key-status.active { background: var(--vscode-charts-green); }
    .key-status.inactive { background: var(--vscode-charts-red); }
    .key-name { font-weight: 600; }
    .key-value {
      color: var(--vscode-descriptionForeground);
      font-family: var(--vscode-editor-font-family);
      font-size: 10px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* Buttons */
    .btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 4px 10px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 11px;
      font-family: var(--vscode-font-family);
    }
    .btn:hover { background: var(--vscode-button-hoverBackground); }
    .btn-secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .btn-icon {
      padding: 2px 6px;
      font-size: 10px;
    }

    /* Tree */
    .tree {
      font-family: var(--vscode-editor-font-family);
      font-size: 11px;
    }
    .tree-item {
      padding: 2px 4px;
      display: flex;
      justify-content: space-between;
      cursor: pointer;
    }
    .tree-item:hover { background: var(--vscode-list-hoverBackground); }
    .tree-toggle {
      display: inline-block;
      width: 10px;
      color: var(--vscode-descriptionForeground);
    }
    .tree-label { flex: 1; }
    .tree-detail { color: var(--vscode-descriptionForeground); }
    .tree-children {
      padding-left: 14px;
    }
    .tree-children.collapsed { display: none; }

    /* Bar chart */
    .bar-container {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 10px;
    }
    .bar-bg {
      flex: 1;
      height: 4px;
      background: var(--vscode-progressBar-background);
      border-radius: 2px;
      overflow: hidden;
    }
    .bar-fill {
      height: 100%;
      background: var(--vscode-progressBar-foreground);
    }
  </style>
</head>
<body>
  <div id="app">
    <div class="empty">Loading usage data…</div>
  </div>
  <script>
    (function() {
      const app = document.getElementById('app');
      const vscode = acquireVsCodeApi();

      function formatNum(n) {
        if (n === null || n === undefined) return '0';
        if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
        if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
        return String(n);
      }
      function maskKey(key) {
        if (!key) return '';
        if (key.length <= 8) return '••••';
        return key.slice(0, 6) + '…' + key.slice(-4);
      }
      function providerName(id) {
        if (id === 'zen') return 'Zen';
        if (id === 'go') return 'Go';
        if (id === 'free') return 'Free';
        return id;
      }
      function timeAgo(ts) {
        const diff = Math.floor((Date.now() - ts) / 1000);
        if (diff < 60) return diff + 's ago';
        if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
        if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
        return new Date(ts).toLocaleDateString();
      }

      // Section state (collapsed/expanded)
      const sectionState = {
        keys: false,
        balance: true,
        session: false,
        providers: true,
        models: true,
        recent: false
      };
      const treeState = {};

      function toggleSection(id) {
        sectionState[id] = !sectionState[id];
        render();
      }
      function toggleTree(key) {
        treeState[key] = !treeState[key];
        render();
      }

      function makeSection(id, icon, title, content) {
        const collapsed = sectionState[id];
        return '<div class="section">'
          + '<div class="section-header' + (collapsed ? ' collapsed' : '') + '" data-section="' + id + '">'
          + '<span class="chevron">▼</span> ' + icon + ' ' + title
          + '</div>'
          + '<div class="section-body' + (collapsed ? ' collapsed' : '') + '">' + content + '</div>'
          + '</div>';
      }

      function renderKeys(d) {
        return '<div class="key-item">'
          + '<div class="key-info">'
          + '<span class="key-status ' + (d.zenKey ? 'active' : 'inactive') + '"></span>'
          + '<span class="key-name">Zen:</span>'
          + '<span class="key-value">' + (d.zenKey ? maskKey(d.zenKey) : 'not configured') + '</span>'
          + '</div>'
          + '<button class="btn btn-secondary btn-icon" data-cmd="configureZen">' + (d.zenKey ? 'Edit' : 'Set') + '</button>'
          + '</div>'
          + '<div class="key-item">'
          + '<div class="key-info">'
          + '<span class="key-status ' + (d.goKey ? 'active' : 'inactive') + '"></span>'
          + '<span class="key-name">Go:</span>'
          + '<span class="key-value">' + (d.goKey ? maskKey(d.goKey) : 'not configured') + '</span>'
          + '</div>'
          + '<button class="btn btn-secondary btn-icon" data-cmd="configureGo">' + (d.goKey ? 'Edit' : 'Set') + '</button>'
          + '</div>';
      }

      function renderBalance(d) {
        if (!d.zenUsage && !d.goUsage) {
          return '<div class="row-meta" style="padding:6px 8px">No balance data available</div>';
        }
        let h = '';
        if (d.zenUsage) {
          h += '<div class="row"><span class="row-name">Zen balance</span><span class="row-meta">$' + (d.zenUsage.balance ?? 'N/A') + '</span></div>';
        }
        if (d.goUsage) {
          h += '<div class="row"><span class="row-name">Go used</span><span class="row-meta">$' + (d.goUsage.used ?? '0') + ' / $' + (d.goUsage.limit ?? '0') + '</span></div>';
        }
        return h;
      }

      function renderSession(s) {
        return '<div class="cards">'
          + '<div class="card"><div class="card-label">Requests</div><div class="card-value">' + s.totalRequests + '</div></div>'
          + '<div class="card"><div class="card-label">Total Tokens</div><div class="card-value">' + formatNum(s.totalTokens.total) + '</div></div>'
          + '<div class="card"><div class="card-label">Prompt</div><div class="card-value">' + formatNum(s.totalTokens.prompt) + '</div></div>'
          + '<div class="card"><div class="card-label">Completion</div><div class="card-value">' + formatNum(s.totalTokens.completion) + '</div></div>'
          + '</div>';
      }

      function renderProviders(s) {
        if (!s.byProvider || Object.keys(s.byProvider).length === 0) {
          return '<div class="row-meta" style="padding:6px 8px">No provider usage yet</div>';
        }
        const entries = Object.entries(s.byProvider)
          .map(([id, data]) => ({ id, data }))
          .sort((a, b) => b.data.tokens.total - a.data.tokens.total);
        return entries.map(p =>
          '<div class="row">'
          + '<span class="row-name">' + providerName(p.id) + '</span>'
          + '<span class="row-meta">' + p.data.requests + ' req · ' + formatNum(p.data.tokens.total) + ' tok</span>'
          + '</div>'
        ).join('');
      }

      function renderModels(s) {
        if (!s.byModel || Object.keys(s.byModel).length === 0) {
          return '<div class="row-meta" style="padding:6px 8px">No model usage yet</div>';
        }
        const total = s.totalTokens.total;
        const entries = Object.entries(s.byModel)
          .map(([id, data]) => ({ id, data }))
          .sort((a, b) => b.data.tokens.total - a.data.tokens.total)
          .slice(0, 15);
        return entries.map(m => {
          const pct = total > 0 ? (m.data.tokens.total / total) * 100 : 0;
          const expanded = treeState['model_' + m.id];
          return '<div class="tree-item" data-tree="model_' + m.id + '">'
            + '<span class="tree-toggle">' + (expanded ? '▼' : '▶') + '</span>'
            + '<span class="tree-label">' + m.id + '</span>'
            + '<div class="bar-container">'
            + '<div class="bar-bg"><div class="bar-fill" style="width:' + pct.toFixed(0) + '%"></div></div>'
            + '<span class="tree-detail">' + formatNum(m.data.tokens.total) + '</span>'
            + '</div>'
            + '</div>'
            + '<div class="tree-children' + (expanded ? '' : ' collapsed') + '" data-children="model_' + m.id + '">'
            + '<div class="row"><span class="row-name">Requests</span><span class="row-meta">' + m.data.requests + '</span></div>'
            + '<div class="row"><span class="row-name">Prompt</span><span class="row-meta">' + formatNum(m.data.tokens.prompt) + '</span></div>'
            + '<div class="row"><span class="row-name">Completion</span><span class="row-meta">' + formatNum(m.data.tokens.completion) + '</span></div>'
            + '</div>';
        }).join('');
      }

      function renderSessions(s) {
        if (!s.history || s.history.length === 0) {
          return '<div class="row-meta" style="padding:6px 8px">No sessions yet</div>';
        }
        const sessionMap = {};
        for (const r of s.history) {
          if (!sessionMap[r.sessionId]) {
            sessionMap[r.sessionId] = { count: 0, tokens: 0, firstTs: r.timestamp };
          }
          sessionMap[r.sessionId].count++;
          sessionMap[r.sessionId].tokens += r.usage.total;
        }
        const entries = Object.entries(sessionMap)
          .map(([sid, data]) => ({ sid, ...data }))
          .sort((a, b) => b.tokens - a.tokens)
          .slice(0, 10);
        return entries.map(e => {
          const expanded = treeState['session_' + e.sid];
          return '<div class="tree-item" data-tree="session_' + e.sid + '">'
            + '<span class="tree-toggle">' + (expanded ? '▼' : '▶') + '</span>'
            + '<span class="tree-label">Session ' + e.sid.slice(0, 8) + '…</span>'
            + '<span class="tree-detail">' + e.count + ' req · ' + formatNum(e.tokens) + '</span>'
            + '</div>'
            + '<div class="tree-children' + (expanded ? '' : ' collapsed') + '" data-children="session_' + e.sid + '">'
            + s.history.filter(r => r.sessionId === e.sid).reverse().map(r => {
              const reqExpanded = treeState['req_' + r.requestId];
              return '<div class="tree-item" data-tree="req_' + r.requestId + '" style="padding-left:8px">'
                + '<span class="tree-toggle">' + (reqExpanded ? '▼' : '▶') + '</span>'
                + '<span class="tree-label">' + new Date(r.timestamp).toLocaleTimeString() + '</span>'
                + '<span class="tree-detail">' + formatNum(r.usage.total) + '</span>'
                + '</div>'
                + '<div class="tree-children' + (reqExpanded ? '' : ' collapsed') + '" data-children="req_' + r.requestId + '" style="padding-left:16px">'
                + '<div class="row"><span class="row-name">Model</span><span class="row-meta">' + r.modelId + '</span></div>'
                + '<div class="row"><span class="row-name">Provider</span><span class="row-meta">' + providerName(r.provider) + '</span></div>'
                + '<div class="row"><span class="row-name">Prompt</span><span class="row-meta">' + formatNum(r.usage.prompt) + '</span></div>'
                + '<div class="row"><span class="row-name">Completion</span><span class="row-meta">' + formatNum(r.usage.completion) + '</span></div>'
                + '</div>';
            }).join('')
            + '</div>';
        }).join('');
      }

      function renderRecent(s) {
        if (!s.history || s.history.length === 0) {
          return '<div class="row-meta" style="padding:6px 8px">No recent requests</div>';
        }
        const recent = s.history.slice(-20).reverse();
        return recent.map(r => {
          const expanded = treeState['recent_' + r.requestId];
          return '<div class="tree-item" data-tree="recent_' + r.requestId + '">'
            + '<span class="tree-toggle">' + (expanded ? '▼' : '▶') + '</span>'
            + '<span class="tree-label">' + new Date(r.timestamp).toLocaleTimeString() + ' · ' + r.modelName + '</span>'
            + '<span class="tree-detail">' + formatNum(r.usage.total) + '</span>'
            + '</div>'
            + '<div class="tree-children' + (expanded ? '' : ' collapsed') + '" data-children="recent_' + r.requestId + '">'
            + '<div class="row"><span class="row-name">Provider</span><span class="row-meta">' + providerName(r.provider) + '</span></div>'
            + '<div class="row"><span class="row-name">Session</span><span class="row-meta">' + r.sessionId.slice(0, 8) + '…</span></div>'
            + '<div class="row"><span class="row-name">Request</span><span class="row-meta">' + r.requestId.slice(0, 8) + '…</span></div>'
            + '<div class="row"><span class="row-name">Prompt</span><span class="row-meta">' + formatNum(r.usage.prompt) + '</span></div>'
            + '<div class="row"><span class="row-name">Completion</span><span class="row-meta">' + formatNum(r.usage.completion) + '</span></div>'
            + '<div class="row"><span class="row-name">Total</span><span class="row-meta">' + formatNum(r.usage.total) + '</span></div>'
            + '</div>';
        }).join('');
      }

      function render(d) {
        const s = d.sessionStats;
        let h = '';

        h += makeSection('keys', '🔑', 'API Keys', renderKeys(d));
        h += makeSection('balance', '💰', 'Account Balance', renderBalance(d));
        h += makeSection('session', '📈', 'Session Statistics', renderSession(s));
        h += makeSection('sessions', '🔀', 'Sessions', renderSessions(s));
        h += makeSection('providers', '📊', 'By Provider', renderProviders(s));
        h += makeSection('models', '🤖', 'By Model', renderModels(s));
        h += makeSection('recent', '📝', 'Recent Requests (' + (s.history?.length || 0) + ')', renderRecent(s));

        h += '<div style="display:flex;gap:4px;margin-top:8px">';
        h += '<button class="btn" data-cmd="refresh" style="flex:1">🔄 Refresh</button>';
        h += '<button class="btn btn-secondary btn-icon" data-cmd="showLog">📄</button>';
        h += '<button class="btn btn-secondary btn-icon" data-cmd="clear">🗑️</button>';
        h += '</div>';

        app.innerHTML = h;
        wireEvents();
      }

      function wireEvents() {
        // Section headers
        app.querySelectorAll('.section-header').forEach(el => {
          el.addEventListener('click', () => {
            toggleSection(el.getAttribute('data-section'));
          });
        });
        // Tree items
        app.querySelectorAll('.tree-item').forEach(el => {
          el.addEventListener('click', () => {
            toggleTree(el.getAttribute('data-tree'));
          });
        });
        // Buttons
        app.querySelectorAll('button[data-cmd]').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            vscode.postMessage({ command: btn.getAttribute('data-cmd') });
          });
        });
      }

      window.addEventListener('message', event => {
        const msg = event.data;
        if (msg.type === 'update' && msg.data) {
          render(msg.data);
        }
      });
    })();
  </script>
</body>
</html>`;
  }
}
