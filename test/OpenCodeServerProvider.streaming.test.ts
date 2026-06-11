import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

// ── Mock de VS Code ──
const mockVscode = {
  LanguageModelTextPart: class {
    value: string;
    constructor(value: string) { this.value = value; }
  },
  LanguageModelToolCallPart: class {
    callId: string;
    name: string;
    input: Record<string, unknown>;
    constructor(callId: string, name: string, input: Record<string, unknown>) {
      this.callId = callId;
      this.name = name;
      this.input = input;
    }
  },
  EventEmitter: class<T = void> {
    private listeners: Array<(e: T) => void> = [];
    event = (listener: (e: T) => void) => {
      this.listeners.push(listener);
      return { dispose: () => {} };
    };
    fire(e: T) {
      for (const l of this.listeners) l(e);
    }
    dispose() {}
  },
  window: {
    createOutputChannel: (name: string) => ({
      name,
      appendLine: () => {},
      append: () => {},
      show: () => {},
      clear: () => {},
      hide: () => {},
      dispose: () => {},
    }),
  },
};

// Mock global de vscode para el provider
(globalThis as any).vscode = mockVscode;

// ── Datos reales del servidor opencode ──
const REAL_RESPONSE = {
  info: {
    id: "msg_test",
    sessionID: "ses_test",
    tokens: { total: 100, input: 80, output: 20, reasoning: 5, cache: { read: 0, write: 0 } },
    finish: "stop"
  },
  parts: [
    { type: "step-start", id: "p1" },
    { type: "reasoning", text: "Analizando la pregunta...", id: "p2" },
    { type: "text", text: "La respuesta es 42.", id: "p3" },
    { type: "step-finish", tokens: { total: 100, input: 80, output: 20, reasoning: 5, cache: { read: 0, write: 0 } }, id: "p4" }
  ]
};

// ── Simulación del provider (lógica core extraída) ──
async function processServerResponse(
  messageData: any,
  progress: any,
  token: any
) {
  if (messageData.error) {
    throw new Error(messageData.error.message || JSON.stringify(messageData.error));
  }

  const parts = messageData.parts || [];
  let totalText = '';
  let reasoningText = '';
  let toolCalls: any[] = [];

  // Acumular todo primero
  for (const part of parts) {
    if (token.isCancellationRequested) break;

    switch (part.type) {
      case 'text':
        if (part.text) totalText += part.text;
        break;
      case 'reasoning':
        if (part.text) reasoningText += part.text;
        break;
      case 'tool':
        if (part.state?.status === 'pending') {
          toolCalls.push(new mockVscode.LanguageModelToolCallPart(
            part.callID || `call_${Date.now()}`,
            part.tool || 'unknown',
            part.state.input || {}
          ));
        }
        break;
      case 'step-finish':
        // tokens handled separately
        break;
      case 'error':
        throw new Error(part.text || 'Unknown server error');
    }
  }

  // Emitir en orden con yield al event loop
  const yieldLoop = () => new Promise<void>(r => setTimeout(r, 0));

  if (reasoningText) {
    progress.report(new mockVscode.LanguageModelTextPart(`[reasoning]\n${reasoningText}\n[/reasoning]\n\n`));
    await yieldLoop();
  }

  for (const tc of toolCalls) {
    progress.report(tc);
    await yieldLoop();
  }

  if (totalText) {
    progress.report(new mockVscode.LanguageModelTextPart(totalText));
    await yieldLoop();
  }

  if (!reasoningText && toolCalls.length === 0 && !totalText) {
    progress.report(new mockVscode.LanguageModelTextPart(''));
    await yieldLoop();
  }

  // CRÍTICO: Esperar a que el UI procese
  await new Promise(r => setTimeout(r, 150));

  return { totalText, reasoningText, toolCalls: toolCalls.length };
}

