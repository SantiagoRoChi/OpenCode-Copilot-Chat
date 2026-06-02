import * as vscode from 'vscode';
import { OpenCodeFreeProvider } from './providers/OpenCodeFreeProvider';
import { OpenCodeGoProvider } from './providers/OpenCodeGoProvider';
import { OpenCodeZenProvider } from './providers/OpenCodeZenProvider';
import { StatusBarManager } from './status/statusBar';
import { UsageTracker, UsageStats, formatUsageOutput } from './usage/UsageTracker';
import { SessionTreeProvider } from './status/sessionTree';
import { GlobalTreeProvider } from './status/globalTree';
import { ConfigTreeProvider } from './status/configTree';
import { OpenCodeConnector } from './integration/opencodeConnector';
import { SecretStorage } from './config/secretStorage';
import { TokenUsage } from './client/types';

let freeProvider: OpenCodeFreeProvider;
let goProvider: OpenCodeGoProvider;
let zenProvider: OpenCodeZenProvider;
let statusBar: StatusBarManager;
let sessionTree: SessionTreeProvider;
let globalTree: GlobalTreeProvider;
let configTree: ConfigTreeProvider;
let connector: OpenCodeConnector;
let secretStorage: SecretStorage;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('OpenCode Zen: activating...');

  freeProvider = new OpenCodeFreeProvider(context);
  goProvider = new OpenCodeGoProvider(context);
  zenProvider = new OpenCodeZenProvider(context);

  await Promise.all([
    freeProvider.loadApiKey(),
    goProvider.loadApiKey(),
    zenProvider.loadApiKey(),
  ]);

  connector = new OpenCodeConnector(zenProvider['outputChannel']);
  secretStorage = new SecretStorage(context);
  connector.watchAuthFile(context);
  context.subscriptions.push(connector);

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
        void updateAllTrees();
      }
    })
  );

  context.subscriptions.push(
    vscode.lm.registerLanguageModelChatProvider('opencode-free', freeProvider),
    vscode.lm.registerLanguageModelChatProvider('opencode-go', goProvider),
    vscode.lm.registerLanguageModelChatProvider('opencode-zen', zenProvider),
  );

  statusBar = new StatusBarManager(() => zenProvider.getStatusSnapshot());
  statusBar.show();
  context.subscriptions.push(statusBar);

  sessionTree = new SessionTreeProvider();
  globalTree = new GlobalTreeProvider();
  configTree = new ConfigTreeProvider();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('opencode-zen-session-tree', sessionTree),
    vscode.window.registerTreeDataProvider('opencode-zen-global-tree', globalTree),
    vscode.window.registerTreeDataProvider('opencode-zen-config-tree', configTree),
  );

  const updateAllTrees = async () => {
    const [zenKey, goKey] = await Promise.all([
      secretStorage.getZenKey(),
      secretStorage.getGoKey(),
    ]);

    const combined = aggregateUsageStats([
      zenProvider.getUsageTracker().getStats(),
      goProvider.getUsageTracker().getStats(),
      freeProvider.getUsageTracker().getStats(),
    ]);

    sessionTree.update({
      zenKey, goKey, sessionStats: combined,
    });

    configTree.update(zenKey, goKey);

    let zenStatus: 'pending' | 'error' | 'ok' | 'no-endpoint' = 'pending';
    let goStatus: 'pending' | 'error' | 'ok' | 'no-endpoint' = 'pending';
    let zenUsage: any;
    let goUsage: any;

    try {
      const zu = await zenProvider.fetchApiUsage().catch(() => undefined);
      const gu = await goProvider.fetchApiUsage().catch(() => undefined);
      zenUsage = zu;
      goUsage = gu;
      zenStatus = 'ok';
      goStatus = 'ok';
    } catch {
      zenStatus = 'error';
      goStatus = 'error';
    }

    globalTree.update({
      zenKey, goKey,
      zenStatus, goStatus,
      zenFamilies: zenProvider.getModelFamilies(),
      goFamilies: goProvider.getModelFamilies(),
      zenUsage: zenUsage || undefined,
      goUsage: goUsage || undefined,
    });
  };

  const onUsageChange = () => { void updateAllTrees(); };
  zenProvider.getUsageTracker().onDidChangeUsage(onUsageChange);
  goProvider.getUsageTracker().onDidChangeUsage(onUsageChange);
  freeProvider.getUsageTracker().onDidChangeUsage(onUsageChange);

  const refreshInterval = setInterval(() => { void updateAllTrees(); }, 30000);
  context.subscriptions.push({ dispose: () => clearInterval(refreshInterval) });

  void updateAllTrees();

  const handleRequestState = (event: any) => {
    switch (event.kind) {
      case 'start': statusBar.setStreaming(event.modelId, event.modelName); break;
      case 'complete': statusBar.setResponded(event.modelId, event.modelName); break;
      case 'error': statusBar.setError(event.errorMessage); break;
    }
  };

  context.subscriptions.push(
    zenProvider.onDidChangeRequestState(handleRequestState),
    goProvider.onDidChangeRequestState(handleRequestState),
    freeProvider.onDidChangeRequestState(handleRequestState),
    zenProvider.onDidChangeLanguageModelChatInformation(() => statusBar.refreshTooltip()),
    goProvider.onDidChangeLanguageModelChatInformation(() => statusBar.refreshTooltip()),
    freeProvider.onDidChangeLanguageModelChatInformation(() => statusBar.refreshTooltip()),
  );

  const configureZen = async () => {
    const apiKey = await vscode.window.showInputBox({
      title: 'OpenCode Zen — API Key',
      prompt: 'Enter your OpenCode Zen/Go API key. Get one at opencode.ai/auth',
      password: true, placeHolder: 'oc-...', ignoreFocusOut: true,
    });
    if (apiKey === undefined) return;
    await zenProvider.setApiKey(apiKey);
    await freeProvider.setApiKey(apiKey);
    await secretStorage.setZenKey(apiKey);
    vscode.window.showInformationMessage(apiKey ? 'OpenCode Zen: API key saved.' : 'OpenCode Zen: API key cleared.');
    void updateAllTrees();
  };

  const configureGo = async () => {
    const apiKey = await vscode.window.showInputBox({
      title: 'OpenCode Go — API Key',
      prompt: 'Enter your OpenCode Go API key. Get one at opencode.ai/auth',
      password: true, placeHolder: 'oc-...', ignoreFocusOut: true,
    });
    if (apiKey === undefined) return;
    await goProvider.setApiKey(apiKey);
    await secretStorage.setGoKey(apiKey);
    vscode.window.showInformationMessage(apiKey ? 'OpenCode Go: API key saved.' : 'OpenCode Go: API key cleared.');
    void updateAllTrees();
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('opencode-zen.showOutput', () => zenProvider.showOutput()),
    vscode.commands.registerCommand('opencode-zen.showUsage', () => vscode.commands.executeCommand('workbench.view.opencode-zen-sidebar')),
    vscode.commands.registerCommand('opencode-zen.showGlobal', () => vscode.commands.executeCommand('workbench.view.opencode-zen-global')),
    vscode.commands.registerCommand('opencode-zen.showConfig', () => vscode.commands.executeCommand('workbench.view.opencode-zen-config')),
    vscode.commands.registerCommand('opencode-zen.showOutputLog', () => {
      const stats = aggregateUsageStats([
        zenProvider.getUsageTracker().getStats(),
        goProvider.getUsageTracker().getStats(),
        freeProvider.getUsageTracker().getStats(),
      ]);
      zenProvider.showOutput();
      zenProvider.appendOutput(formatUsageOutput(stats));
    }),
    vscode.commands.registerCommand('opencode-zen.configureZen', configureZen),
    vscode.commands.registerCommand('opencode-zen.configureGo', configureGo),
    vscode.commands.registerCommand('opencode-zen.refreshAll', () => {
      zenProvider.refreshModels();
      goProvider.refreshModels();
      freeProvider.refreshModels();
      vscode.window.showInformationMessage('OpenCode Zen: All models refreshed.');
    }),
    vscode.commands.registerCommand('opencode-zen.refreshTree', () => sessionTree.refresh()),
    vscode.commands.registerCommand('opencode-zen.refreshGlobal', async () => {
      zenProvider.refreshModels();
      goProvider.refreshModels();
      await updateAllTrees();
      vscode.window.showInformationMessage('Global usage refreshed.');
    }),
    vscode.commands.registerCommand('opencode-zen.clearUsage', () => {
      zenProvider.getUsageTracker().clear();
      goProvider.getUsageTracker().clear();
      freeProvider.getUsageTracker().clear();
      vscode.window.showInformationMessage('OpenCode Zen: Usage stats cleared.');
      void updateAllTrees();
    }),
  );

  const initialProbe = setTimeout(() => { void refreshStatusBar(); }, 2000);
  context.subscriptions.push({ dispose: () => clearTimeout(initialProbe) });
}

function aggregateUsageStats(statsList: UsageStats[]): UsageStats {
  const totalRequests = statsList.reduce((s, x) => s + x.totalRequests, 0);
  const totalTokens = statsList.reduce(
    (acc, st) => ({ prompt: acc.prompt + st.totalTokens.prompt, completion: acc.completion + st.totalTokens.completion, total: acc.total + st.totalTokens.total }),
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
    const models = await zenProvider.provideLanguageModelChatInformation({ silent: true }, cts.token);
    if (models.length > 0) statusBar.setIdle(models.length);
    else statusBar.setNoModels();
  } catch (err) {
    statusBar.setError(err instanceof Error ? err.message : String(err));
  } finally {
    cts.dispose();
  }
}

export function deactivate(): void {}