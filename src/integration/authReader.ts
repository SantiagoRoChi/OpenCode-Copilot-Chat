import * as os from 'os';
import * as path from 'path';
import { OpenCodeAuthFile, OpenCodeAuthEntry } from '../client/types';

let fsModule: typeof import('fs') | undefined;
try {
  fsModule = require('fs') as typeof import('fs');
} catch {
  // fs not available in web worker context
}

function getAuthPath(): string {
  const home = os.homedir();
  switch (process.platform) {
    case 'win32':
      return path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'opencode', 'auth.json');
    case 'darwin':
      return path.join(home, '.local', 'share', 'opencode', 'auth.json');
    default:
      return path.join(home, '.local', 'share', 'opencode', 'auth.json');
  }
}

function getConfigPath(): string {
  return path.join(os.homedir(), '.config', 'opencode', 'opencode.json');
}

export async function readAuthJson(): Promise<OpenCodeAuthFile | null> {
  if (!fsModule) return null;
  const authPath = getAuthPath();
  try {
    const exists = fsModule.existsSync(authPath);
    if (!exists) return null;
    const content = fsModule.readFileSync(authPath, 'utf-8');
    return JSON.parse(content) as OpenCodeAuthFile;
  } catch {
    return null;
  }
}

export async function readZenApiKey(): Promise<string | null> {
  const auth = await readAuthJson();
  if (!auth) return null;

  const zenEntry = auth['opencode'] || auth['openai-compatible'];
  if (zenEntry?.apiKey) {
    return zenEntry.apiKey;
  }

  for (const [key, value] of Object.entries(auth)) {
    if (key.toLowerCase().includes('zen') && value.apiKey) {
      return value.apiKey;
    }
  }

  return null;
}

export async function readOpenCodeConfig(): Promise<Record<string, unknown> | null> {
  if (!fsModule) return null;
  const configPath = getConfigPath();
  try {
    const exists = fsModule.existsSync(configPath);
    if (!exists) return null;
    const content = fsModule.readFileSync(configPath, 'utf-8');
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function isZenKeyValid(apiKey: string): Promise<boolean> {
  try {
    const response = await fetch('https://opencode.ai/zen/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
