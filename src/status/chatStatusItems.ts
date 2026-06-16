import * as vscode from 'vscode';

/**
 * Manages chat status items for each provider using the proposed chatStatusItem API.
 * Falls back to status bar items when the API is not available.
 */
export class ChatStatusItemManager {
  private items = new Map<string, any>(); // vscode.ChatStatusItem when available
  private fallbackItems = new Map<string, vscode.StatusBarItem>();

  /**
   * Create or update a status item for a provider.
   */
  setStatus(
    providerId: string,
    label: string,
    text: string,
    detail?: string,
    severity?: any
  ): void {
    const vscodeAny = vscode as any;
    if (typeof vscodeAny.createChatStatusItem === 'function') {
      let item = this.items.get(providerId);
      if (!item) {
        item = vscodeAny.createChatStatusItem(providerId, label);
        this.items.set(providerId, item);
      }
      item.text = text;
      item.detail = detail;
      item.severity = severity;
      item.show();
    } else {
      // Fallback to status bar
      let item = this.fallbackItems.get(providerId);
      if (!item) {
        item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.fallbackItems.set(providerId, item);
      }
      item.text = `$(hubot) ${label}: ${text}`;
      item.tooltip = detail ?? `${label} status`;
      item.show();
    }
  }

  /**
   * Hide a provider's status item.
   */
  hide(providerId: string): void {
    const item = this.items.get(providerId);
    if (item) {
      item.hide();
    }
    const fallback = this.fallbackItems.get(providerId);
    if (fallback) {
      fallback.hide();
    }
  }

  /**
   * Dispose all status items.
   */
  dispose(): void {
    for (const item of this.items.values()) {
      item.dispose();
    }
    this.items.clear();
    for (const item of this.fallbackItems.values()) {
      item.dispose();
    }
    this.fallbackItems.clear();
  }
}

let manager: ChatStatusItemManager | undefined;

export function getChatStatusManager(): ChatStatusItemManager {
  if (!manager) {
    manager = new ChatStatusItemManager();
  }
  return manager;
}

export function disposeChatStatusManager(): void {
  manager?.dispose();
  manager = undefined;
}
