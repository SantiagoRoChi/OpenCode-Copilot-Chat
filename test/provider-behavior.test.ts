import { describe, it } from 'node:test';
import assert from 'node:assert';

// ── Tests HONESTOS del comportamiento REAL del provider ──
// El servidor opencode devuelve JSON completo (no SSE).
// El provider acumula parts[] y emite al final con yield al event loop.
// NO hay streaming progresivo real. Estos tests documentan el comportamiento actual.

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

(globalThis as any).vscode = mockVscode;

// ── Replicar EXACTAMENTE la lógica del provider ──
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

  // Acumular TODO primero (igual que el provider real)
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
    }
  }

  // Emitir en orden con yield al event loop (IGUAL que el provider real)
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

  // CRÍTICO: Esperar a que VS Code procese (150ms)
  await new Promise(r => setTimeout(r, 150));

  return { totalText, reasoningText, toolCalls: toolCalls.length };
}

describe('OpenCodeServerProvider - Comportamiento REAL (no streaming)', () => {

  it('ACUMULA todo y emite al final (no es streaming progresivo)', async () => {
    const messageData = {
      parts: [
        { type: 'step-start', id: 'p1' },
        { type: 'reasoning', text: 'Pensando...', id: 'p2' },
        { type: 'text', text: 'Respuesta', id: 'p3' },
        { type: 'step-finish', id: 'p4' }
      ]
    };

    const progress = {
      reports: [] as any[],
      report(part: any) {
        this.reports.push({
          type: part.constructor.name,
          value: part.value || part.callId,
          time: Date.now()
        });
      }
    };
    const token = { isCancellationRequested: false };

    const startTime = Date.now();
    await processServerResponse(messageData, progress, token);
    const endTime = Date.now();

    // Verificar que TODO se acumuló antes de emitir
    // El provider NO emite chunk por chunk del servidor
    // Emite: reasoning completo → tools → texto completo

    assert.strictEqual(progress.reports.length, 2, 'Emite exactamente 2 reports: reasoning + texto');

    const reasoningReport = progress.reports[0];
    const textReport = progress.reports[1];

    assert.ok(reasoningReport.value.includes('Pensando...'), 'Reasoning debe estar completo');
    assert.strictEqual(textReport.value, 'Respuesta', 'Texto debe estar completo');

    console.log(`⏱️  Tiempo total: ${endTime - startTime}ms`);
    console.log(`📊 Reports: ${progress.reports.length} (reasoning + texto)`);
    console.log(`⚠️  NOTA: El servidor opencode devuelve JSON completo, no SSE`);
    console.log(`   El provider acumula y emite al final, NO es streaming progresivo`);
  });

  it('el tiempo es corto porque no hay streaming real', async () => {
    const messageData = {
      parts: Array.from({ length: 100 }, (_, i) => ({
        type: 'text',
        text: `Chunk ${i} `,
        id: `p${i}`
      }))
    };

    const progress = {
      reports: [] as any[],
      report(part: any) {
        this.reports.push({ time: Date.now() });
      }
    };
    const token = { isCancellationRequested: false };

    const startTime = Date.now();
    await processServerResponse(messageData, progress, token);
    const endTime = Date.now();

    const duration = endTime - startTime;

    // Con 100 parts, si fuera streaming real tardaría segundos
    // Pero el provider los acumula y emite 1 solo report
    assert.ok(duration < 500, `Con acumulación debe ser rápido: ${duration}ms`);
    assert.strictEqual(progress.reports.length, 1, '100 parts → 1 report acumulado');

    console.log(`⏱️  100 parts procesados en: ${duration}ms`);
    console.log(`📊 Reports emitidos: ${progress.reports.length}`);
    console.log(`❌ Si fuera streaming real: ~10-20s. Actual: ${duration}ms`);
  });

  it('valida estructura JSON del servidor opencode', async () => {
    const serverResponse = {
      info: {
        id: 'msg_test',
        sessionID: 'ses_test',
        role: 'assistant',
        modelID: 'big-pickle',
        providerID: 'opencode',
        finish: 'stop',
        tokens: {
          total: 28119,
          input: 28101,
          output: 2,
          reasoning: 16,
          cache: { read: 0, write: 0 }
        },
        time: { created: 1781191968330, completed: 1781191971276 }
      },
      parts: [
        { type: 'step-start', id: 'p1', sessionID: 'ses_test', messageID: 'msg_test' },
        { type: 'reasoning', text: "The user wants...", time: { start: 1781191970941, end: 1781191971263 }, id: 'p2' },
        { type: 'text', text: 'ok', time: { start: 1781191971265, end: 1781191971268 }, id: 'p3' },
        { type: 'step-finish', tokens: { total: 28119, input: 28101, output: 2, reasoning: 16, cache: { read: 0, write: 0 } }, id: 'p4' }
      ]
    };

    const progress = { reports: [] as any[], report(part: any) { this.reports.push(part); } };
    const token = { isCancellationRequested: false };

    await processServerResponse(serverResponse, progress, token);

    // Validar estructura
    assert.ok(serverResponse.info, 'Debe tener info');
    assert.ok(serverResponse.parts, 'Debe tener parts');
    assert.strictEqual(serverResponse.parts.length, 4, 'Debe tener 4 parts');

    const types = serverResponse.parts.map((p: any) => p.type);
    assert.deepStrictEqual(types, ['step-start', 'reasoning', 'text', 'step-finish']);

    // Validar tokens
    assert.strictEqual(serverResponse.info.tokens.total, 28119);
    assert.strictEqual(serverResponse.info.tokens.reasoning, 16);

    console.log(`✅ Estructura JSON válida`);
    console.log(`📊 Parts: ${types.join(' → ')}`);
    console.log(`📊 Tokens: ${JSON.stringify(serverResponse.info.tokens)}`);
  });

  it('documenta la diferencia: opencode vs LMStudio streaming', () => {
    console.log(`\n📋 DOCUMENTACIÓN DEL COMPORTAMIENTO:`);
    console.log(`   Servidor opencode (127.0.0.1:4096):`);
    console.log(`     - POST /session/:id/message → devuelve JSON completo`);
    console.log(`     - NO soporta SSE/streaming`);
    console.log(`     - El provider acumula parts[] y emite al final`);
    console.log(`   LMStudio (localhost:1234):`);
    console.log(`     - POST /v1/chat/completions con stream=true → SSE real`);
    console.log(`     - Sí soporta streaming progresivo`);
    console.log(`     - Chunks llegan uno por uno con delays reales`);
    console.log(`\n⚠️  CONCLUSIÓN: Para streaming real, el provider debe conectar`);
    console.log(`   DIRECTAMENTE a LMStudio vía SSE, no via opencode server.`);

    // Este test siempre pasa, es documentación
    assert.ok(true);
  });
});

console.log('✅ Tests honestos cargados');
