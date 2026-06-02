import * as vscode from 'vscode';

const ZEN_SECRET_KEY = 'opencode-zen.zenKey';
const GO_SECRET_KEY = 'opencode-zen.goKey';

export class SecretStorage {
  private secrets: vscode.SecretStorage;

  constructor(context: vscode.ExtensionContext) {
    this.secrets = context.secrets;
  }

  async getZenKey(): Promise<string> {
    const key = await this.secrets.get(ZEN_SECRET_KEY);
    return key ?? '';
  }

  async setZenKey(apiKey: string): Promise<void> {
    if (apiKey.trim().length === 0) {
      await this.secrets.delete(ZEN_SECRET_KEY);
    } else {
      await this.secrets.store(ZEN_SECRET_KEY, apiKey.trim());
    }
  }

  async clearZenKey(): Promise<void> {
    await this.secrets.delete(ZEN_SECRET_KEY);
  }

  async getGoKey(): Promise<string> {
    const key = await this.secrets.get(GO_SECRET_KEY);
    return key ?? '';
  }

  async setGoKey(apiKey: string): Promise<void> {
    if (apiKey.trim().length === 0) {
      await this.secrets.delete(GO_SECRET_KEY);
    } else {
      await this.secrets.store(GO_SECRET_KEY, apiKey.trim());
    }
  }

  async clearGoKey(): Promise<void> {
    await this.secrets.delete(GO_SECRET_KEY);
  }
}
