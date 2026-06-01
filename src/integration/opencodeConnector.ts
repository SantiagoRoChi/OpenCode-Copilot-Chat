import * as os from 'os';
import * as path from 'path';
import { OpenCodeHealthResponse } from '../client/types';
import { readZenApiKey, readOpenCodeConfig, isZenKeyValid } from './authReader';

let fsModule: typeof import('fs') | undefined;
try {
  fsModule = require('fs') as typeof import('fs');
} catch {
  // fs not available
}

interface OpenCodeDetection {
  installed: boolean;
  authExists: boolean;
  zenKeyAvailable: boolean;
  zenKeyValid: boolean;
  serverRunning: boolean;
  serverPort?: number;
  configExists: boolean;
}

export class OpenCodeConnector {
  private detection?: OpenCodeDetection;
  private outputChannel: { appendLine(msg: string): void };

  constructor(outputChannel: { appendLine(msg: string): void }) {
    this.outputChannel = outputChannel;
  }

  async detect(): Promise<OpenCodeDetection> {
    if (this.detection) {
      return this.detection;
    }

    this.outputChannel.appendLine('Detecting OpenCode installation...');

    const authExists = !!(await readAuthJson());
    const zenApiKey = authExists ? await readZenApiKey() : null;
    const zenKeyValid = zenApiKey ? await isZenKeyValid(zenApiKey) : false;
    const configExists = !!(await readOpenCodeConfig());
    const { running: serverRunning, port: serverPort } = await this.detectServer();

    this.detection = {
      installed: authExists || configExists,
      authExists,
      zenKeyAvailable: !!zenApiKey,
      zenKeyValid,
      serverRunning,
      serverPort,
      configExists,
    };

    this.outputChannel.appendLine(
      `OpenCode detection: installed=${this.detection.installed}, ` +
      `auth=${this.detection.authExists}, zenKey=${this.detection.zenKeyAvailable}, ` +
      `server=${this.detection.serverRunning}`
    );

    return this.detection;
  }

  async getZenApiKey(): Promise<string | null> {
    return readZenApiKey();
  }

  async invalidate(): Promise<void> {
    this.detection = undefined;
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
          if (data.healthy) {
            return { running: true, port };
          }
        }
      } catch {
        // Not running on this port
      }
    }

    return { running: false };
  }
}

async function readAuthJson(): Promise<Record<string, unknown> | null> {
  if (!fsModule) return null;
  const home = os.homedir();
  let authPath: string;

  switch (process.platform) {
    case 'win32':
      authPath = path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'opencode', 'auth.json');
      break;
    case 'darwin':
      authPath = path.join(home, '.local', 'share', 'opencode', 'auth.json');
      break;
    default:
      authPath = path.join(home, '.local', 'share', 'opencode', 'auth.json');
  }

  try {
    const exists = fsModule.existsSync(authPath);
    if (!exists) return null;
    const content = fsModule.readFileSync(authPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}
