// Mock de VS Code para tests en Node.js (sin dependencia del runtime de VS Code)

export const EventEmitter = class<T = void> {
  private listeners: Array<(e: T) => void> = [];
  event = (listener: (e: T) => void) => {
    this.listeners.push(listener);
    return { dispose: () => {} };
  };
  fire(e: T) {
    for (const l of this.listeners) l(e);
  }
  dispose() {}
};

export const LanguageModelTextPart = class {
  value: string;
  constructor(value: string) {
    this.value = value;
  }
};

export const LanguageModelToolCallPart = class {
  callId: string;
  name: string;
  input: Record<string, unknown>;
  constructor(callId: string, name: string, input: Record<string, unknown>) {
    this.callId = callId;
    this.name = name;
    this.input = input;
  }
};

export const LanguageModelToolResultPart = class {
  callId: string;
  content: unknown;
  constructor(callId: string, content: unknown) {
    this.callId = callId;
    this.content = content;
  }
};

export const LanguageModelDataPart = class {
  data: Uint8Array;
  mimeType: string;
  constructor(data: Uint8Array, mimeType: string) {
    this.data = data;
    this.mimeType = mimeType;
  }
};

export const LanguageModelChatMessageRole = {
  User: 1,
  Assistant: 2,
};

export const LanguageModelChatToolMode = {
  Auto: 1,
  Required: 2,
};

export const window = {
  createOutputChannel: (name: string) => ({
    name,
    appendLine: (msg: string) => console.log(`[${name}] ${msg}`),
    append: (msg: string) => console.log(`[${name}] ${msg}`),
    show: () => {},
    clear: () => {},
    hide: () => {},
    dispose: () => {},
  }),
  showInformationMessage: async (...args: any[]) => undefined,
  showWarningMessage: async (...args: any[]) => undefined,
  showErrorMessage: async (...args: any[]) => undefined,
};

export const lm = {
  registerLanguageModelChatProvider: (id: string, provider: any) => ({ dispose: () => {} }),
  registerTool: (id: string, tool: any) => ({ dispose: () => {} }),
};

export const commands = {
  registerCommand: (id: string, handler: any) => ({ dispose: () => {} }),
};

export const workspace = {
  getConfiguration: (section?: string) => ({
    get: (key: string, defaultValue?: any) => defaultValue,
    update: async (key: string, value: any) => {},
  }),
};

export const extensions = {
  getExtension: (id: string) => undefined,
};

export const Uri = {
  file: (path: string) => ({ path, fsPath: path, toString: () => path }),
};

export const ProgressLocation = {
  Notification: 15,
};

export const CancellationTokenSource = class {
  token = {
    isCancellationRequested: false,
    onCancellationRequested: (cb: () => void) => ({ dispose: () => {} }),
  };
  cancel() {
    this.token.isCancellationRequested = true;
  }
  dispose() {}
};

// Default export para compatibilidad
export default {
  EventEmitter,
  LanguageModelTextPart,
  LanguageModelToolCallPart,
  LanguageModelToolResultPart,
  LanguageModelDataPart,
  LanguageModelChatMessageRole,
  LanguageModelChatToolMode,
  window,
  lm,
  commands,
  workspace,
  extensions,
  Uri,
  ProgressLocation,
  CancellationTokenSource,
};
