import * as vscode from 'vscode';
import { ZenProvider, RequestStateEvent } from './provider';
import { StatusBarManager } from './status/statusBar';

let provider: ZenProvider;
let statusBar: StatusBarManager;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('OpenCode Zen: activating...');
  provider = new ZenProvider(context);
  await provider.loadSecrets();

  const disposable = vscode.lm.registerLanguageModelChatProvider('opencode-zen', provider);
  context.subscriptions.push(disposable);

  console.log('OpenCode Zen: provider registered');
  statusBar = new StatusBarManager(() => provider.getStatusSnapshot());
  statusBar.show();
  context.subscriptions.push(statusBar);

  // Live request state
  context.subscriptions.push(
    provider.onDidChangeRequestState((event) => {
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
    })
  );

  // Refresh tooltip on snapshot changes
  context.subscriptions.push(
    provider.onDidChangeStatusSnapshot(() => statusBar.refreshTooltip())
  );

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('opencode-zen.showOutput', () => provider.showOutput())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('opencode-zen.testConnection', async () => {
      try {
        const models = await provider.provideLanguageModelChatInformation(
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
      const currentKey = await provider.provideLanguageModelChatInformation(
        { silent: true },
        new vscode.CancellationTokenSource().token
      ).then(() => '').catch(() => '');

      const apiKey = await vscode.window.showInputBox({
        title: 'OpenCode Zen — API Key',
        prompt: 'Enter your OpenCode Zen API key. Get one at opencode.ai/auth',
        password: true,
        placeHolder: 'oc-...',
        ignoreFocusOut: true,
      });

      if (apiKey === undefined) return;

      await provider.setApiKey(apiKey);

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
      provider.invalidateModelCache();
      provider.refreshModels();
      await refreshStatusBar();
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
    const models = await provider.provideLanguageModelChatInformation(
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
