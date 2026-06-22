import * as vscode from 'vscode';

/**
 * OpenCode Chat Participant
 *
 * Registers @opencode as a chat participant in VS Code.
 * Routes requests to the best available OpenCode/LMStudio/Ollama provider.
 *
 * Benefits over just being a LanguageModelProvider:
 *  - @opencode command in chat
 *  - Full control over request/response flow
 *  - Custom follow-up suggestions
 *  - Tools scoped to this participant
 *  - Custom icon and branding
 */

export interface ProviderEntry {
  vendor: string;
  displayName: string;
  provider: vscode.LanguageModelChatProvider;
}

/**
 * Creates and registers the @opencode chat participant.
 */
export function registerOpenCodeChatParticipant(
  context: vscode.ExtensionContext,
  providers: ProviderEntry[]
): vscode.ChatParticipant {
  const participant = vscode.chat.createChatParticipant(
    'opencode.chat',
    async (request, chatContext, stream, token) => {
      return handleOpenCodeRequest(request, chatContext, stream, token, providers);
    }
  );

  // Set the icon for @opencode in the chat
  participant.iconPath = {
    light: vscode.Uri.joinPath(context.extensionUri, 'assets', 'icon.png'),
    dark: vscode.Uri.joinPath(context.extensionUri, 'assets', 'icon.png'),
  };

  // Provide follow-up suggestions after each response
  participant.followupProvider = {
    provideFollowups(result, token) {
      return provideFollowups(result);
    },
  };

  return participant;
}

/**
 * Main request handler — routes the chat request to the best available provider.
 */
async function handleOpenCodeRequest(
  request: vscode.ChatRequest,
  _chatContext: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  providers: ProviderEntry[]
): Promise<vscode.ChatResult> {
  // Find the best available provider
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

  // Determine which provider/model to use
  let selectedProvider: ProviderEntry;
  let selectedModel: vscode.LanguageModelChatInformation | undefined;

  // Check if user specified a model via the chat model picker
  if (request.model) {
    // Find which of our providers owns this model
    for (const entry of availableProviders) {
      const models = await entry.provider.provideLanguageModelChatInformation(
        { silent: true }, token
      );
      if (models?.some(m => m.id === (request.model as any).id)) {
        selectedProvider = entry;
        selectedModel = models.find(m => m.id === (request.model as any).id);
        break;
      }
    }
  }

  // Fallback to first available provider
  if (!selectedProvider!) {
    selectedProvider = availableProviders[0];
  }

  // Get models from the selected provider
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

  // Build the message history
  const messages: vscode.LanguageModelChatMessage[] = [];

  // Add conversation history from chat context
  for (const historyEntry of chatContext.history) {
    if (historyEntry instanceof vscode.ChatRequestMarkdownPart) {
      // This is a previous user message or assistant response
      // The history is already formatted, we pass it as context
    }
  }

  // Add the current user prompt
  messages.push(vscode.LanguageModelChatMessage.User(request.prompt));

  // Stream the response
  try {
    // Report thinking indicator
    stream.progress('Thinking...');

    await selectedProvider.provider.provideLanguageModelChatResponse(
      selectedModel,
      messages,
      { tools: request.toolReferences.map(t => t as any) },
      {
        report: (part) => {
          if (part instanceof vscode.LanguageModelTextPart) {
            stream.markdown(part.value);
          } else if (part instanceof vscode.LanguageModelToolCallPart) {
            // Tool calls are handled by VS Code automatically
            stream.toolCall(part);
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

    // Show error to user
    stream.markdown(`\n\n❌ **Error:** ${errorMessage}`);

    // Log for debugging
    console.error(`[OpenCode Chat] Error: ${errorMessage}`, err);

    return {
      metadata: {
        command: 'error',
        error: errorMessage,
      },
    };
  }
}

/**
 * Provides follow-up suggestions after each response.
 */
function provideFollowups(
  result: vscode.ChatResult
): vscode.ChatFollowup[] {
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

  // Default follow-ups for successful responses
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
