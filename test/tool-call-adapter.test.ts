// filepath: test/tool-call-adapter.test.ts
// Unit tests for the inline tool-call and reasoning parser.
// Run with: npx tsx --test test/tool-call-adapter.test.ts

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ToolCallAdapter } from '../src/tools/toolCallAdapter';

describe('ToolCallAdapter — basic text', () => {
  it('passes plain text through unchanged', () => {
    const a = new ToolCallAdapter();
    const r = a.parse('Hello, world!');
    assert.strictEqual(r.text, 'Hello, world!');
    assert.strictEqual(r.reasoning, '');
    assert.strictEqual(r.toolCalls.length, 0);
    assert.strictEqual(r.leftover, '');
  });

  it('keeps an unrelated "### Reasoning" string in plain text when no close header follows', () => {
    const a = new ToolCallAdapter();
    const r = a.parse('Note: use ### Reasoning in your answer.\nThen continue.');
    assert.strictEqual(r.text, 'Note: use ### Reasoning in your answer.\nThen continue.');
    assert.strictEqual(r.reasoning, '');
    assert.strictEqual(r.toolCalls.length, 0);
  });
});

describe('ToolCallAdapter — <tool_call> / <think> (default Qwen / DeepSeek style)', () => {
  it('extracts a single complete <tool_call> block', () => {
    const a = new ToolCallAdapter();
    const r = a.parse('Let me check <tool_call>{"name":"get_weather","arguments":{"city":"Madrid"}}</tool_call> the result.');
    assert.strictEqual(r.text, 'Let me check  the result.');
    assert.strictEqual(r.toolCalls.length, 1);
    assert.strictEqual(r.toolCalls[0].name, 'get_weather');
    assert.deepStrictEqual(r.toolCalls[0].input, { city: 'Madrid' });
    assert.ok(r.toolCalls[0].callId.startsWith('call_local_'));
  });

  it('extracts a single complete <think> block', () => {
    const a = new ToolCallAdapter();
    const r = a.parse('<think>The user wants the weather.</think>I will check.');
    assert.strictEqual(r.text, 'I will check.');
    assert.strictEqual(r.reasoning, 'The user wants the weather.');
    assert.strictEqual(r.toolCalls.length, 0);
  });

  it('handles reasoning and tool call interleaved', () => {
    const a = new ToolCallAdapter();
    const r = a.parse(
      '<think>Need to call weather API.</think><tool_call>{"name":"get_weather","arguments":{"city":"Madrid"}}</tool_call>Done.'
    );
    assert.strictEqual(r.text, 'Done.');
    assert.strictEqual(r.reasoning, 'Need to call weather API.');
    assert.strictEqual(r.toolCalls.length, 1);
    assert.strictEqual(r.toolCalls[0].name, 'get_weather');
  });

  it('buffers a <tool_call> block split across chunks', () => {
    const a = new ToolCallAdapter();
    const r1 = a.parse('Hello <tool_call>{"name":"f","argumen');
    assert.strictEqual(r1.text, 'Hello ');
    assert.strictEqual(r1.toolCalls.length, 0);
    assert.ok(r1.leftover.startsWith('<tool_call>'), 'leftover should hold the partial opening');
    assert.ok(r1.leftover.includes('"argumen'));

    const r2 = a.parse(r1.leftover + 'ts":{}}</tool_call> bye');
    assert.strictEqual(r2.text, ' bye');
    assert.strictEqual(r2.toolCalls.length, 1);
    assert.strictEqual(r2.toolCalls[0].name, 'f');
    assert.deepStrictEqual(r2.toolCalls[0].input, {});
  });

  it('buffers a <think> block split across chunks', () => {
    const a = new ToolCallAdapter();
    const r1 = a.parse('pre<think>partial reason');
    assert.strictEqual(r1.text, 'pre');
    assert.ok(r1.leftover.includes('partial reason'));

    const r2 = a.parse(r1.leftover + 'ing</think>after');
    assert.strictEqual(r2.text, 'after');
    assert.strictEqual(r2.reasoning, 'partial reasoning');
  });

  it('keeps callId stable when the same tool call arrives in two chunks', () => {
    const a = new ToolCallAdapter();
    const r1 = a.parse('<tool_call>{"name":"f","arguments":{"x":1}}');
    const r2 = a.parse(r1.leftover + '</tool_call>');
    assert.strictEqual(r1.toolCalls.length, 0);
    assert.strictEqual(r2.toolCalls.length, 1);
    assert.ok(r2.toolCalls[0].callId.startsWith('call_local_'));
  });

  it('handles multiple tool calls in one chunk', () => {
    const a = new ToolCallAdapter();
    const r = a.parse(
      '<tool_call>{"name":"a","arguments":{}}</tool_call> and <tool_call>{"name":"b","arguments":{}}</tool_call> end'
    );
    assert.strictEqual(r.text, ' and  end');
    assert.strictEqual(r.toolCalls.length, 2);
    assert.deepStrictEqual([r.toolCalls[0].name, r.toolCalls[1].name], ['a', 'b']);
  });

  it('accepts nested-shape JSON with function object', () => {
    const a = new ToolCallAdapter();
    const r = a.parse('<tool_call>{"function":{"name":"sum","arguments":"{\\"a\\":1}"}}</tool_call>');
    assert.strictEqual(r.toolCalls.length, 1);
    assert.strictEqual(r.toolCalls[0].name, 'sum');
    assert.deepStrictEqual(r.toolCalls[0].input, { a: 1 });
  });

  it('falls back gracefully when the body is not JSON', () => {
    const a = new ToolCallAdapter();
    const r = a.parse('<tool_call>not json</tool_call>');
    assert.strictEqual(r.toolCalls.length, 0);
    assert.strictEqual(r.text, '');
  });

  it('preserves a trailing partial opening tag in leftover', () => {
    const a = new ToolCallAdapter();
    const r = a.parse('hello <tool_cal');
    assert.strictEqual(r.text, 'hello ');
    assert.strictEqual(r.leftover, '<tool_cal');
    const r2 = a.parse(r.leftover + 'l>{"name":"f","arguments":{}}</tool_call>');
    assert.strictEqual(r2.text, '');
    assert.strictEqual(r2.toolCalls.length, 1);
    assert.strictEqual(r2.toolCalls[0].name, 'f');
  });

  it('preserves a trailing partial <think> tag in leftover', () => {
    const a = new ToolCallAdapter();
    const r = a.parse('hello <thin');
    assert.strictEqual(r.text, 'hello ');
    assert.strictEqual(r.leftover, '<thin');
    const r2 = a.parse(r.leftover + 'k>thinking</think>done');
    assert.strictEqual(r2.text, 'done');
    assert.strictEqual(r2.reasoning, 'thinking');
  });
});

