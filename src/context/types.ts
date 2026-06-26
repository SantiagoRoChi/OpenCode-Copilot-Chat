import { Event, CancellationToken } from 'vscode';

export interface ContextItem {
  kind: string;
  label: string;
  content: string;
  priority: number;
}

export interface ContextProvider {
  readonly onDidChange: Event<void>;
  provideContext(token: CancellationToken): Promise<ContextItem[]>;
}