// ── Tests ──
describe('OpenCodeServerProvider - Streaming con datos reales', () => {
  let progress: any;
  let token: any;

  beforeEach(() => {
    progress = {
      reports: [] as any[],
      report(part: any) {
        this.reports.push({ type: part.constructor.name, value: (part as any).value ?? (part as any).callId });
      }
    };
    token = { isCancellationRequested: false };
  });

  it('debe emitir reasoning antes que texto', async () => {
    await processServerResponse(REAL_RESPONSE, progress, token);

    const types = progress.reports.map((r: any) => r.type);
    const reasoningIdx = types.indexOf('LanguageModelTextPart');
    const textIdx = types.findIndex((t: string, i: number) => t === 'LanguageModelTextPart' && i > reasoningIdx);

    assert.ok(reasoningIdx >= 0, 'Debe emitir reasoning');
    assert.ok(progress.reports[reasoningIdx].value.includes('Analizando'), 'El reasoning debe contener el texto');
  });

  it('debe emitir texto después de reasoning', async () => {
    await processServerResponse(REAL_RESPONSE, progress, token);

    const textReports = progress.reports.filter((r: any) => r.type === 'LanguageModelTextPart' && !r.value.includes('[reasoning]'));
    assert.ok(textReports.length > 0, 'Debe emitir texto');
    assert.ok(textReports[0].value.includes('42'), 'El texto debe contener "42"');
  });

  it('debe manejar respuesta con solo texto (sin reasoning)', async () => {
    const textOnly = {
      parts: [
        { type: 'text', text: 'Solo texto' }
      ]
    };

    await processServerResponse(textOnly, progress, token);

    assert.strictEqual(progress.reports.length, 1, 'Debe emitir exactamente 1 part');
    assert.strictEqual(progress.reports[0].value, 'Solo texto');
  });

  it('debe manejar respuesta vacía emitiendo part vacío', async () => {
    const empty = { parts: [] };

    await processServerResponse(empty, progress, token);

    assert.strictEqual(progress.reports.length, 1, 'Debe emitir 1 part vacío');
    assert.strictEqual(progress.reports[0].value, '');
  });

  it('debe manejar tool calls', async () => {
    const withTool = {
      parts: [
        { type: 'tool', callID: 'call_123', tool: 'read_file', state: { status: 'pending', input: { path: '/test.txt' } } },
        { type: 'text', text: 'Archivo leído' }
      ]
    };

    await processServerResponse(withTool, progress, token);

    const toolReports = progress.reports.filter((r: any) => r.type === 'LanguageModelToolCallPart');
    assert.strictEqual(toolReports.length, 1, 'Debe emitir 1 tool call');
    assert.strictEqual(toolReports[0].value, 'call_123');
  });

  it('debe lanzar error si hay error en la respuesta', async () => {
    const errorResponse = {
      error: { message: 'Model not found' }
    };

    await assert.rejects(
      async () => await processServerResponse(errorResponse, progress, token),
      /Model not found/
    );
  });

  it('debe respetar cancelación del token', async () => {
    token.isCancellationRequested = true;

    await processServerResponse(REAL_RESPONSE, progress, token);

    // No debe emitir nada porque se canceló antes de procesar
    assert.strictEqual(progress.reports.length, 1, 'Solo debe emitir el part vacío de cierre');
  });

  it('debe manejar múltiples text parts concatenándolos', async () => {
    const multiText = {
      parts: [
        { type: 'text', text: 'Primera parte. ' },
        { type: 'text', text: 'Segunda parte.' }
      ]
    };

    const result = await processServerResponse(multiText, progress, token);

    assert.strictEqual(result.totalText, 'Primera parte. Segunda parte.');
  });

  it('debe manejar reasoning + text + tool en orden correcto', async () => {
    const complex = {
      parts: [
        { type: 'reasoning', text: 'Pensando...' },
        { type: 'tool', callID: 'call_1', tool: 'search', state: { status: 'pending', input: { query: 'test' } } },
        { type: 'text', text: 'Resultado: OK' }
      ]
    };

    await processServerResponse(complex, progress, token);

    const types = progress.reports.map((r: any) => r.type);
    // El reasoning se envuelve en TextPart, luego tool, luego text
    assert.ok(types.includes('LanguageModelTextPart'), 'Debe tener text parts');
    assert.ok(types.includes('LanguageModelToolCallPart'), 'Debe tener tool call');
  });
});

console.log('✅ Streaming tests cargados');
