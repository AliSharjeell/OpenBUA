import assert from 'node:assert/strict';
import { build } from 'esbuild';

const compiled = await build({
  entryPoints: ['src/agent/docs-edit-safety.ts'], bundle: true, write: false, format: 'esm', platform: 'node',
  plugins: [{ name: 'stub-active-tab', setup(builder) {
    builder.onResolve({ filter: /browser-bridge$/ }, () => ({ path: 'bridge', namespace: 'mock' }));
    builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'export async function getActiveTab() { return globalThis.__docsSafetyTab; }' }));
  } }],
});
const { protectDocsEdits } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
globalThis.__docsSafetyTab = { id: 1, url: 'https://docs.google.com/document/d/test/edit' };
const calls = [];
const policy = { cloneRequired: false, taskEpoch: 0 };
const names = ['type_text', 'press_key_combination', 'click_at_position', 'capture_tab_screenshot', 'docs_clipboard', 'select_docs_text', 'clipboard_action'];
const tools = protectDocsEdits(names.map(name => ({ name, execute: async (_id, params) => {
  calls.push({ name, params });
  if (name === 'capture_tab_screenshot' || name === 'select_docs_text') return { content: [{ type: 'image', mimeType: 'image/png', data: 'test' }], details: {} };
  if (name === 'docs_clipboard') return { content: [{ type: 'image', mimeType: 'image/png', data: 'test' }], details: { action: { commandAccepted: true } } };
  return { content: [{ type: 'text', text: 'Verified against the document text' }], details: { success: true, verified: true } };
} })), policy);
const run = (name, params = {}) => tools.find(tool => tool.name === name).execute('test', params);
assert.equal((await run('type_text', { text: 'title' })).details.blocked, true, 'cannot type before inspecting location');
await run('capture_tab_screenshot');
await run('click_at_position', { x: 10, y: 20 });
assert.equal((await run('press_key_combination', { key: 'Delete' })).details.blocked, true, 'deleting at an unchecked selection is blocked');
assert.equal((await run('docs_clipboard', { action: 'copy' })).details.blocked, true, 'copying an unchecked range is blocked');
assert.equal((await run('clipboard_action', { action: 'copy' })).details.blocked, true, 'Docs shortcuts must use the browser command tool');
assert.equal((await run('press_key_combination', { key: 'd', ctrlKey: true })).details.blocked, true, 'Ctrl+D must not be treated as block duplication');
assert.equal((await run('type_text', { text: 'title' })).details.blocked, true, 'click invalidates the previous screenshot');
await run('capture_tab_screenshot');
const typed = await run('type_text', { text: 'title' });
assert.equal(typed.details.verified, false, 'pre-existing text must not confirm an insert');
assert.equal(typed.details.dispatched, true);
assert.equal((await run('press_key_combination', { key: 'z', ctrlKey: true })).details.blocked, true, 'cannot undo before post-edit inspection');
await run('capture_tab_screenshot');
const undoBefore = calls.filter(call => call.name === 'press_key_combination').length;
await Promise.all(Array.from({ length: 8 }, () => run('press_key_combination', { key: 'z', ctrlKey: true })));
assert.equal(calls.filter(call => call.name === 'press_key_combination').length - undoBefore, 1, 'batch can dispatch only one undo');
await run('capture_tab_screenshot');
assert.equal((await run('press_key_combination', { key: 'z', ctrlKey: true })).details.blocked, true, 'screenshots do not refill undo credit');
policy.cloneRequired = true; policy.taskEpoch++;
await run('capture_tab_screenshot');
assert.equal((await run('type_text', { text: 'new project' })).details.blocked, true, 'format matching requires source clone');
assert.equal((await run('docs_clipboard', { action: 'paste' })).details.blocked, true, 'unknown clipboard contents cannot unlock cloning');
await run('select_docs_text');
await run('docs_clipboard', { action: 'copy' });
await run('click_at_position', { x: 10, y: 20 });
assert.equal((await run('docs_clipboard', { action: 'paste' })).details.blocked, true, 'paste destination must be inspected');
await run('capture_tab_screenshot');
await run('docs_clipboard', { action: 'paste' });
assert.equal((await run('type_text', { text: 'new title' })).details.dispatched, true, 'clone text can be edited after observing paste');
policy.taskEpoch++;
await run('capture_tab_screenshot');
assert.equal((await run('type_text', { text: 'new title' })).details.blocked, true, 'new task does not inherit clone approval');
globalThis.__docsSafetyTab = { id: 2, url: 'https://example.com' };
assert.equal((await run('type_text', { text: 'ordinary input' })).details.verified, true, 'ordinary inputs are unchanged');
delete globalThis.__docsSafetyTab;
console.log('PASS Docs fresh placement, honest typing, bounded undo batches and formatting clone workflow');
