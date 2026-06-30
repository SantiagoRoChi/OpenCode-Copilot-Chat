declare module 'vscode' {
  export enum ChatSessionStatus {
    Failed = 0,
    Completed = 1,
    InProgress = 2,
    NeedsInput = 3,
  }

  export namespace chat {
    export function createChatSessionItemController(
      chatSessionType: string,
      refreshHandler: ChatSessionItemControllerRefreshHandler
    ): ChatSessionItemController;

    export function registerChatSessionContentProvider(
      scheme: string,
      provider: ChatSessionContentProvider,
      defaultChatParticipant: ChatParticipant,
      capabilities?: ChatSessionCapabilities
    ): Disposable;
  }

  export type ChatSessionItemControllerRefreshHandler = (token: CancellationToken) => Thenable<void>;

  export interface ChatSessionItemControllerNewItemHandlerContext {
    readonly request: {
      readonly prompt: string;
      readonly command?: string;
    };
    readonly inputState: ChatSessionInputState;
  }

  export type ChatSessionItemControllerNewItemHandler = (
    context: ChatSessionItemControllerNewItemHandlerContext,
    token: CancellationToken
  ) => Thenable<ChatSessionItem>;

  export type ChatSessionControllerGetInputState = (
    sessionResource: Uri | undefined,
    context: { readonly previousInputState: ChatSessionInputState | undefined },
    token: CancellationToken
  ) => Thenable<ChatSessionInputState> | ChatSessionInputState;

  export type ChatSessionItemControllerForkHandler = (
    sessionResource: Uri,
    request: ChatRequestTurn2 | undefined,
    token: CancellationToken
  ) => Thenable<ChatSessionItem> | ChatSessionItem;

  export interface ChatSessionItemController {
    readonly id: string;
    dispose(): void;
    readonly items: ChatSessionItemCollection;
    createChatSessionItem(resource: Uri, label: string): ChatSessionItem;
    readonly refreshHandler: ChatSessionItemControllerRefreshHandler;
    readonly onDidChangeChatSessionItemState: Event<ChatSessionItem>;
    newChatSessionItemHandler?: ChatSessionItemControllerNewItemHandler;
    forkHandler?: ChatSessionItemControllerForkHandler;
    getChatSessionInputState?: ChatSessionControllerGetInputState;
    resolveChatSessionItem?: (item: ChatSessionItem, token: CancellationToken) => Thenable<void>;
    createChatSessionInputState(groups: ChatSessionProviderOptionGroup[]): ChatSessionInputState;
  }

  export interface ChatSessionItemCollection extends Iterable<readonly [id: Uri, chatSessionItem: ChatSessionItem]> {
    readonly size: number;
    replace(items: readonly ChatSessionItem[]): void;
    forEach(callback: (item: ChatSessionItem, collection: ChatSessionItemCollection) => unknown, thisArg?: any): void;
    add(item: ChatSessionItem): void;
    delete(resource: Uri): void;
    get(resource: Uri): ChatSessionItem | undefined;
  }

  export interface ChatSessionItem {
    readonly resource: Uri;
    label: string;
    iconPath?: IconPath;
    description?: string | MarkdownString;
    badge?: string | MarkdownString;
    status?: ChatSessionStatus;
    tooltip?: string | MarkdownString;
    archived?: boolean;
    timing?: {
      readonly created: number;
      readonly lastRequestStarted?: number;
      readonly lastRequestEnded?: number;
    };
    changes?: readonly ChatSessionChangedFile2[];
    metadata?: { readonly [key: string]: any };
  }

  export class ChatSessionChangedFile2 {
    readonly uri: Uri;
    readonly originalUri: Uri | undefined;
    readonly modifiedUri: Uri | undefined;
    insertions: number;
    deletions: number;
    constructor(uri: Uri, originalUri: Uri | undefined, modifiedUri: Uri | undefined, insertions: number, deletions: number);
  }

  export interface ChatSession {
    readonly title?: string;
    readonly history: ReadonlyArray<ChatRequestTurn | ChatResponseTurn2>;
    readonly options?: Record<string, string | ChatSessionProviderOptionItem>;
    readonly activeResponseCallback?: (stream: ChatResponseStream, token: CancellationToken) => Thenable<void>;
    readonly requestHandler: ChatRequestHandler | undefined;
  }

  export interface ChatSessionContentProvider {
    readonly onDidChangeChatSessionOptions?: Event<ChatSessionOptionChangeEvent>;
    readonly onDidChangeChatSessionProviderOptions?: Event<void>;
    provideChatSessionContent(
      resource: Uri,
      token: CancellationToken,
      context: { readonly inputState: ChatSessionInputState }
    ): Thenable<ChatSession> | ChatSession;
    provideHandleOptionsChange?(
      resource: Uri,
      updates: ReadonlyArray<ChatSessionOptionUpdate>,
      token: CancellationToken
    ): void;
    provideChatSessionProviderOptions?(token: CancellationToken): Thenable<ChatSessionProviderOptions>;
  }

  export interface ChatSessionOptionUpdate {
    readonly optionId: string;
    readonly value: string | undefined;
  }

  export interface ChatSessionOptionChangeEvent {
    readonly resource: Uri;
    readonly updates: ReadonlyArray<{
      readonly optionId: string;
      readonly value: string | ChatSessionProviderOptionItem;
    }>;
  }

  export interface ChatSessionCapabilities {
    supportsInterruptions?: boolean;
  }

  export interface ChatSessionProviderOptionItem {
    readonly id: string;
    readonly name: string;
    readonly description?: string;
    readonly locked?: boolean;
    readonly icon?: ThemeIcon;
    readonly default?: boolean;
  }

  export interface ChatSessionProviderOptionGroup {
    readonly id: string;
    readonly name: string;
    readonly description?: string;
    readonly selected?: ChatSessionProviderOptionItem;
    readonly items: readonly ChatSessionProviderOptionItem[];
    readonly when?: string;
    readonly icon?: ThemeIcon;
    readonly commands?: Command[];
  }

  export interface ChatSessionProviderOptions {
    readonly optionGroups?: readonly ChatSessionProviderOptionGroup[];
    readonly newSessionOptions?: Record<string, string | ChatSessionProviderOptionItem>;
  }

  export interface ChatSessionInputState {
    readonly onDidDispose: Event<void>;
    readonly onDidChange: Event<void>;
    readonly sessionResource: Uri | undefined;
    groups: readonly ChatSessionProviderOptionGroup[];
  }

  export interface ChatResponseTurn2 {
    readonly response: ReadonlyArray<ChatResponsePart>;
    readonly chatId: string;
    readonly result: ChatResult;
    readonly model?: { readonly id: string; readonly vendor: string };
    readonly timing?: { readonly startTime?: number; readonly endTime?: number };
  }

  export interface ChatRequestTurn2 {
    readonly prompt: string;
    readonly command?: string;
    readonly chatId: string;
    readonly response?: ReadonlyArray<ChatResponseTurn2>;
    readonly model?: { readonly id: string; readonly vendor: string };
  }

  export interface ChatSessionContext {
    readonly chatSessionItem: ChatSessionItem;
    readonly isUntitled: boolean;
    readonly inputState: ChatSessionInputState;
  }
}
