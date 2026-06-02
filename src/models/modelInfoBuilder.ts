import * as vscode from 'vscode';
import { ZenModelDefinition } from '../client/types';

function formatContextLabel(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    return `${Math.round(tokens / 1000)}K`;
  }
  return `${tokens}`;
}

function formatPrice(price: number): string {
  if (price === 0) return 'Free';
  if (price < 0.01) return '<$0.01';
  return `$${price.toFixed(2)}`;
}

function buildTooltip(def: ZenModelDefinition): string {
  const parts: string[] = [];
  parts.push(`**${def.displayName}**`);
  parts.push('');
  
  // Context info
  parts.push(`**Context:** ${formatContextLabel(def.context.input)} input · ${formatContextLabel(def.context.output)} output`);
  parts.push('');
  
  // Capabilities
  const caps: string[] = [];
  if (def.capabilities.reasoning) caps.push('🧠 Reasoning');
  if (def.capabilities.toolCalling) caps.push('🛠️ Tools');
  if (def.capabilities.imageInput) caps.push('👁️ Vision');
  if (def.capabilities.streaming) caps.push('📡 Streaming');
  if (def.capabilities.structuredOutput) caps.push('📋 Structured');
  if (caps.length > 0) {
    parts.push(`**Capabilities:** ${caps.join(' · ')}`);
    parts.push('');
  }
  
  // Pricing
  if (def.pricing.input === 0 && def.pricing.output === 0) {
    parts.push('**Price:** 🆓 Free');
  } else {
    parts.push('**Cost per 1M Tokens:**');
    parts.push(`  In: ${formatPrice(def.pricing.input)}`);
    parts.push(`  Out: ${formatPrice(def.pricing.output)}`);
    if (def.pricing.cachedRead !== undefined) {
      parts.push(`  Cache: ${formatPrice(def.pricing.cachedRead)}`);
    }
  }
  
  // Provider info
  parts.push('');
  parts.push(`**Provider:** ${def.provider === 'opencode-go' ? 'OpenCode Go' : 'OpenCode Zen'}`);
  
  if (def.tags.includes('free')) {
    parts.push('');
    parts.push('⚠️ Limited time free availability');
  }

  return parts.join('\n');
}

function buildDescription(def: ZenModelDefinition): string {
  const ctx = formatContextLabel(def.context.input);
  const caps: string[] = [];
  if (def.capabilities.toolCalling) caps.push('Tools');
  if (def.capabilities.imageInput) caps.push('Vision');
  const capsStr = caps.length > 0 ? caps.join(', ') : '';
  const price = def.pricing.input === 0 ? 'Free' : `${formatPrice(def.pricing.input)}/1M`;
  return `${ctx} · ${capsStr} · ${price}`;
}

function inferFamily(id: string): string {
  const lower = id.toLowerCase();
  if (lower.includes('gpt')) return 'openai';
  if (lower.includes('claude')) return 'anthropic';
  if (lower.includes('gemini')) return 'google';
  if (lower.includes('qwen')) return 'qwen';
  if (lower.includes('deepseek')) return 'deepseek';
  if (lower.includes('kimi')) return 'kimi';
  if (lower.includes('glm')) return 'glm';
  if (lower.includes('minimax')) return 'minimax';
  if (lower.includes('grok')) return 'grok';
  if (lower.includes('nemotron')) return 'nvidia';
  if (lower.includes('mimo')) return 'mimo';
  return id.split('-')[0];
}

export function buildModelInfo(def: ZenModelDefinition): vscode.LanguageModelChatInformation {
  return {
    id: def.id,
    name: def.displayName,
    family: def.family || inferFamily(def.id),
    version: def.id,
    maxInputTokens: def.context.input,
    maxOutputTokens: def.context.output,
    tooltip: buildTooltip(def),
    detail: buildDescription(def),
    capabilities: {
      imageInput: def.capabilities.imageInput,
      toolCalling: def.capabilities.toolCalling,
    },
  };
}
