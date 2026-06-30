import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

export interface OpenCodeSessionRow {
  id: string;
  project_id: string;
  directory: string;
  title: string;
  version: string;
  time_created: number;
  time_updated: number;
  time_archived: number | null;
  agent: string | null;
  model: string | null;
  cost: number | null;
  tokens_input: number | null;
  tokens_output: number | null;
  summary_additions: number | null;
  summary_deletions: number | null;
  summary_files: number | null;
}

export interface OpenCodeMessageData {
  role: 'user' | 'assistant';
  modelID?: string;
  providerID?: string;
  time?: { created: number };
  finish?: { reason?: string };
}

export interface OpenCodePartData {
  type: 'text' | 'reasoning' | 'tool' | 'file' | 'snapshot' | 'patch' | 'agent' | 'compaction' | 'subtask' | 'retry' | 'step-start' | 'step-finish';
  text?: string;
  [key: string]: unknown;
}

export interface OpenCodeProject {
  id: string;
  name: string | null;
  worktree: string;
}

let _dbPath: string | null = null;

export function findOpenCodeDB(): string | null {
  const envDb = process.env['OPENCODE_DB'];
  if (envDb) {
    if (path.isAbsolute(envDb) && fs.existsSync(envDb)) return envDb;
    const relative = path.join(os.homedir(), '.local', 'share', 'opencode', envDb);
    if (fs.existsSync(relative)) return relative;
  }

  const xdgData = process.env['XDG_DATA_HOME']
    ? path.join(process.env['XDG_DATA_HOME'], 'opencode', 'opencode.db')
    : path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
  if (fs.existsSync(xdgData)) return xdgData;

  const homeDb = path.join(os.homedir(), '.opencode', 'opencode.db');
  if (fs.existsSync(homeDb)) return homeDb;

  if (process.platform === 'win32') {
    const appData = process.env['APPDATA'];
    if (appData) {
      const appDataDb = path.join(appData, 'opencode', 'opencode.db');
      if (fs.existsSync(appDataDb)) return appDataDb;
    }
    const localAppData = process.env['LOCALAPPDATA'];
    if (localAppData) {
      const localDb = path.join(localAppData, 'opencode', 'opencode.db');
      if (fs.existsSync(localDb)) return localDb;
    }
  }
  return null;
}

export function getDBPath(): string | null {
  if (_dbPath) return _dbPath;
  _dbPath = findOpenCodeDB();
  return _dbPath;
}

export function hasOpenCodeDB(): boolean {
  return getDBPath() !== null;
}

export function isOpenCodeCLIInstalled(): boolean {
  try {
    execSync('opencode --version', { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export function listSessionsViaCLI(limit = 100): OpenCodeSessionRow[] {
  try {
    const output = execSync(`opencode session list --json --limit ${limit}`, {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: 'pipe',
    });
    const data = JSON.parse(output);
    return Array.isArray(data) ? data : data.sessions ?? data.data ?? [];
  } catch {
    return [];
  }
}

function queryAll<T>(sql: string): T[] {
  const dbPath = getDBPath();
  if (!dbPath) return [];

  try {
    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (path: string, opts?: { open?: boolean }) => {
        prepare(sql: string): { all(): T[]; free(): void };
        close(): void;
      };
    };
    const db = new DatabaseSync(dbPath, { open: true });
    const stmt = db.prepare(sql);
    const rows = stmt.all() as T[];
    stmt.free();
    try { db.close(); } catch { }
    return rows;
  } catch {
    try {
      const output = execSync(
        `sqlite3 "${dbPath}" "${sql.replace(/"/g, '\\"')}"`,
        { encoding: 'utf-8', timeout: 10000, stdio: 'pipe' }
      );
      if (!output.trim()) return [];
      return output.trim().split('\n').map(line => {
        try { return JSON.parse(line); }
        catch { return null; }
      }).filter(Boolean) as T[];
    } catch {
      return [];
    }
  }
}

export function listSessions(workspaceDirectory?: string): OpenCodeSessionRow[] {
  const conditions = ['time_archived IS NULL'];
  if (workspaceDirectory) {
    conditions.push(`directory = '${workspaceDirectory.replace(/'/g, "''")}'`);
  }
  const sql = `SELECT * FROM session WHERE ${conditions.join(' AND ')} ORDER BY time_updated DESC LIMIT 100`;
  return queryAll<OpenCodeSessionRow>(sql);
}

export function listSessionsGlobal(): OpenCodeSessionRow[] {
  return queryAll<OpenCodeSessionRow>(
    `SELECT * FROM session WHERE time_archived IS NULL ORDER BY time_updated DESC LIMIT 200`
  );
}

export function getSessionMessages(sessionId: string): Array<{ id: string; session_id: string; time_created: number; data: string }> {
  return queryAll<{ id: string; session_id: string; time_created: number; data: string }>(
    `SELECT id, session_id, time_created, data FROM message WHERE session_id = '${sessionId.replace(/'/g, "''")}' ORDER BY time_created ASC`
  );
}

export function getMessageParts(messageId: string): Array<{ id: string; message_id: string; session_id: string; time_created: number; data: string }> {
  return queryAll<{ id: string; message_id: string; session_id: string; time_created: number; data: string }>(
    `SELECT id, message_id, session_id, time_created, data FROM part WHERE message_id = '${messageId.replace(/'/g, "''")}' ORDER BY time_created ASC`
  );
}

export function getProjects(): OpenCodeProject[] {
  return queryAll<OpenCodeProject>(
    `SELECT id, name, worktree FROM project ORDER BY name`
  );
}
