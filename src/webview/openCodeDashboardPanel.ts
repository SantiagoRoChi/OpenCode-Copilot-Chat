import * as vscode from 'vscode';
import { OpenCodeUsageService, UsageData } from '../integration/openCodeUsageService';

/**
 * Dashboard webview showing OpenCode usage metrics with charts.
 * Uses Chart.js for visualization.
 */
export class OpenCodeDashboardPanel {
  public static readonly viewType = 'opencode-zen-dashboard-panel';
  private static currentPanel: OpenCodeDashboardPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly usageService: OpenCodeUsageService;
  private disposables: vscode.Disposable[] = [];

  public static createOrShow(extensionUri: vscode.Uri): void {
    const column = vscode.ViewColumn.One;

    if (OpenCodeDashboardPanel.currentPanel) {
      OpenCodeDashboardPanel.currentPanel.panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      OpenCodeDashboardPanel.viewType,
      'OpenCode Usage Dashboard',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri],
      }
    );

    OpenCodeDashboardPanel.currentPanel = new OpenCodeDashboardPanel(panel, extensionUri);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.usageService = OpenCodeUsageService.getInstance();

    this.panel.webview.html = this.getHtml();

    // Listen for usage data updates
    this.disposables.push(
      this.usageService.onDidChangeUsage((data) => {
        this.panel.webview.postMessage({ type: 'usageUpdate', data });
      })
    );

    // Handle messages from webview
    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.type) {
          case 'refresh':
            await this.refreshData();
            break;
          case 'loadMock':
            this.loadMockData();
            break;
        }
      },
      null,
      this.disposables
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // Initial data load
    void this.refreshData();
  }

  private async refreshData(): Promise<void> {
    const data = await this.usageService.fetchUsageData();
    if (data) {
      this.panel.webview.postMessage({ type: 'usageUpdate', data });
    }
  }

  private loadMockData(): void {
    const data = this.usageService.generateMockData();
    this.panel.webview.postMessage({ type: 'usageUpdate', data });
  }

  private getHtml(): string {
    const nonce = this.getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" 
        content="default-src 'none'; 
                 img-src ${this.panel.webview.cspSource} https:;
                 script-src 'nonce-${nonce}' https://cdn.jsdelivr.net 'unsafe-inline';
                 style-src 'unsafe-inline';
                 font-src https://cdn.jsdelivr.net;">
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js" nonce="${nonce}"></script>
  <title>OpenCode Usage Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      background: var(--vscode-editor-background, #1e1e1e);
      color: var(--vscode-foreground, #cccccc);
      padding: 20px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--vscode-widget-border, #454545);
    }
    .header h1 {
      font-size: 24px;
      font-weight: 600;
    }
    .header-actions {
      display: flex;
      gap: 8px;
    }
    .btn {
      padding: 8px 16px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
    }
    .btn-primary {
      background: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #ffffff);
    }
    .btn-primary:hover {
      background: var(--vscode-button-hoverBackground, #1177bb);
    }
    .btn-secondary {
      background: var(--vscode-button-secondaryBackground, #3c3c3c);
      color: var(--vscode-button-secondaryForeground, #cccccc);
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
      margin-bottom: 24px;
    }
    .stat-card {
      background: var(--vscode-editor-inactiveSelectionBackground, #2d2d2d);
      border-radius: 8px;
      padding: 20px;
      text-align: center;
    }
    .stat-value {
      font-size: 32px;
      font-weight: 700;
      color: var(--vscode-foreground, #ffffff);
    }
    .stat-label {
      font-size: 12px;
      color: var(--vscode-descriptionForeground, #858585);
      text-transform: uppercase;
      margin-top: 8px;
    }
    .charts-grid {
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: 16px;
      margin-bottom: 24px;
    }
    .chart-card {
      background: var(--vscode-editor-inactiveSelectionBackground, #2d2d2d);
      border-radius: 8px;
      padding: 20px;
    }
    .chart-title {
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 16px;
    }
    .chart-container {
      position: relative;
      height: 300px;
    }
    .models-table {
      width: 100%;
      border-collapse: collapse;
    }
    .models-table th,
    .models-table td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid var(--vscode-widget-border, #454545);
    }
    .models-table th {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--vscode-descriptionForeground, #858585);
    }
    .models-table tr:hover {
      background: var(--vscode-list-hoverBackground, #2a2d2e);
    }
    .status-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 500;
    }
    .status-active {
      background: #10b981;
      color: #000;
    }
    .status-warning {
      background: #f59e0b;
      color: #000;
    }
    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: var(--vscode-descriptionForeground, #858585);
    }
    .empty-state h3 {
      font-size: 18px;
      margin-bottom: 12px;
    }
    .last-updated {
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #858585);
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>OpenCode Usage Dashboard</h1>
    <div class="header-actions">
      <button class="btn btn-secondary" id="btn-refresh">Refresh</button>
      <button class="btn btn-secondary" id="btn-load-mock">Load Demo Data</button>
    </div>
  </div>

  <div class="stats-grid" id="stats-grid">
    <div class="stat-card">
      <div class="stat-value" id="stat-total-cost">$0.00</div>
      <div class="stat-label">Total Cost</div>
    </div>
    <div class="stat-card">
      <div class="stat-value" id="stat-total-requests">0</div>
      <div class="stat-label">Total Requests</div>
    </div>
    <div class="stat-card">
      <div class="stat-value" id="stat-total-tokens">0</div>
      <div class="stat-label">Total Tokens</div>
    </div>
    <div class="stat-card">
      <div class="stat-value" id="stat-models-count">0</div>
      <div class="stat-label">Models Used</div>
    </div>
  </div>

  <div class="charts-grid">
    <div class="chart-card">
      <div class="chart-title">Daily Cost Trend</div>
      <div class="chart-container">
        <canvas id="daily-cost-chart"></canvas>
      </div>
    </div>
    <div class="chart-card">
      <div class="chart-title">Cost by Model</div>
      <div class="chart-container">
        <canvas id="model-cost-chart"></canvas>
      </div>
    </div>
  </div>

  <div class="chart-card">
    <div class="chart-title">Model Usage Details</div>
    <table class="models-table">
      <thead>
        <tr>
          <th>Model</th>
          <th>Requests</th>
          <th>Input Tokens</th>
          <th>Output Tokens</th>
          <th>Cost</th>
        </tr>
      </thead>
      <tbody id="models-table-body">
        <tr>
          <td colspan="5" style="text-align: center; padding: 40px;">
            No data available. Click "Load Demo Data" to see sample metrics.
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="last-updated" id="last-updated"></div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let dailyCostChart = null;
    let modelCostChart = null;

    // Chart.js default colors for dark theme
    const chartColors = [
      '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
      '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#14b8a6'
    ];

    function formatNumber(num) {
      if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
      if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
      return num.toString();
    }

    function formatCost(cost) {
      return '$' + cost.toFixed(2);
    }

    function updateStats(data) {
      document.getElementById('stat-total-cost').textContent = formatCost(data.totalCost);
      
      const totalRequests = data.models.reduce((sum, m) => sum + m.requests, 0);
      document.getElementById('stat-total-requests').textContent = formatNumber(totalRequests);
      
      document.getElementById('stat-total-tokens').textContent = formatNumber(data.totalTokens);
      document.getElementById('stat-models-count').textContent = data.models.length;
      
      document.getElementById('last-updated').textContent = 
        'Last updated: ' + new Date(data.lastUpdated).toLocaleString();
    }

    function updateDailyCostChart(data) {
      const ctx = document.getElementById('daily-cost-chart').getContext('2d');
      
      if (dailyCostChart) {
        dailyCostChart.destroy();
      }

      const labels = data.dailyUsage.map(d => d.date.slice(5)); // MM-DD
      const costs = data.dailyUsage.map(d => d.cost);

      dailyCostChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: 'Daily Cost ($)',
            data: costs,
            borderColor: chartColors[0],
            backgroundColor: chartColors[0] + '20',
            fill: true,
            tension: 0.4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false }
          },
          scales: {
            x: {
              grid: { color: '#454545' },
              ticks: { color: '#858585' }
            },
            y: {
              grid: { color: '#454545' },
              ticks: { 
                color: '#858585',
                callback: (value) => '$' + value
              }
            }
          }
        }
      });
    }

    function updateModelCostChart(data) {
      const ctx = document.getElementById('model-cost-chart').getContext('2d');
      
      if (modelCostChart) {
        modelCostChart.destroy();
      }

      const labels = data.models.map(m => m.modelName);
      const costs = data.models.map(m => m.cost);

      modelCostChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels,
          datasets: [{
            data: costs,
            backgroundColor: chartColors.slice(0, data.models.length),
            borderWidth: 0
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'right',
              labels: { color: '#858585' }
            }
          }
        }
      });
    }

    function updateModelsTable(data) {
      const tbody = document.getElementById('models-table-body');
      
      if (data.models.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 40px;">No models used yet.</td></tr>';
        return;
      }

      tbody.innerHTML = data.models.map(m => {
        const costPercent = (m.cost / data.totalCost) * 100;
        const statusClass = costPercent > 30 ? 'status-warning' : 'status-active';
        
        return '<tr>'
          + '<td><strong>' + m.modelName + '</strong></td>'
          + '<td>' + formatNumber(m.requests) + '</td>'
          + '<td>' + formatNumber(m.inputTokens) + '</td>'
          + '<td>' + formatNumber(m.outputTokens) + '</td>'
          + '<td>' + formatCost(m.cost) 
          + ' <span class="status-badge ' + statusClass + '">' + costPercent.toFixed(1) + '%</span></td>'
          + '</tr>';
      }).join('');
    }

    function updateDashboard(data) {
      updateStats(data);
      updateDailyCostChart(data);
      updateModelCostChart(data);
      updateModelsTable(data);
    }

    // Button handlers
    document.getElementById('btn-refresh').addEventListener('click', () => {
      vscode.postMessage({ type: 'refresh' });
    });

    document.getElementById('btn-load-mock').addEventListener('click', () => {
      vscode.postMessage({ type: 'loadMock' });
    });

    // Listen for messages from extension
    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message.type === 'usageUpdate') {
        updateDashboard(message.data);
      }
    });
  </script>
</body>
</html>`;
  }

  private getNonce(): string {
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 32; i++) {
      nonce += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return nonce;
  }

  public dispose(): void {
    OpenCodeDashboardPanel.currentPanel = undefined;
    this.panel.dispose();
    this.disposables.forEach(d => d.dispose());
  }
}
