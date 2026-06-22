import * as vscode from 'vscode';

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
  provider: vscode.LanguageModelChatProvider;
}

export class OpenCodeSubagentTool implements vscode.LanguageModelTool<SubagentParams> {
  public static readonly toolName = 'opencode_subagent';
  private static providerLookup: Map<string, vscode.LanguageModelChatProvider> = new Map();

  /** Register a provider so the subagent can find it */
  static registerProvider(vendor: string, provider: vscode.LanguageModelChatProvider): void {
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
    options: vscode.LanguageModelToolInvocationPrepareOptions<SubagentParams>,
    _token: vscode.CancellationToken
  ): Promise<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: options.input.description || 'Running subagent...',
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<SubagentParams>,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { prompt, description, model: modelParam } = options.input;

    // Find all available providers
    const providers = OpenCodeSubagentTool.getProviders();
    if (providers.length === 0) {
      const part = new vscode.LanguageModelTextPart(
        'No OpenCode providers available. Configure an API key or connect to a server first.'
      );
      return new vscode.LanguageModelToolResult([part]);
    }

    try {
      // Resolve which model to use
      let targetProvider: vscode.LanguageModelChatProvider;
      let targetModel: vscode.LanguageModelChatInformation | undefined;

      if (modelParam) {
        // Model specified — search all providers for a matching model
        const resolved = await this.resolveModel(modelParam, providers, token);
        if (!resolved) {
          const available = await this.getAvailableModelsList(providers, token);
          const part = new vscode.LanguageModelTextPart(
            `Model "${modelParam}" not found. Available models:\n${available}`
          );
          return new vscode.LanguageModelToolResult([part]);
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
          const part = new vscode.LanguageModelTextPart(
            `Provider "${providers[0].vendor}" has no available models.`
          );
          return new vscode.LanguageModelToolResult([part]);
        }
        targetModel = models[0];
      }

      // Build the chat request
      const messages = [
        vscode.LanguageModelChatMessage.User(prompt),
      ];

      // Send request to the provider
      const responseParts: string[] = [];

      await targetProvider.provideLanguageModelChatResponse(
        targetModel,
        messages,
        { tools: [], toolMode: vscode.LanguageModelChatToolMode.Auto },
        {
          report: (part) => {
            if (part instanceof vscode.LanguageModelTextPart) {
              responseParts.push(part.value);
            }
          },
        },
        token
      );

      const responseText = responseParts.join('') || 'No response from subagent.';

      // Return the result with metadata
      const result = new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(responseText),
      ]);

      // Add tool metadata for tracking
      (result as any).toolMetadata = {
        prompt: prompt.substring(0, 100),
        description,
        vendor: this.getVendorForModel(targetModel, providers),
        modelId: targetModel.id,
      };
      (result as any).toolResultMessage = new vscode.MarkdownString(
        `**${description}** completed`
      );

      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const part = new vscode.LanguageModelTextPart(
        `Subagent error: ${errorMessage}`
      );
      return new vscode.LanguageModelToolResult([part]);
    }
  }

  /**
   * Resolve a model by qualified name like "Claude Sonnet (opencode-zen)"
   * Searches across all registered providers.
   */
  private async resolveModel(
    modelParam: string,
    providers: ProviderEntry[],
    token: vscode.CancellationToken
  ): Promise<{ provider: vscode.LanguageModelChatProvider; model: vscode.LanguageModelChatInformation } | undefined> {
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
    token: vscode.CancellationToken
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
    model: vscode.LanguageModelChatInformation,
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
