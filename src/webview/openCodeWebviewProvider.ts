import * as vscode from 'vscode';

export interface ServerData {
  id: string;
  name: string;
  url: string;
  port?: number;
  version?: string;
  available: boolean;
  models: string[];
  providerCount: number;
  type?: 'opencode' | 'lmstudio' | 'ollama-plus';
}

export interface DashboardState {
  servers: ServerData[];
  zenKey: string;
  goKey: string;
  zenFamilies: Array<{ name: string; count: number; models: string[] }>;
  goFamilies: Array<{ name: string; count: number; models: string[] }>;
  zenStats: { totalRequests: number; totalTokens: { total: number } };
  goStats: { totalRequests: number; totalTokens: { total: number } };
}

export class OpenCodeWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'opencode-zen-dashboard';
  private view?: vscode.WebviewView;
  private state?: DashboardState;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };
    webviewView.webview.html = this.getHtml();
    this.sendState();
  }

  update(state: DashboardState): void {
    this.state = state;
    if (this.view) {
      this.view.webview.postMessage({ type: 'update', data: state });
    }
  }

  private sendState(): void {
    if (this.view && this.state) {
      this.view.webview.postMessage({ type: 'update', data: this.state });
    }
  }

  private getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      height: 100%;
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe WPC', sans-serif);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-foreground, #cccccc);
      background: var(--vscode-sideBar-background, var(--vscode-editor-background, #1e1e1e));
      overflow: hidden;
    }
    body { display: flex; flex-direction: column; }

    /* Tab bar */
    .tab-bar {
      display: flex;
      border-bottom: 1px solid var(--vscode-widget-border, #454545);
      background: var(--vscode-sideBar-background, #252526);
      flex-shrink: 0;
    }
    .tab-btn {
      flex: 1;
      padding: 8px 4px;
      border: none;
      background: transparent;
      color: var(--vscode-descriptionForeground, #858585);
      font-family: inherit;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      transition: color 0.15s, border-color 0.15s;
      white-space: nowrap;
    }
    .tab-btn:hover { color: var(--vscode-foreground, #cccccc); }
    .tab-btn.active {
      color: var(--vscode-foreground, #ffffff);
      border-bottom-color: var(--vscode-focusBorder, #007acc);
    }

    /* Panels */
    .panel { display: none; flex: 1; overflow-y: auto; padding: 12px; }
    .panel.active { display: block; }

    /* Section headers */
    .section-header {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-descriptionForeground, #858585);
      margin-bottom: 8px;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--vscode-widget-border, #454545);
    }

    /* Server cards */
    .card {
      background: var(--vscode-editor-inactiveSelectionBackground, #2d2d2d);
      border: 1px solid var(--vscode-widget-border, #454545);
      border-radius: 4px;
      padding: 10px 12px;
      margin-bottom: 8px;
    }
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
    }
    .card-title { font-weight: 600; font-size: 13px; }
    .card-meta { font-size: 11px; color: var(--vscode-descriptionForeground, #858585); }
    .badge {
      display: inline-block;
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 10px;
      font-weight: 500;
    }
    .badge-green { background: #10b981; color: #000; }
    .badge-red { background: #f85149; color: #fff; }
    .badge-muted { background: var(--vscode-badge-background, #4d4d4d); color: var(--vscode-badge-foreground, #fff); }

    /* Key items */
    .key-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 12px;
      background: var(--vscode-editor-inactiveSelectionBackground, #2d2d2d);
      border-radius: 4px;
      margin-bottom: 6px;
    }
    .key-label { font-weight: 500; }
    .key-value { font-size: 11px; color: var(--vscode-descriptionForeground, #858585); margin-top: 2px; }

    /* Model badges */
    .model-list { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
    .model-badge {
      font-size: 11px;
      padding: 2px 8px;
      background: var(--vscode-badge-background, #4d4d4d);
      color: var(--vscode-badge-foreground, #fff);
      border-radius: 10px;
    }

    /* Stats grid */
    .stats-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
    .stat-card {
      background: var(--vscode-editor-inactiveSelectionBackground, #2d2d2d);
      border-radius: 4px;
      padding: 12px;
      text-align: center;
    }
    .stat-value { font-size: 20px; font-weight: 600; color: var(--vscode-foreground, #fff); }
    .stat-label { font-size: 10px; color: var(--vscode-descriptionForeground, #858585); text-transform: uppercase; margin-top: 2px; }

    /* Buttons */
    .btn {
      padding: 4px 12px;
      border: 1px solid var(--vscode-button-border, var(--vscode-widget-border, #454545));
      background: var(--vscode-button-secondaryBackground, #3c3c3c);
      color: var(--vscode-button-secondaryForeground, #cccccc);
      border-radius: 2px;
      font-size: 11px;
      font-family: inherit;
      cursor: pointer;
    }
    .btn:hover { background: var(--vscode-button-secondaryHoverBackground, #454545); }
    .btn-primary {
      background: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #ffffff);
      border-color: var(--vscode-button-border, #0e639c);
    }
    .btn-primary:hover { background: var(--vscode-button-hoverBackground, #1177bb); }

    .empty {
      text-align: center;
      padding: 24px;
      color: var(--vscode-descriptionForeground, #858585);
      font-size: 12px;
    }

    .subtle { color: var(--vscode-descriptionForeground, #858585); }

    ::-webkit-scrollbar { width: 8px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--vscode-widget-border, #454545); border-radius: 4px; }
  </style>
</head>
<body>
  <div class="tab-bar">
    <button class="tab-btn active" data-tab="servers">Servers</button>
    <button class="tab-btn" data-tab="keys">API Keys</button>
    <button class="tab-btn" data-tab="models">Models</button>
    <button class="tab-btn" data-tab="stats">Stats</button>
  </div>

  <div class="panel active" id="servers"></div>
  <div class="panel" id="keys"></div>
  <div class="panel" id="models"></div>
  <div class="panel" id="stats"></div>

  <script>
    const vscode = acquireVsCodeApi();

    function maskKey(k) { return k ? '\\u25CF\\u25CF\\u25CF\\u25CF\\u25CF' + k.slice(-4) : 'Not configured'; }
    function fmt(n) { return n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? (n/1e3).toFixed(1)+'K' : String(n); }

    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.tab).classList.add('active');
      });
    });

    function renderServers(d) {
      const el = document.getElementById('servers');
      if (!d.servers || d.servers.length === 0) {
        el.innerHTML = '<div class="empty">No servers configured.</div>';
        return;
      }
      const on = d.servers.filter(s => s.available);
      const off = d.servers.filter(s => !s.available);
      let h = '';
      if (on.length) {
        h += '<div class="section-header">Online (' + on.length + ')</div>';
        on.forEach(s => {
          h += '<div class="card"><div class="card-header"><span class="card-title">' + s.name + '</span><span class="badge badge-green">Online</span></div>'
            + '<div class="card-meta">' + s.url + ':' + s.port + (s.version ? ' &middot; v' + s.version : '') + ' &middot; ' + s.models.length + ' models</div></div>';
        });
      }
      if (off.length) {
        h += '<div class="section-header" style="margin-top:12px">Offline (' + off.length + ')</div>';
        off.forEach(s => {
          h += '<div class="card" style="opacity:0.6"><div class="card-header"><span class="card-title">' + s.name + '</span><span class="badge badge-red">Offline</span></div>'
            + '<div class="card-meta">' + s.url + ':' + s.port + '</div></div>';
        });
      }
      el.innerHTML = h;
    }

    function renderKeys(d) {
      const el = document.getElementById('keys');
      el.innerHTML = ''
        + '<div class="key-row"><div><div class="key-label">OpenCode Zen</div><div class="key-value">' + maskKey(d.zenKey) + '</div></div>'
        + '<button class="btn" onclick="vscode.postMessage({command:\'configureZen\'})">Configure</button></div>'
        + '<div class="key-row"><div><div class="key-label">OpenCode Go</div><div class="key-value">' + maskKey(d.goKey) + '</div></div>'
        + '<button class="btn" onclick="vscode.postMessage({command:\'configureGo\'})">Configure</button></div>'
        + '<div class="key-row"><div><div class="key-label">OpenCode Free</div><div class="key-value">' + (d.zenKey ? 'Uses Zen key' : 'Requires Zen key') + '</div></div></div>';
    }

    function renderModels(d) {
      const el = document.getElementById('models');
      let h = '';

      const srvs = d.servers?.filter(s => s.available) || [];
      if (srvs.length) {
        h += '<div class="section-header">Local Servers</div>';
        srvs.forEach(s => {
          h += '<div style="margin-bottom:12px"><div class="card-title" style="margin-bottom:4px">' + s.name + ' <span class="subtle">&middot; ' + s.models.length + ' models</span></div><div class="model-list">';
          s.models.slice(0, 20).forEach(m => { h += '<span class="model-badge">' + m.split('/').pop() + '</span>'; });
          if (s.models.length > 20) h += '<span class="model-badge">+' + (s.models.length - 20) + '</span>';
          h += '</div></div>';
        });
      }

      if (d.zenFamilies?.length) {
        h += '<div class="section-header" style="margin-top:12px">OpenCode Zen</div>';
        d.zenFamilies.forEach(f => {
          h += '<div style="margin-bottom:8px"><div class="card-title">' + f.name + ' <span class="subtle">(' + f.count + ')</span></div><div class="model-list">';
          f.models.slice(0, 10).forEach(m => { h += '<span class="model-badge">' + m + '</span>'; });
          if (f.models.length > 10) h += '<span class="model-badge">+' + (f.models.length - 10) + '</span>';
          h += '</div></div>';
        });
      }

      if (d.goFamilies?.length) {
        h += '<div class="section-header" style="margin-top:12px">OpenCode Go</div>';
        d.goFamilies.forEach(f => {
          h += '<div style="margin-bottom:8px"><div class="card-title">' + f.name + ' <span class="subtle">(' + f.count + ')</span></div><div class="model-list">';
          f.models.slice(0, 10).forEach(m => { h += '<span class="model-badge">' + m + '</span>'; });
          if (f.models.length > 10) h += '<span class="model-badge">+' + (f.models.length - 10) + '</span>';
          h += '</div></div>';
        });
      }

      if (!h) h = '<div class="empty">No models available.<br>Configure API keys or add servers.</div>';
      el.innerHTML = h;
    }

    function renderStats(d) {
      const el = document.getElementById('stats');
      let h = '';

      const srvs = d.servers?.filter(s => s.available) || [];
      if (srvs.length) {
        h += '<div class="section-header">Server Usage</div><div class="stats-grid">';
        srvs.forEach(s => {
          h += '<div class="stat-card"><div class="stat-value">' + s.models.length + '</div><div class="stat-label">' + s.name + ' models</div></div>';
        });
        h += '</div>';
      }

      if (d.zenStats?.totalRequests > 0 || d.goStats?.totalRequests > 0) {
        h += '<div class="section-header" style="margin-top:12px">API Usage</div><div class="stats-grid">';
        if (d.zenStats?.totalRequests > 0) {
          h += '<div class="stat-card"><div class="stat-value">' + fmt(d.zenStats.totalTokens.total) + '</div><div class="stat-label">Zen Tokens</div></div>';
        }
        if (d.goStats?.totalRequests > 0) {
          h += '<div class="stat-card"><div class="stat-value">' + fmt(d.goStats.totalTokens.total) + '</div><div class="stat-label">Go Tokens</div></div>';
        }
        h += '</div>';
      }

      if (!h) h = '<div class="empty">No usage data yet.</div>';
      el.innerHTML = h;
    }

    window.addEventListener('message', e => {
      const msg = e.data;
      if (msg.type === 'update' && msg.data) {
        renderServers(msg.data);
        renderKeys(msg.data);
        renderModels(msg.data);
        renderStats(msg.data);
      }
    });
  </script>
</body>
</html>`;
  }
}
