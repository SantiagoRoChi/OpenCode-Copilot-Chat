import { EventEmitter, Event, CancellationToken } from 'vscode';
import { ContextProvider, ContextItem } from './types';

export class ContextManager implements ContextProvider {
  readonly onDidChange: Event<void>;

  private readonly providers: ContextProvider[] = [];
  private readonly _onDidChange = new EventEmitter<void>();

  constructor() {
    this.onDidChange = this._onDidChange.event;
  }

  addProvider(provider: ContextProvider): void {
    this.providers.push(provider);
    provider.onDidChange(() => this._onDidChange.fire());
  }

  async provideContext(token: CancellationToken): Promise<ContextItem[]> {
    if (token.isCancellationRequested) return [];

    const results = await Promise.all(
      this.providers.map(p => p.provideContext(token))
    );

    const all = results.flat();
    all.sort((a, b) => b.priority - a.priority);
    return all;
  }

  async formatContext(token: CancellationToken): Promise<string> {
    const items = await this.provideContext(token);
    if (items.length === 0) return '';

    const parts = items.map(item =>
      `## ${item.label}\n\n${item.content}`
    );

    return parts.join('\n\n');
  }

  dispose(): void {
    for (const p of this.providers) {
      if ('dispose' in p && typeof (p as any).dispose === 'function') {
        (p as any).dispose();
      }
    }
    this._onDidChange.dispose();
  }
}