describe('ToolCallAdapter — alternative tool-call tag shapes', () => {
  it('recognizes <toolcall> (single word, lowercase)', () => {
    const a = new ToolCallAdapter();
    const r = a.parse('<toolcall>{"name":"f","arguments":{}}</toolcall>');
    assert.strictEqual(r.toolCalls.length, 1);
    assert.strictEqual(r.toolCalls[0].name, 'f');
  });

  it('recognizes <tool> (bare, no _call suffix)', () => {
    const a = new ToolCallAdapter();
    const r = a.parse('Hello <tool>{"name":"f","arguments":{}}</tool> done');
    assert.strictEqual(r.text, 'Hello  done');
    assert.strictEqual(r.toolCalls.length, 1);
  });

  it('recognizes <invoke> (Hermes / Granite style)', () => {
    const a = new ToolCallAdapter();
    const r = a.parse('<invoke name="lookup">{"q":"x"}</invoke>');
    assert.strictEqual(r.toolCalls.length, 1);
    assert.strictEqual(r.toolCalls[0].name, 'lookup');
    assert.deepStrictEqual(r.toolCalls[0].input, { q: 'x' });
  });

  it('recognizes <action> tag', () => {
    const a = new ToolCallAdapter();
    const r = a.parse('<action>{"name":"f","arguments":{}}</action>');
    assert.strictEqual(r.toolCalls.length, 1);
  });

  it('recognizes <function> tag', () => {
    const a = new ToolCallAdapter();
    const r = a.parse('<function>{"name":"f","arguments":{}}</function>');
    assert.strictEqual(r.toolCalls.length, 1);
  });

  it('recognizes <antml:function_calls> (Mistral / Anthropic-XML)', () => {
    const a = new ToolCallAdapter();
    const r = a.parse('<antml:function_calls>{"name":"f","arguments":{}}</antml:function_calls>');
    assert.strictEqual(r.toolCalls.length, 1);
  });

  it('recognizes <|tool_call|> (Llama 3.x / Meta)', () => {
    const a = new ToolCallAdapter();
    const r = a.parse('Hello <|tool_call|>{"name":"f","arguments":{}}</|tool_call|> bye');
    assert.strictEqual(r.text, 'Hello  bye');
    assert.strictEqual(r.toolCalls.length, 1);
    assert.strictEqual(r.toolCalls[0].name, 'f');
  });

  it('recognizes [TOOL_CALL] / [/TOOL_CALL] (Cohere / Yi bracket style)', () => {
    const a = new ToolCallAdapter();
    const r = a.parse('Hello [TOOL_CALL]{"name":"f","arguments":{}}[/TOOL_CALL] bye');
    assert.strictEqual(r.text, 'Hello  bye');
    assert.strictEqual(r.toolCalls.length, 1);
  });

  it('recognizes [TOOL_CALLS] (plural)', () => {
    const a = new ToolCallAdapter();
    const r = a.parse('[TOOL_CALLS]{"name":"f","arguments":{}}[/TOOL_CALLS]');
    assert.strictEqual(r.toolCalls.length, 1);
  });

  it('is case-insensitive for tool tags', () => {
    const a = new ToolCallAdapter();
    const r = a.parse('<TOOL_CALL>{"name":"f","arguments":{}}</TOOL_CALL>');
    assert.strictEqual(r.toolCalls.length, 1);
  });
});

