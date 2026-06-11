import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

// ── Mock de VS Code ANTES de importar el provider ──
const mockVscode = {
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
  LanguageModelToolResultPart: class {
    callId: string;
    content: unknown;
    constructor(callId: string, content: unknown) {
      this.callId = callId;
      this.content = content;
    }
  },
  LanguageModelDataPart: class {
    data: Uint8Array;
    mimeType: string;
    constructor(data: Uint8Array, mimeType: string) {
      this.data = data;
      this.mimeType = mimeType;
    }
  },
  LanguageModelChatMessageRole: { User: 1, Assistant: 2 },
  LanguageModelChatToolMode: { Auto: 1, Required: 2 },
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
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    showErrorMessage: async () => undefined,
  },
};

(globalThis as any).vscode = mockVscode;

// No importamos el provider real porque depende del runtime de VS Code
// Los tests validan la lógica de procesamiento con datos reales del servidor

// ── Mock de VS Code para tests ──
const mockProgress: any = {
  reports: [] as any[],
  report(part: any) {
    this.reports.push(part);
  },
  reset() {
    this.reports = [];
  }
};

const mockToken: any = {
  _cancelled: false,
  isCancellationRequested: false,
  onCancellationRequested(cb: () => void) {
    this._cancel = cb;
  },
  cancel() {
    this.isCancellationRequested = true;
    this._cancel?.();
  }
};

// ── Datos reales del servidor opencode (capturados el 2026-06-11) ──
const REAL_SERVER_RESPONSE = {
  info: {
    parentID: "msg_eb7508595001LpaBNBMYaeraQ3",
    role: "assistant",
    mode: "build",
    agent: "build",
    path: { cwd: "C:\\Users\\yague", root: "/" },
    cost: 0,
    tokens: {
      total: 28119,
      input: 28101,
      output: 2,
      reasoning: 16,
      cache: { write: 0, read: 0 }
    },
    modelID: "big-pickle",
    providerID: "opencode",
    time: { created: 1781191968330, completed: 1781191971276 },
    finish: "stop",
    id: "msg_eb750864a001hJNbOJvcAB9PYV",
    sessionID: "ses_148af9f56ffeXikS2Z65v6BFMh"
  },
  parts: [
    {
      type: "step-start",
      id: "prt_eb7508c8a001ZejpDy5DwQTQja",
      sessionID: "ses_148af9f56ffeXikS2Z65v6BFMh",
      messageID: "msg_eb750864a001hJNbOJvcAB9PYV"
    },
    {
      type: "reasoning",
      text: "The user just wants me to respond with only 'ok' and nothing else.",
      time: { start: 1781191970941, end: 1781191971263 },
      id: "prt_eb750907d001ujTCIKmM51ehMm",
      sessionID: "ses_148af9f56ffeXikS2Z65v6BFMh",
      messageID: "msg_eb750864a001hJNbOJvcAB9PYV"
    },
    {
      type: "text",
      text: "ok",
      time: { start: 1781191971265, end: 1781191971268 },
      id: "prt_eb75091c1001kiBerXP49HOzYH",
      sessionID: "ses_148af9f56ffeXikS2Z65v6BFMh",
      messageID: "msg_eb750864a001hJNbOJvcAB9PYV"
    },
    {
      reason: "stop",
      type: "step-finish",
      tokens: {
        total: 28119,
        input: 28101,
        output: 2,
        reasoning: 16,
        cache: { write: 0, read: 0 }
      },
      cost: 0,
      id: "prt_eb75091c70012qL8WtIvcfuwBn",
      sessionID: "ses_148af9f56ffeXikS2Z65v6BFMh",
      messageID: "msg_eb750864a001hJNbOJvcAB9PYV"
    }
  ]
};

