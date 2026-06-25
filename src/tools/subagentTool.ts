import { LanguageModelTool, LanguageModelToolInvocationPrepareOptions, CancellationToken, PreparedToolInvocation, LanguageModelToolInvocationOptions, LanguageModelToolResult, LanguageModelChatProvider, LanguageModelChatInformation, LanguageModelTextPart, LanguageModelChatMessage, LanguageModelChatToolMode, MarkdownString } from 'vscode';

/**
 * OpenCode Subagent Tool
 *
 * Allows VS Code Chat to spawn a subagent that delegates to any registered
 * OpenCode/LMStudio/Ollama provider. Supports model selection to pick the
 * best model for each subtask.
 *
 * Follows the same parameter schema as VS Code's built-in `runSubagent` tool
 * so the AI model can use it seamlessly.
 */

export interface SubagentParams {
  /** A detailed description of the task for the agent to perform */
  prompt: string;
  /** A short (3-5 word) description of the task */
  description: string;
  /** Optional model for the subagent. Format: "Model Name (Vendor)" */
  model?: string;
}

interface ProviderEntry {
  vendor: string;
  provider: LanguageModelChatProvider;
}

export class OpenCodeSubagentTool implements LanguageModelTool<SubagentParams> {
  public static readonly toolName = 'opencode_subagent';
  private static providerLookup: Map<string, LanguageModelChatProvider> = new Map();

  /** Register a provider so the subagent can find it */
  static registerProvider(vendor: string, provider: LanguageModelChatProvider): void {
    OpenCodeSubagentTool.providerLookup.set(vendor, provider);
  }

  static removeProvider(vendor: string): void {
    OpenCodeSubagentTool.providerLookup.delete(vendor);
  }

  /** Get all registered providers */
  static getProviders(): ProviderEntry[] {
    return Array.from(OpenCodeSubagentTool.providerLookup.entries()).map(
      ([vendor, provider]) => ({ vendor, provider })
    );
  }

  async prepareInvocation(
    options: LanguageModelToolInvocationPrepareOptions<SubagentParams>,
    _token: CancellationToken
  ): Promise<PreparedToolInvocation> {
    return {
      invocationMessage: options.input.description || 'Running subagent...',
    };
  }

  async invoke(
    options: LanguageModelToolInvocationOptions<SubagentParams>,
    token: CancellationToken
  ): Promise<LanguageModelToolResult> {
    const { prompt, description, model: modelParam } = options.input;

    // Find all available providers
    const providers = OpenCodeSubagentTool.getProviders();
    if (providers.length === 0) {
      const part = new LanguageModelTextPart(
        'No OpenCode providers available. Configure an API key or connect to a server first.'
      );
      return new LanguageModelToolResult([part]);
    }

    try {
      // Resolve which model to use
      let targetProvider: LanguageModelChatProvider;
      let targetModel: LanguageModelChatInformation | undefined;

      if (modelParam) {
        // Model specified — search all providers for a matching model
        const resolved = await this.resolveModel(modelParam, providers, token);
        if (!resolved) {
          const available = await this.getAvailableModelsList(providers, token);
          const part = new LanguageModelTextPart(
            `Model "${modelParam}" not found. Available models:\n${available}`
          );
          return new LanguageModelToolResult([part]);
        }
        targetProvider = resolved.provider;
        targetModel = resolved.model;
      } else {
        // No model specified — use the first available model from any provider
        targetProvider = providers[0].provider;
        const models = await targetProvider.provideLanguageModelChatInformation(
          { silent: true }, token
        );
        if (!models || models.length === 0) {
          const part = new LanguageModelTextPart(
            `Provider "${providers[0].vendor}" has no available models.`
          );
          return new LanguageModelToolResult([part]);
        }
        targetModel = models[0];
      }

      // Build the chat request
      const messages = [
        LanguageModelChatMessage.User(prompt),
      ];

      // Send request to the provider
      const responseParts: string[] = [];

      await targetProvider.provideLanguageModelChatResponse(
        targetModel,
        messages,
        { tools: [], toolMode: LanguageModelChatToolMode.Auto },
        {
          report: (part) => {
            if (part instanceof LanguageModelTextPart) {
              responseParts.push(part.value);
            }
          },
        },
        token
      );

      const responseText = responseParts.join('') || 'No response from subagent.';

      // Return the result with metadata
      const result = new LanguageModelToolResult([
        new LanguageModelTextPart(responseText),
      ]);

      // Add tool metadata for tracking
      const resultExt = result as unknown as {
        toolMetadata: { prompt: string; description: string; vendor: string; modelId: string };
        toolResultMessage: MarkdownString;
      };
      resultExt.toolMetadata = {
        prompt: prompt.substring(0, 100),
        description,
        vendor: this.getVendorForModel(targetModel, providers),
        modelId: targetModel.id,
      };
      resultExt.toolResultMessage = new MarkdownString(
        `**${description}** completed`
      );

      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const part = new LanguageModelTextPart(
        `Subagent error: ${errorMessage}`
      );
      return new LanguageModelToolResult([part]);
    }
  }

  /**
   * Resolve a model by qualified name like "Claude Sonnet (opencode-zen)"
   * Searches across all registered providers.
   */
  private async resolveModel(
    modelParam: string,
    providers: ProviderEntry[],
    token: CancellationToken
  ): Promise<{ provider: LanguageModelChatProvider; model: LanguageModelChatInformation } | undefined> {
    for (const entry of providers) {
      const models = await entry.provider.provideLanguageModelChatInformation(
        { silent: true }, token
      );
      if (!models) continue;

      for (const model of models) {
        // Match by ID
        if (model.id === modelParam || model.id.includes(modelParam)) {
          return { provider: entry.provider, model };
        }
        // Match by name (case-insensitive partial match)
        if (model.name.toLowerCase().includes(modelParam.toLowerCase())) {
          return { provider: entry.provider, model };
        }
        // Match qualified name format "Name (Vendor)"
        const qualifiedName = `${model.name} (${entry.vendor})`;
        if (qualifiedName.toLowerCase().includes(modelParam.toLowerCase())) {
          return { provider: entry.provider, model };
        }
      }
    }
    return undefined;
  }

  /** Get a formatted list of available models */
  private async getAvailableModelsList(
    providers: ProviderEntry[],
    token: CancellationToken
  ): Promise<string> {
    const lines: string[] = [];
    for (const entry of providers) {
      const models = await entry.provider.provideLanguageModelChatInformation(
        { silent: true }, token
      );
      if (models && models.length > 0) {
        for (const model of models) {
          lines.push(`- ${model.name} (${entry.vendor})`);
        }
      }
    }
    return lines.length > 0 ? lines.join('\n') : 'No models available.';
  }

  /** Find the vendor for a given model */
  private getVendorForModel(
    model: LanguageModelChatInformation,
    providers: ProviderEntry[]
  ): string {
    for (const entry of providers) {
      if (model.id.startsWith(`${entry.vendor}:`)) {
        return entry.vendor;
      }
    }
    return providers[0]?.vendor ?? 'unknown';
  }
}
