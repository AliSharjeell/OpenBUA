import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const output = fileURLToPath(new URL('../.tmp-visual-context-test.mjs', import.meta.url));
const compiled = await build({
  stdin: {
    contents: 'export { FormAgentHarness } from "./src/agent/form-agent.ts"; export { analyzeAssistantTurns } from "./src/agent/stream-adapter.ts";',
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
  },
  bundle: true, write: false, format: 'esm', platform: 'node',
  external: ['@earendil-works/*', 'pdfjs-dist'], logLevel: 'silent',
});
writeFileSync(output, compiled.outputFiles[0].text);
try {
  const { FormAgentHarness, analyzeAssistantTurns } = await import(pathToFileURL(output).href);
  const turn = (id, image) => [
    { role: 'assistant', content: [{ type: 'toolCall', id, name: image ? 'capture_tab_screenshot' : 'click_at_position' }] },
    { role: 'toolResult', toolCallId: id, toolName: image ? 'capture_tab_screenshot' : 'click_at_position', content: image
      ? [{ type: 'text', text: 'Screenshot geometry' }, { type: 'image', data: id, mimeType: 'image/jpeg' }]
      : [{ type: 'text', text: 'Clicked; caret placement is not verified.' }] },
  ];
  const messages = [...turn('old-image', true), ...turn('current-image', true)];
  for (let i = 0; i < 8; i++) messages.push(...turn(`click-${i}`, false));
  const harness = Object.create(FormAgentHarness.prototype);
  harness.agent = { state: { messages } };
  harness.pruneAgentStateMessages();
  const current = messages.find(m => m.toolCallId === 'current-image');
  assert.equal(current.content[1].data, 'current-image', 'latest image survives eight tool calls in harness');
  assert.equal(messages.find(m => m.toolCallId === 'old-image').content[1].type, 'text', 'superseded image is pruned');
  assert(!analyzeAssistantTurns(messages).olderToolCallIds.has('current-image'), 'both provider adapters retain latest image');
  assert(analyzeAssistantTurns(messages).olderToolCallIds.has('click-0'), 'older nonvisual results still compact');

  messages.push(...turn('new-image', true));
  for (let i = 8; i < 12; i++) messages.push(...turn(`click-${i}`, false));
  harness.pruneAgentStateMessages();
  assert.equal(current.content[1].type, 'text', 'new image supersedes previous retained image');
  assert.equal(messages.find(m => m.toolCallId === 'new-image').content[1].data, 'new-image');
  assert(!analyzeAssistantTurns(messages).olderToolCallIds.has('new-image'));
  harness.pruneAgentStateMessages();
  assert.equal(messages.filter(m => m.role === 'toolResult').flatMap(m => m.content).filter(c => c.type === 'image').length, 1, 'repeated pruning retains one visual observation');
  console.log('PASS visual context survives intervening tools and is replaced by newer screenshots');
} finally {
  rmSync(output, { force: true });
}
