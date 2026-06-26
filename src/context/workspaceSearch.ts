import { EventEmitter, Event, CancellationToken, workspace, Uri, Disposable } from 'vscode';
import { ContextProvider, ContextItem } from './types';

interface FileEntry {
  uri: Uri;
  relativePath: string;
  size: number;
}

export class WorkspaceSearchProvider implements ContextProvider {
  readonly onDidChange: Event<void>;

  private readonly _onDidChange = new EventEmitter<void>();

  constructor() {
    this.onDidChange = this._onDidChange.event;
  }

  dispose(): void {
    this._onDidChange.dispose();
  }

  async provideContext(token: CancellationToken): Promise<ContextItem[]> {
    if (token.isCancellationRequested) return [];

    const folders = workspace.workspaceFolders;
    if (!folders) return [];

    const items: ContextItem[] = [];

    for (const folder of folders) {
      if (token.isCancellationRequested) break;

      const label = folders.length === 1
        ? 'Workspace Structure'
        : `Workspace: ${folder.name}`;

      const tree = await this.buildFileTree(folder.uri, folder.name, token);
      if (tree) {
        items.push({
          kind: 'workspace-structure',
          label,
          content: tree,
          priority: 30,
        });
      }
    }

    return items;
  }

  private async buildFileTree(root: Uri, rootName: string, token: CancellationToken): Promise<string | null> {
    const patterns = [
      '**/package.json',
      '**/*.tsconfig.json',
      '**/*.config.*',
      '**/*.env*',
      '**/Dockerfile*',
      '**/docker-compose*',
      '**/*.md',
      '**/Makefile',
      '**/*.gitignore',
      '**/eslintrc*',
      '**/.prettierrc*',
      '**/Cargo.toml',
      '**/go.mod',
      '**/requirements.txt',
      '**/pyproject.toml',
      '**/pom.xml',
      '**/build.gradle*',
    ];

    const excludePatterns = '**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/target/**,**/__pycache__/**,**/.next/**';

    const configFiles: FileEntry[] = [];
    const sourceDirs = new Set<string>();
    const seen = new Set<string>();

    for (const pattern of patterns) {
      if (token.isCancellationRequested) break;

      const uris = await workspace.findFiles(pattern, `{${excludePatterns}}`, 50);
      for (const uri of uris) {
        if (token.isCancellationRequested) break;
        const rel = workspace.asRelativePath(uri);
        if (seen.has(rel)) continue;
        seen.add(rel);
        try {
          const stat = await workspace.fs.stat(uri);
          configFiles.push({ uri, relativePath: rel, size: stat.size });
        } catch {
          // skip inaccessible files
        }
      }
    }

    const sorted = configFiles.sort((a, b) => {
      const aIsDir = a.uri.path.endsWith('/');
      const bIsDir = b.uri.path.endsWith('/');
      if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
      return a.relativePath.localeCompare(b.relativePath);
    });

    if (sorted.length === 0) return `Root: ${rootName}\n(No config files detected)`;

    const lines: string[] = [`Root: ${rootName}`];

    for (const file of sorted) {
      if (token.isCancellationRequested) break;
      const sizeLabel = file.size > 1024
        ? ` (${(file.size / 1024).toFixed(1)} KB)`
        : ` (${file.size} B)`;
      lines.push(`  ${file.relativePath}${sizeLabel}`);
    }

    return lines.join('\n');
  }
}
