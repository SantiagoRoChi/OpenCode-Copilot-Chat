import { chat, Uri, ExtensionContext, ChatParticipant, ChatRequest, ChatContext, ChatResponseStream, CancellationToken, ChatResult, LanguageModelChatProvider, LanguageModelChatInformation, LanguageModelChatMessage, LanguageModelTextPart, LanguageModelToolCallPart, LanguageModelChatToolMode, ChatRequestTurn, ChatResponseTurn, ChatResponseMarkdownPart, ChatFollowup, LanguageModelChatTool } from 'vscode';
import { ContextManager } from '../context/contextManager';

export interface ProviderEntry {
  vendor: string;
  displayName: string;
  provider: LanguageModelChatProvider;
}

let _contextManager: ContextManager | undefined;

export function setContextManager(manager: ContextManager): void {
  _contextManager = manager;
}

export function registerOpenCodeChatParticipant(
  context: ExtensionContext,
  providers: ProviderEntry[]
): ChatParticipant {
  const participant = chat.createChatParticipant(
    'opencode.chat',
    async (request, chatContext, stream, token) => {
      return handleOpenCodeRequest(request, chatContext, stream, token, providers);
    }
  );

  participant.iconPath = {
    light: Uri.joinPath(context.extensionUri, 'assets', 'icon.png'),
    dark: Uri.joinPath(context.extensionUri, 'assets', 'icon.png'),
  };

  participant.followupProvider = {
    provideFollowups(result, token) {
      return provideFollowups(result);
    },
  };

  return participant;
}

async function handleOpenCodeRequest(
  request: ChatRequest,
  _chatContext: ChatContext,
  stream: ChatResponseStream,
  token: CancellationToken,
  providers: ProviderEntry[]
): Promise<ChatResult> {
  const availableProviders = providers.filter(p => p.provider);
  if (availableProviders.length === 0) {
    stream.markdown(
      '⚠️ No OpenCode providers available. Configure an API key or connect to a server first.\n\n' +
      'You can configure keys via:\n' +
      '- **OpenCode Zen: Configure Zen Key** command\n' +
      '- **OpenCode Zen: Configure Go Key** command\n' +
      '- Or connect to a local LM Studio / Ollama server'
    );
    return { metadata: { command: 'no-providers' } };
  }

  let selectedProvider: ProviderEntry;
  let selectedModel: LanguageModelChatInformation | undefined;

  if (request.model) {
    for (const entry of availableProviders) {
      const models = await entry.provider.provideLanguageModelChatInformation(
        { silent: true }, token
      );
      if (models?.some(m => m.id === request.model.id)) {
        selectedProvider = entry;
        selectedModel = models.find(m => m.id === request.model.id);
        break;
      }
    }
  }

  if (!selectedProvider!) {
    selectedProvider = availableProviders[0];
  }

  if (!selectedModel) {
    const models = await selectedProvider.provider.provideLanguageModelChatInformation(
      { silent: true }, token
    );
    if (!models || models.length === 0) {
      stream.markdown(`⚠️ Provider "${selectedProvider.displayName}" has no available models.`);
      return { metadata: { command: 'no-models' } };
    }
    selectedModel = models[0];
  }

  const messages: LanguageModelChatMessage[] = [];

  const ctxText = await _contextManager?.formatContext(token) ?? '';
  if (ctxText) {
    messages.push(LanguageModelChatMessage.User(
      `[Current Workspace Context]\n${ctxText}`
    ));
  }

  for (const turn of _chatContext.history) {
    if (turn instanceof ChatRequestTurn) {
      messages.push(LanguageModelChatMessage.User(turn.prompt));
    } else if (turn instanceof ChatResponseTurn) {
      const parts: string[] = [];
      for (const part of turn.response) {
        if (part instanceof ChatResponseMarkdownPart) {
          parts.push(part.value.value);
        }
      }
      if (parts.length > 0) {
        messages.push(LanguageModelChatMessage.Assistant(parts.join('\n\n')));
      }
    }
  }

  messages.push(LanguageModelChatMessage.User(request.prompt));

  try {
    stream.progress('Thinking...');

    await selectedProvider.provider.provideLanguageModelChatResponse(
      selectedModel,
      messages,
      { tools: request.toolReferences.map(t => t as unknown as LanguageModelChatTool), toolMode: LanguageModelChatToolMode.Auto },
      {
        report: (part) => {
          if (part instanceof LanguageModelTextPart) {
            stream.markdown(part.value);
          } else if (part instanceof LanguageModelToolCallPart) {
            stream.markdown(`> 🔧 Tool called: **${part.name}**`);
          }
        },
      },
      token
    );

    return {
      metadata: {
        command: 'success',
        vendor: selectedProvider.vendor,
        modelId: selectedModel.id,
      },
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    stream.markdown(`\n\n❌ **Error:** ${errorMessage}`);
    console.error(`[OpenCode Chat] Error: ${errorMessage}`, err);
    return {
      metadata: {
        command: 'error',
        error: errorMessage,
      },
    };
  }
}

function provideFollowups(
  result: ChatResult
): ChatFollowup[] {
  if (result.metadata?.command === 'no-providers') {
    return [
      {
        prompt: 'Configure my OpenCode API key',
        label: 'Configure API Key',
      },
    ];
  }

  if (result.metadata?.command === 'error') {
    return [
      {
        prompt: 'Try again',
        label: 'Retry',
      },
    ];
  }

  return [
    {
      prompt: 'Explain this in more detail',
      label: 'More details',
    },
    {
      prompt: 'Write tests for this',
      label: 'Write tests',
    },
  ];
}