describe('ToolCallAdapter — alternative reasoning tag shapes', () => {
  it('recognizes <reasoning> tag', () => {
    const a = new ToolCallAdapter();
    const r = a.parse('<reasoning>thinking about it</reasoning>visible answer');
    assert.strictEqual(r.text, 'visible answer');
    assert.strictEqual(r.reasoning, 'thinking about it');
  });

  it('recognizes <reflection> tag', () => {
    const a = new ToolCallAdapter();
    const r = a.parse('<reflection>looking back</reflection>answer');
    assert.strictEqual(r.reasoning, 'looking back');
    assert.strictEqual(r.text, 'answer');
  });

  it('recognizes <analysis> tag', () => {
    const a = new ToolCallAdapter();
    const r = a.parse('<analysis>step 1, step 2</analysis>conclusion');
    assert.strictEqual(r.reasoning, 'step 1, step 2');
  });

  it('recognizes <thought> tag', () => {
    const a = new ToolCallAdapter();
    const r = a.parse('<thought>pondering</thought>final');
    assert.strictEqual(r.reasoning, 'pondering');
  });

  it('recognizes <solution> tag', () => {
    const a = new ToolCallAdapter();
    const r = a.parse('<solution>derivation</solution>short answer');
    assert.strictEqual(r.reasoning, 'derivation');
  });

  it('recognizes <plan> tag', () => {
    const a = new ToolCallAdapter();
    const r = a.parse('<plan>1) do x 2) do y</plan>ok');
    assert.strictEqual(r.reasoning, '1) do x 2) do y');
  });

  it('recognizes <|thinking|> (pipe-bar) tag', () => {
    const a = new ToolCallAdapter();
    const r = a.parse('<|thinking|>deep thought</|thinking|>answer');
    assert.strictEqual(r.reasoning, 'deep thought');
    assert.strictEqual(r.text, 'answer');
  });

  it('recognizes <|reasoning|> (pipe-bar) tag', () => {
    const a = new ToolCallAdapter();
    const r = a.parse('<|reasoning|>thought</|reasoning|>answer');
    assert.strictEqual(r.reasoning, 'thought');
  });

  it('recognizes [THINK] / [/THINK] (bracket) tag', () => {
    const a = new ToolCallAdapter();
    const r = a.parse('[THINK]deliberation[/THINK]output');
    assert.strictEqual(r.reasoning, 'deliberation');
    assert.strictEqual(r.text, 'output');
  });

  it('recognizes [THINKING] (plural) tag', () => {
    const a = new ToolCallAdapter();
    const r = a.parse('[THINKING]step by step[/THINKING]final');
    assert.strictEqual(r.reasoning, 'step by step');
  });

  it('recognizes <thinking> tag (with -ing suffix)', () => {
    const a = new ToolCallAdapter();
    const r = a.parse('<thinking>thoughts</thinking>answer');
    assert.strictEqual(r.reasoning, 'thoughts');
  });

  it('is case-insensitive for thinking tags', () => {
    const a = new ToolCallAdapter();
    const r = a.parse('<REASONING>x</REASONING>y');
    assert.strictEqual(r.reasoning, 'x');
    assert.strictEqual(r.text, 'y');
  });

  it('recognizes markdown-style ### Reasoning ... ### Response', () => {
    const a = new ToolCallAdapter();
    const r = a.parse('### Reasoning\nLet me think.\n### Response\nThe answer is 42.');
    assert.strictEqual(r.reasoning, 'Let me think.');
    assert.strictEqual(r.text, 'The answer is 42.');
  });

  it('recognizes markdown-style ### Thought', () => {
    const a = new ToolCallAdapter();
    const r = a.parse('### Thought\nI wonder.\n### Answer\ndone');
    assert.strictEqual(r.reasoning, 'I wonder.');
    assert.strictEqual(r.text, 'done');
  });
});

