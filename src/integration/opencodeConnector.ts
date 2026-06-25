import { workspace, Uri, EventEmitter, OutputChannel, ExtensionContext, FileSystemWatcher, RelativePattern } from 'vscode';
import { basename, dirname } from 'path';
import { existsSync } from 'fs';
import { OpenCodeHealthResponse } from '../client/types';
import { readLocalKeys, LocalKeys, getAuthPath } from './authReader';

interface OpenCodeDetection {
  installed: boolean;
  authExists: boolean;
  zenKeyAvailable: boolean;
  goKeyAvailable: boolean;
  zenKeyValid: boolean;
  goKeyValid: boolean;
  serverRunning: boolean;
  serverPort?: number;
  configExists: boolean;
}

export class OpenCodeConnector {
  private detection?: OpenCodeDetection;
  private authWatcher?: FileSystemWatcher;
  private readonly _onDidChangeLocalKeys = new EventEmitter<LocalKeys>();
  readonly onDidChangeLocalKeys = this._onDidChangeLocalKeys.event;

  constructor(private readonly outputChannel: OutputChannel) {}

  async detect(): Promise<OpenCodeDetection> {
    if (this.detection) return this.detection;

    this.outputChannel.appendLine('Detecting OpenCode installation...');

    const localKeys = await readLocalKeys();
    const { running: serverRunning, port: serverPort } = await this.detectServer();

    let zenKeyValid = false;
    let goKeyValid = false;
    if (localKeys.zenKey) {
      try {
        const r = await fetch('https://opencode.ai/zen/v1/models', {
          headers: { 'Authorization': `Bearer ${localKeys.zenKey}` },
          signal: AbortSignal.timeout(5000),
        });
        zenKeyValid = r.ok;
      } catch { /* ignore */ }
    }
    if (localKeys.goKey) {
      try {
        const r = await fetch('https://opencode.ai/zen/go/v1/models', {
          headers: { 'Authorization': `Bearer ${localKeys.goKey}` },
          signal: AbortSignal.timeout(5000),
        });
        goKeyValid = r.ok;
      } catch { /* ignore */ }
    }

    const authPath = getAuthPath();
    const authExists = existsSync(authPath);

    this.detection = {
      installed: authExists,
      authExists,
      zenKeyAvailable: !!localKeys.zenKey,
      goKeyAvailable: !!localKeys.goKey,
      zenKeyValid,
      goKeyValid,
      serverRunning,
      serverPort,
      configExists: false,
    };

    this.outputChannel.appendLine(
      `OpenCode detection: installed=${this.detection.installed}, ` +
      `zenKey=${this.detection.zenKeyAvailable}, goKey=${this.detection.goKeyAvailable}, ` +
      `server=${this.detection.serverRunning}`
    );

    return this.detection;
  }

  async getLocalKeys(): Promise<LocalKeys> {
    return readLocalKeys();
  }

  async hasLocalKeys(): Promise<boolean> {
    const keys = await readLocalKeys();
    return !!(keys.zenKey || keys.goKey);
  }

  watchAuthFile(context: ExtensionContext): void {
    if (this.authWatcher) return;
    const authPath = getAuthPath();
    const pattern = new RelativePattern(
      Uri.file(dirname(authPath)),
      basename(authPath)
    );
    this.authWatcher = workspace.createFileSystemWatcher(pattern);
    this.authWatcher.onDidChange(async () => {
      this.outputChannel.appendLine('auth.json changed');
      const newKeys = await readLocalKeys();
      this._onDidChangeLocalKeys.fire(newKeys);
    });
    this.authWatcher.onDidCreate(async () => {
      this.outputChannel.appendLine('auth.json created');
      const newKeys = await readLocalKeys();
      this._onDidChangeLocalKeys.fire(newKeys);
    });
    this.authWatcher.onDidDelete(() => {
      this.outputChannel.appendLine('auth.json deleted');
    });
    context.subscriptions.push(this.authWatcher);
  }

  invalidate(): void {
    this.detection = undefined;
  }

  dispose(): void {
    this.authWatcher?.dispose();
    this._onDidChangeLocalKeys.dispose();
  }

  private async detectServer(): Promise<{ running: boolean; port?: number }> {
    const ports = [4096, 4097, 4098];
    for (const port of ports) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/global/health`, {
          signal: AbortSignal.timeout(1000),
        });
        if (response.ok) {
          const data = await response.json() as OpenCodeHealthResponse;
          if (data.healthy) return { running: true, port };
        }
      } catch {
        // Not running on this port
      }
    }
    return { running: false };
  }
}