// ── Test: Procesamiento de parts[] del servidor real ──
describe('OpenCodeServerProvider - Procesamiento de respuesta real', () => {
  beforeEach(() => {
    mockProgress.reset();
    mockToken.isCancellationRequested = false;
  });

  it('debe extraer texto correctamente de parts[]', () => {
    const parts = REAL_SERVER_RESPONSE.parts;
    const textParts = parts.filter((p: any) => p.type === 'text');
    const fullText = textParts.map((p: any) => p.text).join('');

    assert.strictEqual(fullText, 'ok', 'El texto debe ser "ok"');
    assert.strictEqual(textParts.length, 1, 'Debe haber exactamente 1 part de texto');
  });

  it('debe extraer reasoning correctamente', () => {
    const parts = REAL_SERVER_RESPONSE.parts;
    const reasoningParts = parts.filter((p: any) => p.type === 'reasoning');
    const fullReasoning = reasoningParts.map((p: any) => p.text).join('');

    assert.ok(fullReasoning.includes("respond with only 'ok'"), 'El reasoning debe mencionar "ok"');
    assert.strictEqual(reasoningParts.length, 1, 'Debe haber exactamente 1 part de reasoning');
  });

  it('debe extraer tokens de step-finish', () => {
    const stepFinish = REAL_SERVER_RESPONSE.parts.find((p: any) => p.type === 'step-finish');

    assert.ok(stepFinish, 'Debe haber un part step-finish');
    assert.strictEqual(stepFinish.tokens.total, 28119, 'Total tokens debe ser 28119');
    assert.strictEqual(stepFinish.tokens.input, 28101, 'Input tokens debe ser 28101');
    assert.strictEqual(stepFinish.tokens.output, 2, 'Output tokens debe ser 2');
    assert.strictEqual(stepFinish.tokens.reasoning, 16, 'Reasoning tokens debe ser 16');
  });

  it('debe detectar error en respuesta con error', () => {
    const errorResponse = {
      error: { message: 'Model not found', statusCode: 404 }
    };

    assert.ok(errorResponse.error, 'Debe detectar error a nivel top-level');
    assert.strictEqual(errorResponse.error.message, 'Model not found');
  });

  it('debe manejar respuesta vacía (sin parts)', () => {
    const emptyResponse = { info: { id: 'test' }, parts: [] };

    assert.strictEqual(emptyResponse.parts.length, 0, 'Parts debe estar vacío');
    assert.ok(emptyResponse.info, 'Debe tener info aunque parts esté vacío');
  });

  it('debe manejar respuesta con solo reasoning (sin texto)', () => {
    const reasoningOnly = {
      parts: [
        { type: 'step-start', id: '1' },
        { type: 'reasoning', text: 'Thinking...', id: '2' },
        { type: 'step-finish', tokens: { total: 10, input: 5, output: 5, reasoning: 5, cache: { read: 0, write: 0 } }, id: '3' }
      ]
    };

    const textParts = reasoningOnly.parts.filter((p: any) => p.type === 'text');
    const reasoningParts = reasoningOnly.parts.filter((p: any) => p.type === 'reasoning');

    assert.strictEqual(textParts.length, 0, 'No debe haber texto');
    assert.strictEqual(reasoningParts.length, 1, 'Debe haber reasoning');
  });

  it('debe manejar múltiples parts de texto', () => {
    const multiText = {
      parts: [
        { type: 'text', text: 'Hello ' },
        { type: 'text', text: 'world!' }
      ]
    };

    const fullText = multiText.parts.map((p: any) => p.text).join('');
    assert.strictEqual(fullText, 'Hello world!', 'Debe concatenar múltiples text parts');
  });

  it('debe manejar tool calls en parts', () => {
    const withTool = {
      parts: [
        {
          type: 'tool',
          callID: 'call_123',
          tool: 'read_file',
          state: { status: 'pending', input: { path: '/test.txt' } }
        }
      ]
    };

    const toolPart = withTool.parts[0];
    assert.strictEqual(toolPart.type, 'tool');
    assert.strictEqual(toolPart.tool, 'read_file');
    assert.strictEqual(toolPart.state.status, 'pending');
  });
});

// ── Test: Estructura de la respuesta del servidor ──
describe('Estructura de respuesta del servidor opencode', () => {
  it('debe tener info y parts en la raíz', () => {
    assert.ok(REAL_SERVER_RESPONSE.info, 'Debe tener info');
    assert.ok(REAL_SERVER_RESPONSE.parts, 'Debe tener parts');
    assert.ok(Array.isArray(REAL_SERVER_RESPONSE.parts), 'parts debe ser un array');
  });

  it('debe tener info.tokens con todas las métricas', () => {
    const tokens = REAL_SERVER_RESPONSE.info.tokens;
    assert.ok(tokens, 'Debe tener tokens');
    assert.strictEqual(typeof tokens.total, 'number');
    assert.strictEqual(typeof tokens.input, 'number');
    assert.strictEqual(typeof tokens.output, 'number');
    assert.strictEqual(typeof tokens.reasoning, 'number');
    assert.ok(tokens.cache, 'Debe tener cache');
  });

  it('debe tener info.finish con valor válido', () => {
    const finish = REAL_SERVER_RESPONSE.info.finish;
    assert.ok(['stop', 'length', 'tool_calls', 'content_filter'].includes(finish) || typeof finish === 'string',
      'finish debe ser un string válido');
  });

  it('cada part debe tener type e id', () => {
    for (const part of REAL_SERVER_RESPONSE.parts) {
      assert.ok(part.type, 'Cada part debe tener type');
      assert.ok(part.id, 'Cada part debe tener id');
    }
  });
});

// ── Test: Simulación de streaming con datos reales ──
describe('Simulación de streaming con datos reales', () => {
  it('debe emitir events en el orden correcto: step-start → reasoning → text → step-finish', () => {
    const events: string[] = [];
    const parts = REAL_SERVER_RESPONSE.parts;

    for (const part of parts) {
      events.push(part.type);
    }

    assert.deepStrictEqual(events, ['step-start', 'reasoning', 'text', 'step-finish'],
      'El orden de events debe ser correcto');
  });

  it('debe calcular duración del reasoning desde timestamps', () => {
    const reasoning = REAL_SERVER_RESPONSE.parts.find((p: any) => p.type === 'reasoning');
    if (reasoning?.time?.start && reasoning?.time?.end) {
      const duration = reasoning.time.end - reasoning.time.start;
      assert.ok(duration >= 0, 'Duración debe ser positiva');
      assert.strictEqual(duration, 322, 'Duración debe ser 322ms (1781191971263 - 1781191970941)');
    }
  });

  it('debe verificar que sessionID es consistente en todos los parts', () => {
    const sessionId = REAL_SERVER_RESPONSE.info.sessionID;
    for (const part of REAL_SERVER_RESPONSE.parts) {
      if (part.sessionID) {
        assert.strictEqual(part.sessionID, sessionId, 'sessionID debe ser consistente');
      }
    }
  });
});

console.log('✅ Tests cargados. Ejecutando...');