describe('ToolCallAdapter — mixed / edge cases', () => {
  it('does not confuse a tool tag with a thinking tag when both are present', () => {
    const a = new ToolCallAdapter();
    const r = a.parse(
      '<reasoning>I need to call a function.</reasoning><tool_call>{"name":"f","arguments":{}}</tool_call>visible'
    );
    assert.strictEqual(r.reasoning, 'I need to call a function.');
    assert.strictEqual(r.toolCalls.length, 1);
    assert.strictEqual(r.text, 'visible');
  });

  it('handles a stream of <reasoning> then <tool_call> then <reasoning> again', () => {
    const a = new ToolCallAdapter();
    const r = a.parse(
      '<reasoning>first thought</reasoning><tool_call>{"name":"f","arguments":{}}</tool_call><reasoning>second thought</reasoning>final'
    );
    assert.strictEqual(r.reasoning, 'first thoughtsecond thought');
    assert.strictEqual(r.toolCalls.length, 1);
    assert.strictEqual(r.text, 'final');
  });

  it('handles tool body with Cohere-style {tool, parameters}', () => {
    const a = new ToolCallAdapter();
    const r = a.parse('<tool_call>{"tool":"lookup","parameters":{"q":"x"}}</tool_call>');
    assert.strictEqual(r.toolCalls.length, 1);
    assert.strictEqual(r.toolCalls[0].name, 'lookup');
    assert.deepStrictEqual(r.toolCalls[0].input, { q: 'x' });
  });

  it('handles tool body with input/args fallback fields', () => {
    const a = new ToolCallAdapter();
    const r = a.parse('<tool_call>{"name":"f","input":{"x":1}}</tool_call>');
    assert.strictEqual(r.toolCalls.length, 1);
    assert.deepStrictEqual(r.toolCalls[0].input, { x: 1 });

    const r2 = a.parse('<tool_call>{"name":"f","args":{"y":2}}</tool_call>');
    assert.deepStrictEqual(r2.toolCalls[0].input, { y: 2 });
  });

  it('buffers a split <|tool_call|> ... </|tool_call|> block', () => {
    const a = new ToolCallAdapter();
    const r1 = a.parse('hi <|tool_call|>{"name":"f"');
    assert.strictEqual(r1.text, 'hi ');
    assert.ok(r1.leftover.startsWith('<|tool_call|>'));
    const r2 = a.parse(r1.leftover + ',"arguments":{}}</|tool_call|> bye');
    assert.strictEqual(r2.text, ' bye');
    assert.strictEqual(r2.toolCalls.length, 1);
  });

  it('preserves a trailing partial <|tool_cal in leftover', () => {
    const a = new ToolCallAdapter();
    const r = a.parse('hello <|tool_cal');
    assert.strictEqual(r.text, 'hello ');
    assert.strictEqual(r.leftover, '<|tool_cal');
  });

  it('preserves a trailing partial [TOOL_CAL in leftover', () => {
    const a = new ToolCallAdapter();
    const r = a.parse('hello [TOOL_CAL');
    assert.strictEqual(r.text, 'hello ');
    assert.strictEqual(r.leftover, '[TOOL_CAL');
  });

  it('handles <tool_call> with whitespace inside closing tag (</ tool_call >)', () => {
    const a = new ToolCallAdapter();
    const r = a.parse('<tool_call>{"name":"f","arguments":{}}</ tool_call >');
    assert.strictEqual(r.toolCalls.length, 1);
  });

  it('leaves the body of an unterminated block in leftover', () => {
    const a = new ToolCallAdapter();
    const r = a.parse('hi <reasoning>still thinking');
    assert.strictEqual(r.text, 'hi ');
    assert.ok(r.leftover.includes('still thinking'));
    const r2 = a.parse(r.leftover + '</reasoning>answer');
    assert.strictEqual(r2.text, 'answer');
    assert.strictEqual(r2.reasoning, 'still thinking');
  });
});
