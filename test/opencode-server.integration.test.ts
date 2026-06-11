import { describe, it, before } from 'node:test';
import assert from 'node:assert';

// ── Cliente directo al servidor opencode local ──
// El servidor está configurado con provider "lm-studiolocal" → http://localhost:1234/v1

const SERVER_URL = 'http://127.0.0.1:4096';

interface SessionResponse {
  id: string;
  title: string;
  version: string;
  time: { created: number; updated: number };
}

interface MessagePayload {
  model: { providerID: string; modelID: string };
  parts: Array<{ type: string; text: string }>;
}

interface ServerPart {
  type: string;
  id: string;
  sessionID?: string;
  messageID?: string;
  text?: string;
  time?: { start: number; end: number };
  tokens?: {
    total: number;
    input: number;
    output: number;
    reasoning: number;
    cache: { read: number; write: number };
  };
  cost?: number;
  reason?: string;
  tool?: string;
  callID?: string;
  state?: { status: string; input?: Record<string, unknown> };
}

interface MessageResponse {
  info: {
    id: string;
    sessionID: string;
    role: string;
    modelID: string;
    providerID: string;
    finish: string;
    tokens: {
      total: number;
      input: number;
      output: number;
      reasoning: number;
      cache: { read: number; write: number };
    };
    time: { created: number; completed: number };
  };
  parts: ServerPart[];
}

