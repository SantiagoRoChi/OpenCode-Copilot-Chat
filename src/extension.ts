import * as vscode from 'vscode';
import { OpenCodeFreeProvider } from './providers/OpenCodeFreeProvider';
import { OpenCodeGoProvider } from './providers/OpenCodeGoProvider';
import { OpenCodeZenProvider } from './providers/OpenCodeZenProvider';
import { StatusBarManager } from './status/statusBar';
import { UsageTracker, UsageStats, formatUsageOutput } from './usage/UsageTracker';
import { UsageWebviewProvider } from './status/usageWebview';
import { OpenCodeConnector } from './integration/opencodeConnector';
import { SecretStorage } from './config/secretStorage';
import { ApiUsageResponse, TokenUsage } from './client/types';

let freeProvider: OpenCodeFreeProvider;
let goProvider: OpenCodeGoProvider;
let zenProvider: OpenCodeZenProvider;
let statusBar: StatusBarManager;
let sharedUsageTracker: UsageTracker;
let usageWebview: UsageWebviewProvider;
let connector: OpenCodeConnector;
let secretStorage: SecretStorage;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('OpenCode Zen: activating...');

  // Create 3 providers
  freeProvider = new OpenCodeFreeProvider(context);
  goProvider = new OpenCodeGoProvider(context);
  zenProvider = new OpenCodeZenProvider(context);

  // Load API keys
  await Promise.all([
    freeProvider.loadApiKey(),
    goProvider.loadApiKey(),
    zenProvider.loadApiKey(),
  ]);

  // Use Zen's output channel for shared logs
  // (each provider has its own, but we share via the connector)
  connector = new OpenCodeConnector(zenProvider['outputChannel']);
  secretStorage = new SecretStorage(context);
  
  // Setup FileSystemWatcher for local OpenCode auth.json
  connector.watchAuthFile(context);
  context.subscriptions.push(connector);

  // Check for local OpenCode installation
  if (await connector.hasLocalKeys()) {
    const choice = await vscode.window.showInformationMessage(
      'OpenCode local installation detected. Use local API keys?',
      'Yes', 'No'
    );
    if (choice === 'Yes') {
      const localKeys = await connector.getLocalKeys();
      if (localKeys.zenKey) {
        await zenProvider.setApiKey(localKeys.zenKey);
        await freeProvider.setApiKey(localKeys.zenKey);
      }
      if (localKeys.goKey) {
        await goProvider.setApiKey(localKeys.goKey);
      }
      vscode.window.showInformationMessage('OpenCode Zen: Local API keys loaded.');
    }
  }

  // Listen for changes to local auth.json
  context.subscriptions.push(
    connector.onDidChangeLocalKeys(async (newKeys) => {
      const choice = await vscode.window.showInformationMessage(
        'New API keys detected in local OpenCode installation. Use them?',
        'Yes', 'No'
      );
      if (choice === 'Yes') {
        if (newKeys.zenKey) {
          await zenProvider.setApiKey(newKeys.zenKey);
          await freeProvider.setApiKey(newKeys.zenKey);
        }
        if (newKeys.goKey) {
          await goProvider.setApiKey(newKeys.goKey);
        }
        vscode.window.showInformationMessage('OpenCode Zen: New API keys loaded.');
      }
    })
  );

  // Register the 3 providers
  const freeDisposable = vscode.lm.registerLanguageModelChatProvider('opencode-free', freeProvider);
  const goDisposable = vscode.lm.registerLanguageModelChatProvider('opencode-go', goProvider);
  const zenDisposable = vscode.lm.registerLanguageModelChatProvider('opencode-zen', zenProvider);
  context.subscriptions.push(freeDisposable, goDisposable, zenDisposable);

  console.log('OpenCode Zen: 3 providers registered (free + go + zen)');

  // Use Zen's usage tracker as the shared one
  sharedUsageTracker = new UsageTracker();

  // Status bar
  statusBar = new StatusBarManager(() => zenProvider.getStatusSnapshot());
  statusBar.show();
  context.subscriptions.push(statusBar);

  // Usage webview
  usageWebview = new UsageWebviewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(UsageWebviewProvider.viewType, usageWebview)
  );

  // Update webview with combined data from all 3 providers
  const updateWebview = async () => {
    const [zenKey, goKey, zenUsage, goUsage] = await Promise.all([
      secretStorage.getZenKey(),
      secretStorage.getGoKey(),
      zenProvider.fetchApiUsage(),
      goProvider.fetchApiUsage(),
    ]);

    // Aggregate session stats from all 3 providers
    const combined = aggregateUsageStats([
      zenProvider.getUsageTracker().getStats(),
      goProvider.getUsageTracker().getStats(),
      freeProvider.getUsageTracker().getStats(),
    ]);

    usageWebview.update({
      zenKey,
      goKey,
      zenUsage: zenUsage || undefined,
      goUsage: goUsage || undefined,
      sessionStats: combined,
    });
  };

  // Refresh webview on any usage change
  const onUsageChange = () => {
    void updateWebview();
  };

  zenProvider.getUsageTracker().onDidChangeUsage(onUsageChange);
  goProvider.getUsageTracker().onDidChangeUsage(onUsageChange);
  freeProvider.getUsageTracker().onDidChangeUsage(onUsageChange);

  // Periodic refresh of webview
  const webviewRefreshInterval = setInterval(() => {
    void updateWebview();
  }, 30000);
  context.subscriptions.push({ dispose: () => clearInterval(webviewRefreshInterval) });

  // Initial webview update
  void updateWebview();

  // Live request state from all 3 providers
  const handleRequestState = (event: any) => {
    switch (event.kind) {
      case 'start':
        statusBar.setStreaming(event.modelId, event.modelName);
        break;
      case 'complete':
        statusBar.setResponded(event.modelId, event.modelName);
        break;
      case 'error':
        statusBar.setError(event.errorMessage);
        break;
    }
  };

  context.subscriptions.push(
    zenProvider.onDidChangeRequestState(handleRequestState),
    goProvider.onDidChangeRequestState(handleRequestState),
    freeProvider.onDidChangeRequestState(handleRequestState)
  );

  context.subscriptions.push(
    zenProvider.onDidChangeLanguageModelChatInformation(() => statusBar.refreshTooltip()),
    goProvider.onDidChangeLanguageModelChatInformation(() => statusBar.refreshTooltip()),
    freeProvider.onDidChangeLanguageModelChatInformation(() => statusBar.refreshTooltip())
  );

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('opencode-zen.showOutput', () => zenProvider.showOutput())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('opencode-zen.showUsage', () => {
      // Open the usage webview in the sidebar
      vscode.commands.executeCommand('workbench.view.opencode-zen-usage');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('opencode-zen.showOutputLog', () => {
      const stats = aggregateUsageStats([
        zenProvider.getUsageTracker().getStats(),
        goProvider.getUsageTracker().getStats(),
        freeProvider.getUsageTracker().getStats(),
      ]);
      const output = formatUsageOutput(stats);
      zenProvider.showOutput();
      zenProvider.appendOutput(output);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('opencode-zen.clearUsage', () => {
      zenProvider.getUsageTracker().clear();
      goProvider.getUsageTracker().clear();
      freeProvider.getUsageTracker().clear();
      vscode.window.showInformationMessage('OpenCode Zen: Usage stats cleared.');
      void updateWebview();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('opencode-zen.configureZen', async () => {
      const apiKey = await vscode.window.showInputBox({
        title: 'OpenCode Zen — API Key',
        prompt: 'Enter your OpenCode Zen/Go API key. Get one at opencode.ai/auth',
        password: true,
        placeHolder: 'oc-...',
        ignoreFocusOut: true,
      });
      if (apiKey === undefined) return;
      await zenProvider.setApiKey(apiKey);
      await freeProvider.setApiKey(apiKey);
      await secretStorage.setZenKey(apiKey);
      if (apiKey) {
        vscode.window.showInformationMessage('OpenCode Zen: API key saved.');
      } else {
        vscode.window.showInformationMessage('OpenCode Zen: API key cleared.');
      }
      void updateWebview();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('opencode-zen.configureGo', async () => {
      const apiKey = await vscode.window.showInputBox({
        title: 'OpenCode Go — API Key',
        prompt: 'Enter your OpenCode Go API key. Get one at opencode.ai/auth',
        password: true,
        placeHolder: 'oc-...',
        ignoreFocusOut: true,
      });
      if (apiKey === undefined) return;
      await goProvider.setApiKey(apiKey);
      await secretStorage.setGoKey(apiKey);
      if (apiKey) {
        vscode.window.showInformationMessage('OpenCode Go: API key saved.');
      } else {
        vscode.window.showInformationMessage('OpenCode Go: API key cleared.');
      }
      void updateWebview();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('opencode-zen.refreshAll', () => {
      zenProvider.refreshModels();
      goProvider.refreshModels();
      freeProvider.refreshModels();
      vscode.window.showInformationMessage('OpenCode Zen: All models refreshed.');
    })
  );

  // Initial probe
  const initialProbe = setTimeout(() => {
    void refreshStatusBar();
  }, 2000);
  context.subscriptions.push({ dispose: () => clearTimeout(initialProbe) });
}

function aggregateUsageStats(statsList: UsageStats[]): UsageStats {
  const totalRequests = statsList.reduce((s, x) => s + x.totalRequests, 0);
  const totalTokens = statsList.reduce(
    (acc, st) => ({
      prompt: acc.prompt + st.totalTokens.prompt,
      completion: acc.completion + st.totalTokens.completion,
      total: acc.total + st.totalTokens.total,
    }),
    { prompt: 0, completion: 0, total: 0 }
  );

  const byModel: Record<string, { requests: number; tokens: TokenUsage }> = {};
  const byProvider: Record<string, { requests: number; tokens: TokenUsage }> = {};
  const history: any[] = [];

  for (const s of statsList) {
    for (const r of s.history) history.push(r);
    for (const [k, v] of Object.entries(s.byModel)) {
      if (!byModel[k]) byModel[k] = { requests: 0, tokens: { prompt: 0, completion: 0, total: 0 } };
      byModel[k].requests += v.requests;
      byModel[k].tokens.prompt += v.tokens.prompt;
      byModel[k].tokens.completion += v.tokens.completion;
      byModel[k].tokens.total += v.tokens.total;
    }
    for (const [k, v] of Object.entries(s.byProvider)) {
      if (!byProvider[k]) byProvider[k] = { requests: 0, tokens: { prompt: 0, completion: 0, total: 0 } };
      byProvider[k].requests += v.requests;
      byProvider[k].tokens.prompt += v.tokens.prompt;
      byProvider[k].tokens.completion += v.tokens.completion;
      byProvider[k].tokens.total += v.tokens.total;
    }
  }

  history.sort((a, b) => b.timestamp - a.timestamp);

  return { totalRequests, totalTokens, byModel, byProvider, history };
}

async function refreshStatusBar(): Promise<void> {
  const cts = new vscode.CancellationTokenSource();
  try {
    const models = await zenProvider.provideLanguageModelChatInformation(
      { silent: true },
      cts.token
    );
    if (models.length > 0) {
      statusBar.setIdle(models.length);
    } else {
      statusBar.setNoModels();
    }
  } catch (err) {
    statusBar.setError(err instanceof Error ? err.message : String(err));
  } finally {
    cts.dispose();
  }
}

export function deactivate(): void {
  // no-op
}
