import { window, commands } from 'vscode';

/**
 * Shows a chat input notification when a provider is missing configuration.
 * Uses the proposed chatInputNotification API when available.
 */
export function showMissingConfigNotification(
  providerName: string,
  configureCommand: string
): void {
  const vscodeAny = window as typeof window & { showChatInputNotification?: (opts: { message: string; severity: 0 | 1 | 2; action?: { label: string; command: string } }) => void };
  if (typeof vscodeAny.showChatInputNotification === 'function') {
    void vscodeAny.showChatInputNotification({
      message: `${providerName} is not configured. Set it up to start using the model.`,
      severity: 1 satisfies 0 | 1 | 2,
      action: {
        label: 'Configure',
        command: configureCommand,
      },
    });
  } else {
    // Fallback to standard information message
    void window.showInformationMessage(
      `${providerName} is not configured.`,
      'Configure'
    ).then(choice => {
      if (choice === 'Configure') {
        void commands.executeCommand(configureCommand);
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
  const vscodeAny = window as typeof window & { showChatInputNotification?: (opts: { message: string; severity: 0 | 1 | 2 }) => void };
  if (typeof vscodeAny.showChatInputNotification === 'function') {
    void vscodeAny.showChatInputNotification({
      message: `Connection error for ${providerName}: ${error}`,
      severity: 2 satisfies 0 | 1 | 2,
    });
  } else {
    void window.showErrorMessage(`Connection error for ${providerName}: ${error}`);
  }
}

/**
 * Shows a chat input notification for successful connections.
 */
export function showConnectedNotification(providerName: string): void {
  const vscodeAny = window as typeof window & { showChatInputNotification?: (opts: { message: string; severity: 0 | 1 | 2 }) => void };
  if (typeof vscodeAny.showChatInputNotification === 'function') {
    void vscodeAny.showChatInputNotification({
      message: `${providerName} connected successfully.`,
      severity: 0 satisfies 0 | 1 | 2,
    });
  } else {
    void window.showInformationMessage(`${providerName} connected successfully.`);
  }
}