async function createSession(title: string): Promise<SessionResponse> {
  const res = await fetch(`${SERVER_URL}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(`Session create failed: ${res.status}`);
  return res.json();
}

async function sendMessage(
  sessionId: string,
  modelId: string,
  providerId: string,
  content: string
): Promise<MessageResponse> {
  const res = await fetch(`${SERVER_URL}/session/${sessionId}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: { providerID: providerId, modelID: modelId },
      parts: [{ type: 'text', text: content }],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Message failed: ${res.status} ${text}`);
  }
  return res.json();
}

// ── Tests de Integración con OpenCode Server + LMStudio ──
describe('OpenCode Server + LMStudio Integration', () => {
  let sessionId: string = '';
  const modelId = 'qwen/qwen3.5-9b';
  const providerId = 'lm-studiolocal';
  let serverAvailable = false;

  before(async () => {
    try {
      const health = await fetch(`${SERVER_URL}/global/health`);
      const data = await health.json();
      serverAvailable = data.healthy === true;
      console.log(`🏥 Server health: ${JSON.stringify(data)}`);

      if (serverAvailable) {
        const session = await createSession('Integration Test');
        sessionId = session.id;
        console.log(`📂 Session created: ${sessionId}`);
      }
    } catch (err: any) {
      console.error(`❌ Server not available: ${err.message}`);
    }
  });

  it('debe tener servidor opencode disponible', () => {
    assert.ok(serverAvailable, 'El servidor opencode debe estar corriendo en 127.0.0.1:4096');
  });

  it('debe obtener respuesta con reasoning de LMStudio vía opencode', async () => {
    if (!serverAvailable) {
      console.log('⏭️  Skipping: server not available');
      return;
    }

    const response = await sendMessage(sessionId, modelId, providerId, '¿Cuánto es 2+2? Responde solo con el número.');

    assert.ok(response.info, 'Debe tener info');
    assert.ok(response.parts, 'Debe tener parts');
    assert.ok(Array.isArray(response.parts), 'parts debe ser array');

    // Verificar estructura de parts
    const types = response.parts.map(p => p.type);
    console.log(`📋 Part types: ${types.join(' → ')}`);

    // Debe tener al menos step-start y step-finish
    assert.ok(types.includes('step-start'), 'Debe tener step-start');
    assert.ok(types.includes('step-finish'), 'Debe tener step-finish');

    // Verificar tokens
    assert.ok(response.info.tokens, 'Debe tener tokens');
    assert.ok(response.info.tokens.total > 0, `Debe usar tokens: ${response.info.tokens.total}`);

    console.log(`📊 Tokens: ${JSON.stringify(response.info.tokens)}`);
    console.log(`⏱️  Duration: ${response.info.time.completed - response.info.time.created}ms`);
  });

  it('debe manejar tarea pesada con múltiples tokens', async () => {
    if (!serverAvailable) {
      console.log('⏭️  Skipping: server not available');
      return;
    }

    const startTime = Date.now();
    const response = await sendMessage(
      sessionId,
      modelId,
      providerId,
      'Lista los 5 planetas del sistema solar con una característica cada uno. Sé detallado.'
    );
    const duration = Date.now() - startTime;

    const textParts = response.parts.filter(p => p.type === 'text');
    const fullText = textParts.map(p => p.text).join('');

    assert.ok(response.info.tokens.total > 50, `Debe usar muchos tokens: ${response.info.tokens.total}`);
    assert.ok(fullText.length > 50, `Debe generar texto sustancial: ${fullText.length} chars`);
    assert.ok(duration > 500, `Debe tomar tiempo (>500ms): ${duration}ms`);

    console.log(`📝 Texto generado: ${fullText.length} chars`);
    console.log(`📊 Tokens usados: ${response.info.tokens.total}`);
    console.log(`⏱️  Tiempo total: ${duration}ms`);
  });

  it('debe contener reasoning en respuesta compleja', async () => {
    if (!serverAvailable) {
      console.log('⏭️  Skipping: server not available');
      return;
    }

    const response = await sendMessage(
      sessionId,
      modelId,
      providerId,
      'Explica paso a paso cómo resolver x^2 - 4 = 0. Muestra tu razonamiento.'
    );

    const reasoningParts = response.parts.filter(p => p.type === 'reasoning');
    const textParts = response.parts.filter(p => p.type === 'text');

    console.log(`🧠 Reasoning parts: ${reasoningParts.length}`);
    console.log(`💬 Text parts: ${textParts.length}`);

    // El modelo puede poner el reasoning en text o en reasoning parts
    const fullText = response.parts.map(p => p.text || '').join('');
    const hasReasoning =
      reasoningParts.length > 0 ||
      fullText.toLowerCase().includes('paso') ||
      fullText.toLowerCase().includes('razonamiento') ||
      fullText.toLowerCase().includes('think');

    assert.ok(hasReasoning, `Debe contener reasoning: "${fullText.substring(0, 200)}..."`);
    assert.ok(response.info.tokens.reasoning > 0 || response.info.tokens.output > 0, 'Debe usar tokens de output/reasoning');
  });

  it('debe respetar estructura de respuesta del servidor', async () => {
    if (!serverAvailable) {
      console.log('⏭️  Skipping: server not available');
      return;
    }

    const response = await sendMessage(sessionId, modelId, providerId, 'ok');

    // Verificar info
    assert.ok(response.info.id, 'info.id debe existir');
    assert.ok(response.info.sessionID, 'info.sessionID debe existir');
    assert.ok(response.info.modelID, 'info.modelID debe existir');
    assert.ok(response.info.providerID, 'info.providerID debe existir');
    assert.ok(response.info.finish, 'info.finish debe existir');
    assert.strictEqual(response.info.providerID, providerId, 'providerID debe coincidir');

    // Verificar parts
    assert.ok(response.parts.length >= 2, `Debe tener al menos 2 parts: ${response.parts.length}`);

    for (const part of response.parts) {
      assert.ok(part.type, 'Cada part debe tener type');
      assert.ok(part.id, 'Cada part debe tener id');
    }

    // Verificar orden de eventos
    const types = response.parts.map(p => p.type);
    assert.strictEqual(types[0], 'step-start', 'El primer part debe ser step-start');
    assert.strictEqual(types[types.length - 1], 'step-finish', 'El último part debe ser step-finish');
  });

  it('debe manejar respuesta vacía o mínima', async () => {
    if (!serverAvailable) {
      console.log('⏭️  Skipping: server not available');
      return;
    }

    const response = await sendMessage(sessionId, modelId, providerId, 'Responde solo con la palabra "test".');

    const textParts = response.parts.filter(p => p.type === 'text');
    const fullText = textParts.map(p => p.text).join('');

    assert.ok(response.parts.length >= 2, 'Debe tener al menos step-start y step-finish');
    assert.ok(response.info.finish === 'stop', `Debe terminar con stop: ${response.info.finish}`);

    console.log(`💬 Respuesta mínima: "${fullText}"`);
  });
});

console.log('✅ OpenCode Server integration tests cargados');
