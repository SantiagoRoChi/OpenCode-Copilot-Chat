import { ToolDefinition, ToolCall } from '../client/types';

export function convertTools(
  tools: ReadonlyArray<{ name: string; description?: string; inputSchema?: unknown }>
): ToolDefinition[] {
  return tools.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
}

export function resolveToolCallArgs(
  toolCall: ToolCall,
  schemas: Map<string, Record<string, unknown> | undefined>
): Record<string, unknown> {
  let args = tryRepairJson(toolCall.function.arguments);

  const schema = schemas.get(toolCall.function.name);
  if (schema) {
    args = fillMissingRequiredProperties(args, schema);
  }

  return args;
}

function tryRepairJson(raw: string): Record<string, unknown> {
  if (!raw || raw.trim() === '') return {};

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed;
    }
    return {};
  } catch {
    // Try common repairs
  }

  // Remove trailing commas
  let repaired = raw.replace(/,\s*([}\]])/g, '$1');
  try {
    const parsed = JSON.parse(repaired);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed;
    }
  } catch {
    // Continue
  }

  // Try wrapping in braces
  if (!repaired.trimStart().startsWith('{')) {
    repaired = '{' + repaired;
  }
  if (!repaired.trimEnd().endsWith('}')) {
    repaired = repaired + '}';
  }
  try {
    const parsed = JSON.parse(repaired);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed;
    }
  } catch {
    // Give up
  }

  return {};
}

function fillMissingRequiredProperties(
  args: Record<string, unknown>,
  schema: Record<string, unknown>
): Record<string, unknown> {
  if (!schema.properties || !schema.required || !Array.isArray(schema.required)) {
    return args;
  }

  const result = { ...args };
  const properties = schema.properties as Record<string, Record<string, unknown>>;

  for (const required of schema.required) {
    if (result[required] === undefined || result[required] === null) {
      const propSchema = properties[required];
      if (propSchema) {
        result[required] = getDefaultValue(propSchema);
      }
    }
  }

  return result;
}

function getDefaultValue(propSchema: Record<string, unknown>): unknown {
  switch (propSchema.type) {
    case 'string':
      return '';
    case 'number':
    case 'integer':
      return 0;
    case 'boolean':
      return false;
    case 'array':
      return [];
    case 'object':
      return {};
    default:
      return '';
  }
}
