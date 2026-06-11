import * as vscode from 'vscode';

/**
 * OpenCode Subagent Tool
 *
 * Allows Copilot Chat to spawn a subagent that delegates to an OpenCode provider.
 * The subagent runs with a restricted tool set and temperature 0.
 *
 * Based on VS Code Copilot's ExecutionSubagentTool pattern.
 */

export interface SubagentParams {
  /** What to execute — can include commands or task descriptions */
  query: string;
  /** User-visible description shown while the tool runs */
  description: string;
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
    const { query, description } = options.input;

    // Find the first available provider
    const vendors = Array.from(OpenCodeSubagentTool.providerLookup.keys());
    if (vendors.length === 0) {
      const part = new vscode.LanguageModelTextPart(
        'No OpenCode providers available. Configure an API key or connect to a server first.'
      );
      return new vscode.LanguageModelToolResult([part]);
    }

    const vendor = vendors[0];
    const provider = OpenCodeSubagentTool.providerLookup.get(vendor)!;

    try {
      // Build a single user message with the query
      const messages = [
        vscode.LanguageModelChatMessage.User(query),
      ];

      // Use the first available model from the provider
      const models = await provider.provideLanguageModelChatInformation(
        { silent: true },
        token
      );

      if (!models || models.length === 0) {
        const part = new vscode.LanguageModelTextPart(
          `Provider "${vendor}" has no available models.`
        );
        return new vscode.LanguageModelToolResult([part]);
      }

      const model = models[0];

      // Send request to the provider
      const responseParts: string[] = [];

      await provider.provideLanguageModelChatResponse(
        model,
        messages,
        { tools: [], toolMode: vscode.LanguageModelChatToolMode.Auto },  // Subagent runs without additional tools
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
        query,
        description,
        vendor,
        modelId: model.id,
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
}
