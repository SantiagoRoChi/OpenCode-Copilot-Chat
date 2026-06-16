import * as vscode from 'vscode';

/**
 * Shows a chat input notification when a provider is missing configuration.
 * Uses the proposed chatInputNotification API when available.
 */
export function showMissingConfigNotification(
  providerName: string,
  configureCommand: string
): void {
  const vscodeAny = vscode as any;
  if (typeof vscodeAny.showChatInputNotification === 'function') {
    void vscodeAny.showChatInputNotification({
      message: `${providerName} is not configured. Set it up to start using the model.`,
      severity: vscodeAny.SeverityLevel?.Warning ?? 1,
      action: {
        label: 'Configure',
        command: configureCommand,
      },
    });
  } else {
    // Fallback to standard information message
    void vscode.window.showInformationMessage(
      `${providerName} is not configured.`,
      'Configure'
    ).then(choice => {
      if (choice === 'Configure') {
        void vscode.commands.executeCommand(configureCommand);
      }
    });
  }
}

/**
 * Shows a chat input notification for connection errors.
 */
export function showConnectionErrorNotification(
  providerName: string,
  error: string
): void {
  const vscodeAny = vscode as any;
  if (typeof vscodeAny.showChatInputNotification === 'function') {
    void vscodeAny.showChatInputNotification({
      message: `Connection error for ${providerName}: ${error}`,
      severity: vscodeAny.SeverityLevel?.Error ?? 2,
    });
  } else {
    void vscode.window.showErrorMessage(`Connection error for ${providerName}: ${error}`);
  }
}

/**
 * Shows a chat input notification for successful connections.
 */
export function showConnectedNotification(providerName: string): void {
  const vscodeAny = vscode as any;
  if (typeof vscodeAny.showChatInputNotification === 'function') {
    void vscodeAny.showChatInputNotification({
      message: `${providerName} connected successfully.`,
      severity: vscodeAny.SeverityLevel?.Info ?? 0,
    });
  }
}
