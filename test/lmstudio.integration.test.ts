import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import {
  listModels,
  chatCompletion,
  streamChatCompletion,
  LMStudioMessage
} from './lmstudio-client';

// ── Tests de Integración con LMStudio Local ──
// Requiere LMStudio corriendo en http://localhost:1234
// Tests pesados para verificar streaming real con reasoning, tools, etc.

describe('LMStudio Integration', () => {
  let availableModels: string[] = [];
  let testModel: string = '';

  before(async () => {
    try {
      availableModels = await listModels();
      // Preferir modelos que soporten reasoning
      const reasoningModels = availableModels.filter(m => 
        m.includes('qwen') || m.includes('gemma') || m.includes('deepseek')
      );
      testModel = reasoningModels[0] || availableModels[0];
      console.log(`🤖 Modelos disponibles: ${availableModels.join(', ')}`);
      console.log(`🎯 Usando modelo: ${testModel}`);
    } catch (err: any) {
      console.error(`❌ LMStudio no disponible: ${err.message}`);
      console.error('   Asegúrate de que LMStudio esté corriendo en http://localhost:1234');
    }
  });

  it('debe listar modelos disponibles', () => {
    assert.ok(availableModels.length > 0, 'Debe haber al menos 1 modelo cargado');
    assert.ok(testModel, 'Debe poder seleccionar un modelo de prueba');
  });

  it('debe obtener respuesta con reasoning_content', async () => {
    if (!testModel) {
      console.log('⏭️  Skipping: LMStudio no disponible');
      return;
    }

    const messages: LMStudioMessage[] = [
      { role: 'system', content: 'Eres un asistente conciso. Responde solo con el número.' },
      { role: 'user', content: '¿Cuánto es 2+2?' }
    ];

    const response = await chatCompletion(testModel, messages, 0.1, 50);
    const message = response.choices[0]?.message;

    assert.ok(response.id, 'Debe tener id');
    assert.ok(message, 'Debe tener message');
    assert.ok(response.usage, 'Debe tener usage');
    assert.ok(response.usage.total_tokens > 0, 'Debe usar tokens');

    // El modelo puede devolver content vacío pero reasoning_content lleno
    const hasContent = message.content && message.content.length > 0;
    const hasReasoning = message.reasoning_content && message.reasoning_content.length > 0;

    assert.ok(
      hasContent || hasReasoning,
      `Debe tener content o reasoning_content. content="${message.content}", reasoning="${message.reasoning_content?.substring(0, 50)}"`
    );

    console.log(`💬 Content: "${message.content}"`);
    console.log(`🧠 Reasoning: "${message.reasoning_content?.substring(0, 100)}..."`);
    console.log(`📊 Tokens: ${response.usage.total_tokens} (prompt: ${response.usage.prompt_tokens}, completion: ${response.usage.completion_tokens}, reasoning: ${response.usage.completion_tokens_details?.reasoning_tokens || 0})`);
  });

  it('debe streamear respuesta chunk por chunk con muchos tokens', async () => {
    if (!testModel) {
      console.log('⏭️  Skipping: LMStudio no disponible');
      return;
    }

    // Tarea pesada: generar una lista larga para forzar múltiples chunks
    const messages: LMStudioMessage[] = [
      { role: 'system', content: 'Eres un asistente útil. Genera respuestas detalladas.' },
      { role: 'user', content: 'Lista los 10 planetas del sistema solar con 2 características cada uno. Sé muy detallado.' }
    ];

    const chunks: string[] = [];
    const reasoningChunks: string[] = [];
    let chunkCount = 0;
    let startTime = Date.now();

    for await (const chunk of streamChatCompletion(testModel, messages, 0.7, 500)) {
      chunkCount++;
      assert.ok(chunk.id, 'Cada chunk debe tener id');
      assert.ok(chunk.choices, 'Cada chunk debe tener choices');

      const delta = chunk.choices[0]?.delta;
      if (delta?.content) {
        chunks.push(delta.content);
      }
      if (delta?.role) {
        // primer chunk con role
      }
    }

    const duration = Date.now() - startTime;
    const fullText = chunks.join('');

    // Verificaciones de streaming real
    assert.ok(chunkCount >= 3, `Debe recibir al menos 3 chunks para verificar streaming, recibió ${chunkCount}`);
    assert.ok(fullText.length > 100, `El texto debe ser largo (>100 chars): ${fullText.length} chars`);
    assert.ok(duration > 100, `El streaming debe tomar tiempo (>100ms): ${duration}ms`);

    // Verificar que el contenido es coherente
    assert.ok(
      fullText.toLowerCase().includes('planeta') || 
      fullText.toLowerCase().includes('mercurio') ||
      fullText.toLowerCase().includes('tierra'),
      `La respuesta debe mencionar planetas: "${fullText.substring(0, 100)}..."`
    );

    console.log(`🌊 Streaming REAL: ${chunkCount} chunks en ${duration}ms`);
    console.log(`📝 Texto: ${fullText.length} chars`);
    console.log(`📝 Preview: "${fullText.substring(0, 150)}..."`);
  });

  it('debe manejar reasoning en streaming pesado', async () => {
    if (!testModel) {
      console.log('⏭️  Skipping: LMStudio no disponible');
      return;
    }

    // Tarea que requiere reasoning: problema matemático complejo
    const messages: LMStudioMessage[] = [
      { role: 'system', content: 'Primero razona paso a paso, luego da la respuesta final.' },
      { role: 'user', content: 'Si un tren viaja a 60 km/h y otro a 80 km/h en dirección opuesta, ¿a qué distancia estarán después de 2 horas? Explica tu razonamiento detalladamente.' }
    ];

    const contentChunks: string[] = [];
    let chunkCount = 0;
    let startTime = Date.now();

    for await (const chunk of streamChatCompletion(testModel, messages, 0.7, 400)) {
      chunkCount++;
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) {
        contentChunks.push(delta.content);
      }
    }

    const duration = Date.now() - startTime;
    const fullText = contentChunks.join('');

    assert.ok(chunkCount >= 5, `Debe haber al menos 5 chunks: ${chunkCount}`);
    assert.ok(fullText.length > 50, `Debe haber contenido sustancial: ${fullText.length} chars`);
    assert.ok(duration > 200, `El reasoning debe tomar tiempo: ${duration}ms`);

    // Verificar que hay reasoning (palabras clave de razonamiento)
    const hasReasoning = 
      fullText.toLowerCase().includes('razonamiento') ||
      fullText.toLowerCase().includes('paso') ||
      fullText.toLowerCase().includes('primero') ||
      fullText.toLowerCase().includes('distancia') ||
      fullText.toLowerCase().includes('velocidad') ||
      fullText.toLowerCase().includes('km');

    assert.ok(hasReasoning, `Debe contener reasoning: "${fullText.substring(0, 200)}..."`);

    console.log(`🧠 Reasoning streaming: ${chunkCount} chunks en ${duration}ms`);
    console.log(`📝 Respuesta: "${fullText.substring(0, 200)}..."`);
  });

  it('debe respetar max_tokens en tarea pesada', async () => {
    if (!testModel) {
      console.log('⏭️  Skipping: LMStudio no disponible');
      return;
    }

    const messages: LMStudioMessage[] = [
      { role: 'user', content: 'Escribe un ensayo largo sobre la historia de la computación.' }
    ];

    const response = await chatCompletion(testModel, messages, 0.7, 50);
    const tokens = response.usage?.completion_tokens || 0;
    const content = response.choices[0]?.message?.content || '';

    assert.ok(tokens <= 60, `Debe respetar max_tokens=50 (con margen): usó ${tokens}`);
    assert.ok(content.length <= 300, `El contenido debe ser corto: ${content.length} chars`);

    console.log(`📏 max_tokens respetado: ${tokens} tokens, ${content.length} chars`);
  });

  it('debe manejar respuesta vacía o de solo reasoning', async () => {
    if (!testModel) {
      console.log('⏭️  Skipping: LMStudio no disponible');
      return;
    }

    // Prompt que fuerza solo reasoning sin output visible
    const messages: LMStudioMessage[] = [
      { role: 'system', content: 'Piensa en la respuesta pero NO escribas nada. Solo razona internamente.' },
      { role: 'user', content: '¿Cuál es el sentido de la vida?' }
    ];

    const response = await chatCompletion(testModel, messages, 0.7, 100);
    const message = response.choices[0]?.message;

    // Puede tener content vacío pero reasoning
    const hasContent = message.content && message.content.length > 0;
    const hasReasoning = message.reasoning_content && message.reasoning_content.length > 0;

    assert.ok(
      hasContent || hasReasoning,
      'Debe tener al menos content o reasoning'
    );

    console.log(`🤔 Solo reasoning: content="${message.content}", reasoning="${message.reasoning_content?.substring(0, 100)}..."`);
  });
});

console.log('✅ LMStudio integration tests cargados');
