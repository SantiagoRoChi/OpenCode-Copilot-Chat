import { EventEmitter, Event, CancellationToken, workspace, Disposable } from 'vscode';
import { exec } from 'child_process';
import { ContextProvider, ContextItem } from './types';

interface GitStatus {
  root: string;
  branch: string;
  staged: string[];
  unstaged: string[];
  untracked: string[];
  ahead: number;
  behind: number;
}

function runGit(root: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(`git ${args.join(' ')}`, { cwd: root, timeout: 5000 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.trim());
    });
  });
}

async function getGitStatus(root: string): Promise<GitStatus | null> {
  try {
    const branchOut = await runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (!branchOut) return null;

    const statusOut = await runGit(root, ['status', '--short', '--branch', '--porcelain']);

    const staged: string[] = [];
    const unstaged: string[] = [];
    const untracked: string[] = [];
    let branch = 'HEAD';
    let ahead = 0;
    let behind = 0;

    for (const line of statusOut.split('\n')) {
      if (line.startsWith('## ')) {
        const match = line.match(/## (.+?)(?:\.\.\.|$)/);
        if (match) branch = match[1];
        const aheadMatch = line.match(/ahead (\d+)/);
        if (aheadMatch) ahead = parseInt(aheadMatch[1], 10);
        const behindMatch = line.match(/behind (\d+)/);
        if (behindMatch) behind = parseInt(behindMatch[1], 10);
        continue;
      }

      if (line.length < 3) continue;
      const idx = line[0] === ' ' && line[1] === '?' ? 3 : 0;
      const xy = line.slice(0, 2);
      const file = line.slice(3).trim();

      if (xy.includes('?')) {
        untracked.push(file);
      } else if (xy.trim()) {
        if (xy[0] !== ' ') staged.push(file);
        if (xy[1] !== ' ') unstaged.push(file);
      }
    }

    return { root, branch, staged, unstaged, untracked, ahead, behind };
  } catch {
    return null;
  }
}

export class ScmProvider implements ContextProvider {
  readonly onDidChange: Event<void>;

  private readonly _onDidChange = new EventEmitter<void>();
  private _watcher: Disposable | undefined;

  constructor() {
    this.onDidChange = this._onDidChange.event;

    this._watcher = workspace.onDidChangeWorkspaceFolders(() => {
      this._onDidChange.fire();
    });
  }

  dispose(): void {
    this._watcher?.dispose();
    this._onDidChange.dispose();
  }

  async provideContext(token: CancellationToken): Promise<ContextItem[]> {
    if (token.isCancellationRequested) return [];

    const folders = workspace.workspaceFolders;
    if (!folders) return [];

    const items: ContextItem[] = [];

    for (const folder of folders) {
      if (token.isCancellationRequested) break;

      const status = await getGitStatus(folder.uri.fsPath);
      if (!status) continue;

      const lines: string[] = [];
      lines.push(`Branch: ${status.branch}`);
      if (status.ahead > 0 || status.behind > 0) {
        const parts: string[] = [];
        if (status.ahead > 0) parts.push(`${status.ahead} ahead`);
        if (status.behind > 0) parts.push(`${status.behind} behind`);
        lines.push(`Remote: ${parts.join(', ')}`);
      }

      const totalChanges = status.staged.length + status.unstaged.length + status.untracked.length;
      lines.push(`Total changes: ${totalChanges}`);

      if (status.staged.length > 0) {
        lines.push(`\nStaged (${status.staged.length}):`);
        for (const f of status.staged.slice(0, 20)) {
          lines.push(`  + ${f}`);
        }
      }

      if (status.unstaged.length > 0) {
        lines.push(`\nModified (${status.unstaged.length}):`);
        for (const f of status.unstaged.slice(0, 20)) {
          lines.push(`  M ${f}`);
        }
      }

      if (status.untracked.length > 0) {
        lines.push(`\nUntracked (${status.untracked.length}):`);
        for (const f of status.untracked.slice(0, 20)) {
          lines.push(`  ? ${f}`);
        }
      }

      const label = folder.name === workspace.name
        ? `SCM: ${status.branch}`
        : `SCM: ${folder.name} (${status.branch})`;

      items.push({
        kind: 'scm',
        label,
        content: lines.join('\n'),
        priority: totalChanges > 0 ? 60 : 20,
      });
    }

    return items;
  }
}
