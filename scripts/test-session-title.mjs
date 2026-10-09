import assert from 'node:assert/strict';
import { build } from 'esbuild';
const store = new Map();
globalThis.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
const result = await build({ stdin: { contents: `export * from './src/services/session-title'; export {DEFAULT_SETTINGS, saveChatSessions, loadChatSessions, renameChatSession} from './src/services/storage';`, resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'error' });
const api = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
const settings = { ...api.DEFAULT_SETTINGS, selectedMode: 'free', free: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/', apiKey: 'test-key', model: 'gemini-3.5-flash-lite' } };
let calls = 0, payload;
globalThis.fetch = async (_url, options) => { calls++; payload = JSON.parse(options.body); return { ok: true, json: async () => ({ choices: [{ message: { content: 'Comment On Mufeez YouTube Video' } }] }) }; };
assert.equal(await api.generateModelSessionTitle('go to youtube and search mufeez perspective and comment on first vid saying good', settings), 'Comment On Mufeez YouTube Video');
assert.equal(payload.reasoning_effort, 'minimal'); assert.equal(payload.tools, undefined);
assert.equal(payload.messages[1].content.includes('mufeez'), true);
assert.equal(api.cleanModelTitle('YouTube and search mufeez perspective and comment'), null);
assert.equal(api.cleanModelTitle('A title\nwith extra explanation'), null);
assert.equal(api.cleanModelTitle('Comment On Mufeez YouTube —'), null);
assert.equal(api.cleanModelTitle('**Find Remote Engineering Jobs**'), 'Find Remote Engineering Jobs');
assert.equal(api.cleanModelTitle('Title: Find Remote Jobs'), 'Find Remote Jobs');
assert.equal(api.cleanModelTitle('Chat 3'), null);
await api.saveChatSessions([{ id: 'naming-test', title: 'Chat 1', createdAt: 1, updatedAt: 1 }]);
calls = 0;
await Promise.all([api.suggestSessionTitle('naming-test', 'prompt', settings, () => {}), api.suggestSessionTitle('naming-test', 'prompt', settings, () => {})]);
assert.equal(calls, 1); assert.equal((await api.loadChatSessions())[0].title, 'Comment On Mufeez YouTube Video');
await api.suggestSessionTitle('naming-test', 'A different later prompt', settings, () => {});
assert.equal(calls, 1, 'Later messages must not rename the chat');
await api.saveChatSessions([{ id: 'manual-test', title: 'Chat 2', createdAt: 1, updatedAt: 1 }]);
let release;
globalThis.fetch = async () => { await new Promise(resolve => { release = resolve; }); return { ok: true, json: async () => ({ choices: [{ message: { content: 'Comment On Mufeez YouTube Video' } }] }) }; };
const pending = api.suggestSessionTitle('manual-test', 'prompt', settings, () => {});
while (!release) await new Promise(resolve => setTimeout(resolve, 1));
await api.renameChatSession('manual-test', 'My Manual Name'); release(); await pending;
assert.equal((await api.loadChatSessions())[0].title, 'My Manual Name');
globalThis.fetch = async () => ({ ok: false, status: 429 });
assert.equal(await api.generateModelSessionTitle('prompt', settings), null);

await api.saveChatSessions([{ id: 'retry-test', title: 'Chat 3', createdAt: 1, updatedAt: 1 }]);
const originalNow = Date.now;
let clock = originalNow(), retryCalls = 0;
Date.now = () => clock;
globalThis.fetch = async () => {
  retryCalls++;
  return retryCalls === 1 ? { ok: false, status: 429 } : { ok: true, json: async () => ({ choices: [{ message: { content: 'Find Remote Engineering Jobs' } }] }) };
};
try {
  await api.suggestSessionTitle('retry-test', 'Find remote engineering jobs', settings, () => {});
  await api.suggestSessionTitle('retry-test', 'Find remote engineering jobs', settings, () => {});
  assert.equal(retryCalls, 1, 'Streaming updates must not hammer a failing API');
  clock += 30001;
  await api.suggestSessionTitle('retry-test', 'Find remote engineering jobs', settings, () => {});
  assert.equal(retryCalls, 2, 'A failed title request must be retryable');
  assert.equal((await api.loadChatSessions())[0].title, 'Find Remote Engineering Jobs');
} finally { Date.now = originalNow; }

const compatibilityPayloads = [];
globalThis.fetch = async (_url, options) => {
  compatibilityPayloads.push(JSON.parse(options.body));
  return compatibilityPayloads.length === 1
    ? { ok: false, status: 400, text: async () => 'Unsupported reasoning_effort' }
    : { ok: true, json: async () => ({ choices: [{ message: { content: 'Find Remote Engineering Jobs' } }] }) };
};
assert.equal(await api.generateModelSessionTitle('Find remote engineering jobs', settings), 'Find Remote Engineering Jobs');
assert.equal(compatibilityPayloads.length, 2);
assert.equal(compatibilityPayloads[1].reasoning_effort, undefined);
console.log('PASS semantic titles, formatting normalization, request coalescing, first-prompt naming, manual rename preservation, failed-request recovery and provider compatibility');
