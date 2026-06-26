import { Event, CancellationToken, LanguageModelChatInformation, LanguageModelChatMessage, LanguageModelChatProvider, LanguageModelChatRequestMessage, LanguageModelResponsePart, LanguageModelTextPart, Progress, ProvideLanguageModelChatResponseOptions } from 'vscode';

const DEFAULT_SYSTEM_PROMPTS: string[] = [
  [
    'You are integrated into VS Code via the @opencode chat participant.',
    'You have access to tools via tool calling when supported.',
    'The workspace context (diagnostics, git status, file listings) may be',
    'provided as a [Current Workspace Context] message — use it to',
    'understand the project state before answering.',
    '',
    'When suggesting code changes, include the file path in markdown code blocks.',
    'When explaining errors, reference the relevant file and line numbers.',
  ].join('\n'),
];

export class SystemPromptProvider implements LanguageModelChatProvider {
  readonly onDidChangeLanguageModelChatInformation: Event<void>;

  private readonly _wrapped: LanguageModelChatProvider;

  constructor(wrapped: LanguageModelChatProvider) {
    this._wrapped = wrapped;
    this.onDidChangeLanguageModelChatInformation = wrapped.onDidChangeLanguageModelChatInformation
      ?? (() => ({ dispose: () => {} }));
  }

  async provideLanguageModelChatInformation(
    options: { silent: boolean; configuration?: Record<string, unknown> },
    token: CancellationToken
  ): Promise<LanguageModelChatInformation[]> {
    const result = await this._wrapped.provideLanguageModelChatInformation(options, token);
    return result ?? [];
  }

  async provideLanguageModelChatResponse(
    model: LanguageModelChatInformation,
    messages: readonly LanguageModelChatRequestMessage[],
    options: ProvideLanguageModelChatResponseOptions,
    progress: Progress<LanguageModelResponsePart>,
    token: CancellationToken
  ): Promise<void> {
    const systemMsgs: LanguageModelChatMessage[] = DEFAULT_SYSTEM_PROMPTS.map(p =>
      LanguageModelChatMessage.User(p)
    );

    const combined = [...systemMsgs, ...messages];

    await this._wrapped.provideLanguageModelChatResponse(
      model,
      combined,
      options,
      progress,
      token
    );
  }

  async provideTokenCount(
    model: LanguageModelChatInformation,
    text: string | LanguageModelChatMessage,
    token: CancellationToken
  ): Promise<number> {
    if ('provideTokenCount' in this._wrapped) {
      return (this._wrapped as any).provideTokenCount(model, text, token);
    }
    if (typeof text === 'string') {
      return Math.ceil(text.length / 4);
    }
    let chars = 0;
    for (const part of text.content) {
      if (part instanceof LanguageModelTextPart) {
        chars += part.value.length;
      }
    }
    return Math.ceil(chars / 4);
  }

  dispose(): void {
    if ('dispose' in this._wrapped && typeof (this._wrapped as any).dispose === 'function') {
      (this._wrapped as any).dispose();
    }
  }
}
