import * as vscode from 'vscode';

const SECRET_KEY = 'opencode-zen.apiKey';

export class SecretStorage {
  private secrets: vscode.SecretStorage;

  constructor(context: vscode.ExtensionContext) {
    this.secrets = context.secrets;
  }

  async getApiKey(): Promise<string> {
    const key = await this.secrets.get(SECRET_KEY);
    return key ?? '';
  }

  async setApiKey(apiKey: string): Promise<void> {
    if (apiKey.trim().length === 0) {
      await this.secrets.delete(SECRET_KEY);
    } else {
      await this.secrets.store(SECRET_KEY, apiKey.trim());
    }
  }

  async deleteApiKey(): Promise<void> {
    await this.secrets.delete(SECRET_KEY);
  }
}
