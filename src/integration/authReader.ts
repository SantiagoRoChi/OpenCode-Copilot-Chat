import { homedir } from 'os';
import { join } from 'path';
import { OpenCodeAuthFile, OpenCodeHealthResponse } from '../client/types';
import { ZEN_MODEL_ID, GO_MODEL_ID } from '../client/endpoints';

let fsModule: typeof import('fs') | undefined;
try {
  fsModule = require('fs') as typeof import('fs');
} catch {
  // fs not available in web worker context
}

export function getAuthPath(): string {
  const home = homedir();
  switch (process.platform) {
    case 'win32':
      return join(process.env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'opencode', 'auth.json');
    case 'darwin':
      return join(home, '.local', 'share', 'opencode', 'auth.json');
    default:
      return join(home, '.local', 'share', 'opencode', 'auth.json');
  }
}

function getConfigPath(): string {
  return join(homedir(), '.config', 'opencode', 'opencode.json');
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

export async function readZenKey(): Promise<string | null> {
  const auth = await readAuthJson();
  if (!auth) return null;
  const entry = auth[ZEN_MODEL_ID];
  if (entry?.apiKey) return entry.apiKey;
  for (const [key, value] of Object.entries(auth)) {
    if (key.toLowerCase().includes('zen') && value.apiKey) return value.apiKey;
  }
  return null;
}

export async function readGoKey(): Promise<string | null> {
  const auth = await readAuthJson();
  if (!auth) return null;
  const entry = auth[GO_MODEL_ID];
  if (entry?.apiKey) return entry.apiKey;
  return null;
}

export interface LocalKeys {
  zenKey?: string;
  goKey?: string;
}

export async function readLocalKeys(): Promise<LocalKeys> {
  const [zenKey, goKey] = await Promise.all([readZenKey(), readGoKey()]);
  return { zenKey: zenKey ?? undefined, goKey: goKey ?? undefined };
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

export async function isGoKeyValid(apiKey: string): Promise<boolean> {
  try {
    const response = await fetch('https://opencode.ai/zen/go/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
