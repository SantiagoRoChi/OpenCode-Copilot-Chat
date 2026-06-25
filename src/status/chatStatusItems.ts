import { window, StatusBarAlignment, StatusBarItem, Disposable } from 'vscode';

/** Proposed VS Code API interface for chat status items */
interface ChatStatusItem extends Disposable {
  text: string;
  detail?: string;
  severity?: number;
  show(): void;
  hide(): void;
}

/**
 * Manages chat status items for each provider using the proposed chatStatusItem API.
 * Falls back to status bar items when the API is not available.
 */
export class ChatStatusItemManager {
  private items = new Map<string, ChatStatusItem>();
  private fallbackItems = new Map<string, StatusBarItem>();

  /**
   * Create or update a status item for a provider.
   */
  setStatus(
    providerId: string,
    label: string,
    text: string,
    detail?: string,
    severity?: number
  ): void {
    const extendedWindow = window as typeof window & {
      createChatStatusItem?: (id: string, label: string) => ChatStatusItem;
    };
    if (typeof extendedWindow.createChatStatusItem === 'function') {
      let item = this.items.get(providerId);
      if (!item) {
        item = extendedWindow.createChatStatusItem!(providerId, label);
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
        item = window.createStatusBarItem(StatusBarAlignment.Right, 100);
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
