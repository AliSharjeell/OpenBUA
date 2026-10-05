import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { writeFileSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const path = resolve('.tmp-recovery-tool-choice.mjs');
const compiled = await build({
  stdin: { contents: 'export { createStreamFn, createCustomModel } from "./src/agent/stream-adapter.ts"; export { recoveryRequiresTool, toolChoiceRejected } from "./src/agent/recovery-tool-choice.ts";', resolveDir: process.cwd() },
  bundle: true, write: false, format: 'esm', platform: 'node', external: ['@earendil-works/*', 'pdfjs-dist'], logLevel: 'silent',
});
writeFileSync(path, compiled.outputFiles[0].text);
const oldFetch = globalThis.fetch;
try {
  const { createStreamFn, createCustomModel, recoveryRequiresTool, toolChoiceRejected } = await import(pathToFileURL(path).href);
  const directive = { role: 'user', content: [{ type: 'text', text: 'SYSTEM: your previous turn was cut off because you spent it reasoning instead of acting. Your next output MUST be a tool call.' }] };
  assert.equal(recoveryRequiresTool([directive]), true);
  assert.equal(recoveryRequiresTool([directive, { role: 'toolResult', content: [] }]), false, 'after acting the model can answer normally');
  assert.equal(recoveryRequiresTool([directive, { role: 'user', content: 'What happened?' }]), false, 'new ordinary question does not require tools');
  assert.equal(recoveryRequiresTool([{ role: 'toolResult', content: directive.content }]), false, 'tool text cannot force tool policy');
  assert.equal(toolChoiceRejected(400, 'tool_choice required is not supported'), true);
  assert.equal(toolChoiceRejected(400, 'invalid API key'), false);
  assert.equal(toolChoiceRejected(429, 'tool_choice unsupported'), false);

  for (const provider of ['openai', 'anthropic']) {
    const config = { provider, baseUrl: 'https://api.example.com/v1', apiKey: 'test-key', model: 'test-model' };
    async function request(messages, rejectFirst = false) {
      const payloads = [];
      globalThis.fetch = async (_url, options) => {
        payloads.push(JSON.parse(options.body));
        if (rejectFirst && payloads.length === 1) return new Response('tool_choice forced mode is not supported', { status: 400 });
        return new Response(provider === 'openai' ? 'data: [DONE]\n\n' : 'event: message_stop\ndata: {"type":"message_stop"}\n\n', { status: 200 });
      };
      const stream = await createStreamFn(config, createCustomModel(config), { messages, systemPrompt: 'test' });
      const events = [];
      for await (const event of stream) events.push(event);
      assert.ok(!events.some(event => event.type === 'error'), 'mock provider stream completes');
      return payloads;
    }
    const ordinary = await request([{ role: 'user', content: 'Explain this' }]);
    assert.equal(provider === 'openai' ? ordinary[0].tool_choice : ordinary[0].tool_choice?.type, provider === 'openai' ? 'auto' : undefined);
    const recovery = await request([directive]);
    assert.equal(provider === 'openai' ? recovery[0].tool_choice : recovery[0].tool_choice.type, provider === 'openai' ? 'required' : 'any');
    const fallback = await request([directive], true);
    assert.equal(fallback.length, 2, 'unsupported forced mode retries once');
    assert.equal(provider === 'openai' ? fallback[1].tool_choice : fallback[1].tool_choice.type, 'auto');
  }
  console.log('PASS actual OpenAI/Anthropic recovery payloads, ordinary answers, and unsupported provider fallback');
} finally {
  globalThis.fetch = oldFetch;
  rmSync(path, { force: true });
}
