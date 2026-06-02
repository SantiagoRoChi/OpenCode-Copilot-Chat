import * as vscode from 'vscode';
import { ZenProvider, RequestStateEvent } from './provider';
import { StatusBarManager } from './status/statusBar';
import { UsageTracker, formatUsageOutput } from './status/usageTracker';
import { UsageWebviewProvider } from './status/usageWebview';

let zenProvider: ZenProvider;
let goProvider: ZenProvider;
let statusBar: StatusBarManager;
let usageTracker: UsageTracker;
let usageWebview: UsageWebviewProvider;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('OpenCode Zen: activating...');

  // Create separate providers for Zen and Go
  zenProvider = new ZenProvider(context, 'zen');
  goProvider = new ZenProvider(context, 'go');

  await zenProvider.loadSecrets();
  await goProvider.loadSecrets();

  // Register providers
  const zenDisposable = vscode.lm.registerLanguageModelChatProvider('opencode-zen', zenProvider);
  const goDisposable = vscode.lm.registerLanguageModelChatProvider('opencode-go', goProvider);
  context.subscriptions.push(zenDisposable, goDisposable);

  console.log('OpenCode Zen: providers registered (zen + go)');

  // Initialize usage tracker
  usageTracker = new UsageTracker();
  context.subscriptions.push(usageTracker);

  // Initialize status bar (uses zen provider for snapshot)
  statusBar = new StatusBarManager(() => zenProvider.getStatusSnapshot());
  statusBar.show();
  context.subscriptions.push(statusBar);

  // Initialize webview
  usageWebview = new UsageWebviewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(UsageWebviewProvider.viewType, usageWebview)
  );

  // Listen to usage changes
  context.subscriptions.push(
    usageTracker.onDidChangeUsage((stats) => {
      statusBar.updateUsage(stats);
      usageWebview.updateStats(stats);
    })
  );

  // Live request state from both providers
  const handleRequestState = (event: RequestStateEvent) => {
    switch (event.kind) {
      case 'start':
        statusBar.setStreaming(event.modelId, event.modelName);
        break;
      case 'complete':
        statusBar.setResponded(event.modelId, event.modelName);
        break;
      case 'error':
        statusBar.setError(event.errorMessage);
        usageWebview.updateError(event.errorMessage);
        break;
    }
  };

  context.subscriptions.push(
    zenProvider.onDidChangeRequestState(handleRequestState),
    goProvider.onDidChangeRequestState(handleRequestState)
  );

  // Refresh tooltip on snapshot changes
  context.subscriptions.push(
    zenProvider.onDidChangeStatusSnapshot(() => statusBar.refreshTooltip()),
    goProvider.onDidChangeStatusSnapshot(() => statusBar.refreshTooltip())
  );

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('opencode-zen.showOutput', () => zenProvider.showOutput())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('opencode-zen.showUsage', () => {
      const stats = usageTracker.getStats();
      const output = formatUsageOutput(stats);
      zenProvider.showOutput();
      zenProvider.appendOutput(output);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('opencode-zen.testConnection', async () => {
      try {
        const models = await zenProvider.provideLanguageModelChatInformation(
          { silent: false },
          new vscode.CancellationTokenSource().token
        );
        if (models.length > 0) {
          statusBar.setIdle(models.length);
          vscode.window.showInformationMessage(
            `OpenCode Zen: Connected! Found ${models.length} model(s).`
          );
        } else {
          statusBar.setNoModels();
          vscode.window.showWarningMessage('OpenCode Zen: Connected but no models found.');
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        statusBar.setError(msg);
        vscode.window.showErrorMessage(`OpenCode Zen: Connection failed. ${msg}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('opencode-zen.manage', async () => {
      const apiKey = await vscode.window.showInputBox({
        title: 'OpenCode Zen — API Key',
        prompt: 'Enter your OpenCode Zen/Go API key. Get one at opencode.ai/auth',
        password: true,
        placeHolder: 'oc-...',
        ignoreFocusOut: true,
      });

      if (apiKey === undefined) return;

      await zenProvider.setApiKey(apiKey);
      await goProvider.setApiKey(apiKey);

      if (apiKey) {
        vscode.window.showInformationMessage('OpenCode Zen: API key saved.');
      } else {
        vscode.window.showInformationMessage('OpenCode Zen: API key cleared.');
      }

      await refreshStatusBar();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('opencode-zen.refreshModels', async () => {
      zenProvider.invalidateModelCache();
      goProvider.invalidateModelCache();
      zenProvider.refreshModels();
      goProvider.refreshModels();
      await refreshStatusBar();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('opencode-zen.clearUsage', () => {
      usageTracker.clear();
      vscode.window.showInformationMessage('OpenCode Zen: Usage stats cleared.');
    })
  );

  // Initial probe
  const initialProbe = setTimeout(() => {
    void refreshStatusBar();
  }, 2000);
  context.subscriptions.push({ dispose: () => clearTimeout(initialProbe) });
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
