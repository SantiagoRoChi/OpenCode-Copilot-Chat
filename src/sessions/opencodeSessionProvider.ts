import {
  Uri, EventEmitter, CancellationToken, CancellationTokenSource, ChatSessionStatus, ChatSessionItem,
  ChatSessionItemController, ChatSessionContentProvider, ChatSession,
  ChatSessionCapabilities, ChatResponseMarkdownPart, ChatRequestTurn,
  ChatResult, ChatResponsePart, ChatResponseTurn2, ChatSessionOptionChangeEvent,
} from 'vscode';
import {
  getDBPath, hasOpenCodeDB, listSessionsGlobal, getSessionMessages,
  getMessageParts, OpenCodeSessionRow, OpenCodeMessageData,
  OpenCodePartData, isOpenCodeCLIInstalled, listSessionsViaCLI,
} from './opencodeDB';
import * as path from 'path';

const SESSION_SCHEME = 'opencode-cli';

export class OpenCodeSessionProvider implements ChatSessionContentProvider {
  private _onDidChangeChatSessionOptions = new EventEmitter<ChatSessionOptionChangeEvent>();
  readonly onDidChangeChatSessionOptions = this._onDidChangeChatSessionOptions.event;

  private _onDidChangeChatSessionProviderOptions = new EventEmitter<void>();
  readonly onDidChangeChatSessionProviderOptions = this._onDidChangeChatSessionProviderOptions.event;

  private controller: ChatSessionItemController | undefined;
  private dbWatchTimer: ReturnType<typeof setInterval> | undefined;

  constructor() {
    this.startDbWatcher();
  }

  private startDbWatcher(): void {
    this.dbWatchTimer = setInterval(() => {
      if (this.controller && hasOpenCodeDB()) {
        const cts = new CancellationTokenSource();
        this.controller.refreshHandler(cts.token);
      }
    }, 30000);
  }

  setController(ctrl: ChatSessionItemController): void {
    this.controller = ctrl;
  }

  dispose(): void {
    if (this.dbWatchTimer) {
      clearInterval(this.dbWatchTimer);
    }
  }

  async refreshItems(controller: ChatSessionItemController, _token: CancellationToken): Promise<void> {
    const items: ChatSessionItem[] = [];

    if (!hasOpenCodeDB() && !isOpenCodeCLIInstalled()) {
      return;
    }

    let sessions: OpenCodeSessionRow[] = [];

    if (hasOpenCodeDB()) {
      sessions = listSessionsGlobal();
    }
    if (sessions.length === 0 && isOpenCodeCLIInstalled()) {
      sessions = listSessionsViaCLI(100);
    }

    const workspaceFolders = this.getWorkspaceFolders();

    for (const session of sessions) {
      const isCurrentWorkspace = workspaceFolders.some(
        wf => session.directory && session.directory.startsWith(wf)
      );

      const sessionId = session.id;
      const resource = Uri.parse(`${SESSION_SCHEME}://${sessionId}`);
      const label = session.title || `Session ${sessionId.slice(0, 12)}`;

      const item = controller.createChatSessionItem(resource, label);

      const dirName = session.directory ? path.basename(session.directory) : '';
      item.description = dirName
        ? `${dirName}${isCurrentWorkspace ? ' (current)' : ''}`
        : undefined;

      if (session.time_archived) {
        item.archived = true;
      }

      item.timing = {
        created: session.time_created,
        lastRequestStarted: session.time_created,
        lastRequestEnded: session.time_updated,
      };

      item.status = ChatSessionStatus.Completed;

      if (session.summary_additions || session.summary_deletions) {
        item.changes = [];
      }

      item.metadata = {
        sessionId: session.id,
        directory: session.directory,
        projectId: session.project_id,
        model: session.model ? tryParseJSON(session.model) : undefined,
        agent: session.agent,
        cost: session.cost,
        tokensInput: session.tokens_input,
        tokensOutput: session.tokens_output,
        summaryFiles: session.summary_files,
        summaryAdditions: session.summary_additions,
        summaryDeletions: session.summary_deletions,
      };

      items.push(item);
    }

    controller.items.replace(items);
  }

  private getWorkspaceFolders(): string[] {
    try {
      const vscode = require('vscode') as typeof import('vscode');
      const folders = vscode.workspace?.workspaceFolders;
      if (folders) {
        return folders.map(f => f.uri.fsPath);
      }
    } catch { }
    return [];
  }

  async provideChatSessionContent(
    resource: Uri,
    _token: CancellationToken,
    _context: { readonly inputState: import('vscode').ChatSessionInputState }
  ): Promise<ChatSession> {
    const sessionId = resource.authority;

    if (!hasOpenCodeDB()) {
      return {
        title: 'OpenCode Session',
        history: [],
        requestHandler: undefined,
        options: {},
      };
    }

    const messages = getSessionMessages(sessionId);
    const history: (ChatRequestTurn | ChatResponseTurn2)[] = [];

    for (const msg of messages) {
      let msgData: OpenCodeMessageData;
      try {
        msgData = JSON.parse(msg.data) as OpenCodeMessageData;
      } catch {
        continue;
      }

      const parts = getMessageParts(msg.id);
      const textParts: string[] = [];

      for (const part of parts) {
        let partData: OpenCodePartData;
        try {
          partData = JSON.parse(part.data) as OpenCodePartData;
        } catch {
          continue;
        }

        if (partData.type === 'text' && partData.text) {
          textParts.push(partData.text);
        }
        if (partData.type === 'reasoning' && partData.text) {
          textParts.push(`_${partData.text}_`);
        }
      }

      if (msgData.role === 'user') {
        const turn = {
          prompt: textParts.join('\n\n') || '[empty prompt]',
          command: undefined,
          participant: 'opencode.chat',
          references: [],
          toolReferences: [],
        } as unknown as ChatRequestTurn;
        history.push(turn);
      } else if (msgData.role === 'assistant') {
        if (textParts.length === 0) continue;

        const turn: ChatResponseTurn2 = {
          response: [
            new ChatResponseMarkdownPart(textParts.join('\n\n')),
          ],
          chatId: msg.id,
          result: { metadata: { modelId: msgData.modelID } } as ChatResult,
          model: msgData.modelID ? { id: msgData.modelID, vendor: msgData.providerID || 'opencode' } : undefined,
          timing: {
            startTime: msg.time_created,
            endTime: msg.time_created + 1000,
          },
        };

        history.push(turn);
      }
    }

    const sessionRows = listSessionsGlobal();
    const sessionRow = sessionRows.find(s => s.id === sessionId);

    const session: ChatSession = {
      title: sessionRow?.title || 'OpenCode CLI Session',
      history,
      requestHandler: undefined,
      options: {
        readonly: 'true',
      },
    };

    return session;
  }
}

function tryParseJSON(str: string): unknown {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}
