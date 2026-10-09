import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
const { chromium } = await import(process.env.OPENBUA_PLAYWRIGHT_MODULE || 'playwright');
let rootCalls = 0;
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Headers', '*'); res.end(); return; }
  if (req.url.startsWith('/fixture')) {
    res.setHeader('Content-Type', 'text/html');
    res.end('<title>Independent task form</title><label for="task-value">Task value</label><input id="task-value"><button>Save</button>'); return;
  }
  let raw = ''; for await (const chunk of req) raw += chunk;
  if (!raw) { res.end(); return; }
  const body = JSON.parse(raw);
  if (!body.stream) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: 'Parallel Browser Form Test' } }] })); return; }
  const user = body.messages.filter(m => m.role === 'user').map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n');
  const isWorker = user.includes('You are a worker assigned ONLY');
  const toolMessages = body.messages.filter(m => m.role === 'tool');
  let delta;
  const call = (name, args) => ({ tool_calls: [{ index: 0, id: `call_${Math.random()}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
  if (user.includes('Fill Manual in this window')) {
    assert(!body.tools.some(tool => tool.function.name === 'start_parallel_tasks'), 'Delegation must stay unavailable when the toggle is off');
    delta = toolMessages.length ? { content: 'Manual window task complete.' } : call('fill_form_fields', { assignments: [{ selector: '#task-value', value: 'Manual' }] });
  } else if (isWorker) {
    const value = user.includes('Fill Alpha') ? 'Alpha' : 'Beta';
    if (!toolMessages.length) delta = call('fill_form_fields', { assignments: [{ selector: '#task-value', value }] });
    else delta = { content: `Completed ${value} in its own window.` };
  } else {
    rootCalls++;
    if (!toolMessages.length) {
      assert(body.tools.some(tool => tool.function.name === 'start_parallel_tasks'));
      delta = call('start_parallel_tasks', { tasks: [{ instruction: 'Fill Alpha in the task value input.', url: `${origin}/fixture?alpha` }, { instruction: 'Fill Beta in the task value input.', url: `${origin}/fixture?beta` }] });
    } else if (toolMessages.at(-1).content.includes('"state":"completed"') && !/"state":"(?:starting|running)"/.test(toolMessages.at(-1).content)) delta = { content: 'Both independent forms are complete.' };
    else delta = call('parallel_task_status', { waitSeconds: 15 });
  }
  res.setHeader('Content-Type', 'text/event-stream');
  res.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', ...delta }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: delta.tool_calls ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const extensionPath = path.resolve('dist');
const context = await chromium.launchPersistentContext('', {
  headless: true,
  ...(process.env.OPENBUA_EXTENSION_CHROME_PATH ? { executablePath: process.env.OPENBUA_EXTENSION_CHROME_PATH } : {}),
  ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
});
try {
  const background = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionOrigin = new URL(background.url()).origin;
  await background.evaluate(async origin => {
    await chrome.storage.local.set({ autoform_settings: { selectedMode: 'free', activeProvider: 'openai', free: { apiKey: 'test-key', model: 'test-model', baseUrl: `${origin}/v1` }, autoConfirmSubmit: true } });
  }, origin);
  // Subscribe before creation to avoid missing the popup event.
  const firstEvent = context.waitForEvent('page');
  const firstInfo = await background.evaluate(async origin => {
    const win = await chrome.windows.create({ url: `${origin}/fixture?parent`, focused: false });
    await chrome.windows.create({ type: 'popup', url: chrome.runtime.getURL(`sidepanel.html?ownerWindowId=${win.id}`), focused: false, width: 440, height: 850 });
    return win.id;
  }, origin);
  await firstEvent;
  const panel = await (async () => { for (let i = 0; i < 100; i++) { const page = context.pages().find(p => p.url().includes(`ownerWindowId=${firstInfo}`)); if (page) return page; await new Promise(r => setTimeout(r, 50)); } throw Error('Panel not created'); })();
  await panel.waitForFunction(() => document.querySelector('textarea') && !document.querySelector('textarea').disabled);
  const toggle = panel.getByRole('button', { name: 'Parallel subagent Chrome windows', exact: true });
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
  assert.match(await toggle.getAttribute('title'), /up to 3 separate Chrome windows/);
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
  const secondWindow = await background.evaluate(async origin => (await chrome.windows.create({ url: `${origin}/fixture?manual-other`, focused: true })).id, origin);
  await panel.getByPlaceholder('Ask OpenBUA ? @ to reference files').fill('Fill two independent task forms in parallel.');
  await panel.getByTitle('Send (Enter)', { exact: true }).click();
  await panel.getByText('Both independent forms are complete.', { exact: true }).waitFor({ timeout: 60000 });
  const jobs = await background.evaluate(async () => Object.values((await chrome.storage.local.get('openbua_parallel_jobs')).openbua_parallel_jobs || {}));
  assert.equal(jobs.length, 2);
  assert(jobs.every(job => job.state === 'completed'), JSON.stringify(jobs));
  assert(jobs.every(job => job.settings === undefined));
  for (const job of jobs) {
    const page = context.pages().find(p => p.url() === job.task.url);
    assert(page, 'Worker website exists');
    assert.equal(await page.locator('#task-value').inputValue(), job.task.instruction.includes('Alpha') ? 'Alpha' : 'Beta');
  }
  const untouched = context.pages().find(p => p.url() === `${origin}/fixture?manual-other`);
  assert.equal(await untouched.locator('#task-value').inputValue(), '');
  await background.evaluate(async windowId => {
    await chrome.windows.create({ type: 'popup', url: chrome.runtime.getURL(`sidepanel.html?ownerWindowId=${windowId}`), focused: false, width: 440, height: 850 });
  }, secondWindow);
  const manualPanel = await (async () => { for (let i = 0; i < 100; i++) { const page = context.pages().find(p => p.url().includes(`ownerWindowId=${secondWindow}`)); if (page) return page; await new Promise(r => setTimeout(r, 50)); } throw Error('Manual panel not created'); })();
  await manualPanel.waitForFunction(() => document.querySelector('textarea') && !document.querySelector('textarea').disabled);
  assert.equal(await manualPanel.getByRole('button', { name: 'Parallel subagent Chrome windows', exact: true }).getAttribute('aria-pressed'), 'false');
  await manualPanel.getByPlaceholder('Ask OpenBUA ? @ to reference files').fill('Fill Manual in this window');
  await manualPanel.getByTitle('Send (Enter)', { exact: true }).click();
  await manualPanel.getByText('Manual window task complete.', { exact: true }).waitFor();
  assert.equal(await untouched.locator('#task-value').inputValue(), 'Manual');
  const state = await background.evaluate(async () => (await chrome.storage.local.get(null)));
  assert.notEqual(state[`openbua_last_active_session_id_window_${firstInfo}`], state[`openbua_last_active_session_id_window_${secondWindow}`]);
  assert.notEqual(secondWindow, firstInfo);
  assert(rootCalls >= 3);
  console.log('Real extension: independent manual instances, default-off toggle, worker Chrome windows, scoped form writes and parent result collection passed.');
} finally { await context.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
