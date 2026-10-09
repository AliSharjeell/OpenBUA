import assert from 'node:assert/strict';
import { build } from 'esbuild';
const load = async file => {
  const result = await build({ entryPoints: [file], bundle: true, write: false, format: 'esm', platform: 'node' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
};
const stores = { local: {}, session: {} };
const listeners = [], closed = [], tabsClosed = [];
const windows = new Map([[1, { id: 1 }], [2, { id: 2 }]]);
let nextWindow = 3, nextTab = 10;
const tabs = new Map([[1, { id: 1, windowId: 1 }], [2, { id: 2, windowId: 2 }]]);
const storage = area => ({
  get: async key => structuredClone({ [key]: stores[area][key] }),
  set: async data => { Object.assign(stores[area], structuredClone(data)); },
});
globalThis.chrome = {
  storage: { local: storage('local'), session: storage('session') },
  runtime: { id: 'test', getURL: path => `chrome-extension://test/${path}`, onMessage: { addListener: fn => listeners.push(fn) } },
  windows: { get: async id => { if (!windows.has(id)) throw Error('closed'); return windows.get(id); }, getCurrent: async () => windows.get(1),
    create: async options => { assert.equal(options.focused, false); const win = { id: nextWindow++ }; windows.set(win.id, win); return win; },
    onRemoved: { addListener: fn => closed.push(fn) } },
  tabs: { get: async id => tabs.get(id), onRemoved: { addListener: fn => tabsClosed.push(fn) }, create: async options => { assert.equal(options.active, false); const tab = { ...options, id: nextTab++ }; tabs.set(tab.id, tab); return tab; }, update: async id => tabs.get(id) },
};
const { installWindowCoordinator } = await load('src/background/window-coordinator.ts');
installWindowCoordinator();
const sender = { id: 'test', url: 'chrome-extension://test/sidepanel.html' };
const request = (message, source = sender) => new Promise(resolve => listeners[0](message, source, resolve));
const rpc = async message => { const response = await request(message); if (response.error) throw Error(response.error); return response.value; };
chrome.runtime.sendMessage = rpcMessage => request(rpcMessage);

const results = await Promise.all(Array.from({ length: 15 }, () => rpc({ type: 'OPENBUA_WINDOWS_SESSIONS', action: 'create' })));
assert.equal(new Set(results.map(value => value.created.id)).size, 15);
assert.equal(stores.local.autoform_chat_sessions.length, 15);
await Promise.all(results.map((value, i) => rpc({ type: 'OPENBUA_WINDOWS_SESSIONS', action: 'rename', sessionId: value.created.id, title: `Task ${i}` })));
assert.equal(stores.local.autoform_chat_sessions.filter(s => s.title.startsWith('Task ')).length, 15);
assert.equal(await rpc({ type: 'OPENBUA_WINDOWS_CLAIM', windowId: 1, sessionId: 'chat' }), true);
assert.equal(await rpc({ type: 'OPENBUA_WINDOWS_CLAIM', windowId: 2, sessionId: 'chat' }), false);
await assert.rejects(rpc({ type: 'OPENBUA_WINDOWS_SESSIONS', action: 'delete', sessionId: 'chat', windowId: 2 }), /another Chrome window/);
windows.delete(1);
assert.equal(await rpc({ type: 'OPENBUA_WINDOWS_CLAIM', windowId: 2, sessionId: 'chat' }), true);
windows.set(1, { id: 1 });
assert.match((await request({ type: 'OPENBUA_WINDOWS_START' }, { id: 'test', url: 'https://evil.example' })).error, /Only OpenBUA/);

const context = await load('src/agent/window-context.ts');
globalThis.location = { href: 'chrome-extension://test/sidepanel.html?ownerWindowId=2' };
await context.initializeBrowserWindow();
assert.equal(context.getBrowserWindowId(), 2);
await assert.rejects(context.assertOwnedTab(1), /another OpenBUA window/);
await context.assertOwnedTab(2);

const base = { ownerWindowId: 1, sessionId: 'parent', authorization: ['Research only'], settings: { free: { apiKey: 'test-secret' } }, documents: [{ id: 'resume' }] };
const start = tasks => rpc({ type: 'OPENBUA_WINDOWS_START', ...base, tasks });
await assert.rejects(start([{ instruction: 'bad', url: 'chrome://settings' }]), /HTTP/);
const beforeInvalidBatch = windows.size;
await assert.rejects(start([{ instruction: 'valid', url: 'https://a.example' }, { instruction: 'bad', url: 'file:///private' }]), /HTTP/);
assert.equal(windows.size, beforeInvalidBatch, 'Invalid batch must not leave a partial worker running');
const workers = await start([{ instruction: 'Research A', url: 'https://a.example' }, { instruction: 'Research B', url: 'https://b.example' }]);
assert.equal(workers.length, 2);
assert.notEqual(workers[0].windowId, workers[1].windowId);
await assert.rejects(start([{ instruction: 'C' }, { instruction: 'D' }]), /At most 3/);
assert.equal((await rpc({ type: 'OPENBUA_WINDOWS_STATUS', ...base, sessionId: 'other' })).length, 0);
const workerSender = { id: 'test', url: `chrome-extension://test/worker.html?job=${workers[0].id}`, tab: { windowId: workers[0].windowId } };
assert.match((await request({ type: 'OPENBUA_WINDOWS_START', ...base, tasks: [{ instruction: 'recursive' }] }, workerSender)).error, /cannot spawn/);
assert.match((await request({ type: 'OPENBUA_WINDOWS_WORKER_UPDATE', state: 'completed' }, { ...workerSender, tab: { windowId: 2 } })).error, /ownership/);
await request({ type: 'OPENBUA_WINDOWS_WORKER_UPDATE', state: 'running' }, workerSender);
await request({ type: 'OPENBUA_WINDOWS_WORKER_UPDATE', state: 'completed', result: 'Verified A' }, workerSender);
const status = await rpc({ type: 'OPENBUA_WINDOWS_STATUS', ...base });
assert.equal(status[0].result, 'Verified A');
await rpc({ type: 'OPENBUA_WINDOWS_CANCEL', ...base });
const cancelled = await rpc({ type: 'OPENBUA_WINDOWS_STATUS', ...base });
assert.equal(cancelled[0].state, 'completed');
assert.equal(cancelled[1].state, 'cancelled');
const secondSender = { ...workerSender, url: `chrome-extension://test/worker.html?job=${workers[1].id}`, tab: { windowId: workers[1].windowId } };
const late = await request({ type: 'OPENBUA_WINDOWS_WORKER_UPDATE', state: 'completed', result: 'Late success' }, secondSender);
assert.equal(late.value.state, 'cancelled');
const more = await start([{ instruction: 'Close test' }]);
windows.delete(more[0].windowId); closed[0](more[0].windowId);
assert.equal((await rpc({ type: 'OPENBUA_WINDOWS_STATUS', ...base })).find(job => job.id === more[0].id).state, 'failed');
const tabClose = await start([{ instruction: 'Close control tab' }]);
tabsClosed[0](stores.local.openbua_parallel_jobs[tabClose[0].id].workerTabId);
assert.equal((await rpc({ type: 'OPENBUA_WINDOWS_STATUS', ...base })).find(job => job.id === tabClose[0].id).state, 'cancelled');
console.log('Window isolation, concurrent chat mutations, ownership, worker limits, cancellation and closed-window checks passed.');
