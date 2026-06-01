export const TOKEN_CONSTANTS = {
  CHARS_PER_TOKEN: 4,
  DEFAULT_CONTEXT_TOKENS: 131072,
  DEFAULT_OUTPUT_TOKENS: 32000,
  FALLBACK_OUTPUT_TOKENS: 4096,
  MIN_OUTPUT_TOKENS: 256,
  ADJUST_TOKEN_BUFFER: 1024,
  IMAGE_OVERHEAD_TOKENS: 800,
};

export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / TOKEN_CONSTANTS.CHARS_PER_TOKEN);
}

export function calculateMaxInputTokens(options: {
  modelMaxContext: number;
  configuredMaxOutput: number;
  toolsSerializedLength: number;
}): number {
  const { modelMaxContext, configuredMaxOutput, toolsSerializedLength } = options;
  const toolsOverhead = Math.ceil(toolsSerializedLength / TOKEN_CONSTANTS.CHARS_PER_TOKEN);
  return modelMaxContext - configuredMaxOutput - toolsOverhead;
}

export function calculateSafeMaxOutputTokens(options: {
  estimatedInputTokens: number;
  toolsOverhead: number;
  modelMaxContext: number;
  configuredMaxOutput: number;
}): number {
  const { estimatedInputTokens, toolsOverhead, modelMaxContext, configuredMaxOutput } = options;
  const available = modelMaxContext - estimatedInputTokens - toolsOverhead;
  return Math.max(TOKEN_CONSTANTS.MIN_OUTPUT_TOKENS, Math.min(available, configuredMaxOutput));
}

export function truncateMessagesToFit(
  messages: Array<Record<string, unknown>>,
  maxInputTokens: number,
  log: (msg: string) => void
): Array<Record<string, unknown>> {
  let totalTokens = 0;
  const result: Array<Record<string, unknown>> = [];

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const msgJson = JSON.stringify(msg);
    const msgTokens = estimateTextTokens(msgJson);

    if (totalTokens + msgTokens > maxInputTokens) {
      log(`Truncating message ${i} (${msgTokens} tokens) to fit context limit`);
      continue;
    }

    totalTokens += msgTokens;
    result.unshift(msg);
  }

  return result;
}

export function buildInputText(messages: Array<Record<string, unknown>>): string {
  return messages
    .map(m => {
      if (typeof m.content === 'string') return m.content;
      if (Array.isArray(m.content)) {
        return m.content
          .filter((p: Record<string, unknown>) => p.type === 'text')
          .map((p: Record<string, unknown>) => p.text)
          .join('\n');
      }
      return '';
    })
    .join('\n');
}
