import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.OPENBUA_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.OPENBUA_CHROME_PATH ? { executablePath: process.env.OPENBUA_CHROME_PATH } : {}) });
const page = await browser.newPage();
try {
  await page.goto('http://127.0.0.1:5173/test-form.html');
  await page.evaluate(() => {
    window.chrome = { runtime: { lastError: null, onMessage: { addListener(listener) { window.listener = listener; } } }, tabs: {
      query(_q, cb) { cb([{ id: 7, url: 'https://www.reddit.com/r/test/submit/' }]); },
      sendMessage(_id, message, cb) { window.listener(message, {}, cb); },
    }, scripting: { executeScript: async injection => [{ result: await new Function(`return (${injection.func.toString()})`)()(...(injection.args || [])) }] } };
  });
  await page.addScriptTag({ path: fileURLToPath(new URL('../dist/content.js', import.meta.url)) });
  await page.setContent('<form><div hidden role="dialog"><h2>Before you start, you’ll need</h2></div><div contenteditable="true" name="body" aria-label="Post body text field"></div><reddit-composer></reddit-composer></form>');
  await page.evaluate(() => {
    const root = document.querySelector('reddit-composer').attachShadow({ mode: 'open' });
    root.innerHTML = '<h1>Submit to Community</h1><label>Title<textarea id="title" name="title" aria-label="Post title" required></textarea></label><nested-actions></nested-actions>';
    const inner = root.querySelector('nested-actions').attachShadow({ mode: 'open' });
    inner.innerHTML = '<button type="button">Post</button>';
    window.postClicks = 0; inner.querySelector('button').onclick = () => window.postClicks++;
  });
  const inspect = () => page.evaluate(async () => {
    const { getActiveTabFormTool } = await import('/src/agent/tools.ts'); return (await getActiveTabFormTool.execute('inspect', {})).details;
  });
  const first = await inspect();
  const title = first.fields.find(field => field.name === 'title'); assert.ok(title, 'title inside shadow DOM is inspected');
  assert.ok(first.buttons.some(button => button.text === 'Post'), 'nested shadow submit control is inspected');
  assert.equal(first.fields.find(field => field.name === 'body').sectionHint, '', 'hidden modal heading cannot masquerade as a blocker');
  const second = await inspect(); assert.equal(second.fields.find(field => field.name === 'title').refId, title.refId, 'shadow references remain stable');
  const filled = await page.evaluate(async refId => {
    const { fillFormFieldsTool } = await import('/src/agent/tools.ts'); return fillFormFieldsTool.execute('fill', { assignments: [{ refId, value: 'OpenBUA feedback request' }] });
  }, title.refId);
  assert.equal(filled.details.successCount, 1);
  const text = await page.evaluate(async () => {
    const { getPageContentTool } = await import('/src/agent/tools.ts'); return (await getPageContentTool.execute('content', {})).details.text;
  });
  assert.match(text, /Visible Shadow DOM Content/); assert.match(text, /Submit to Community/);
  await page.evaluate(() => { chrome.tabs.sendMessage = (_id, _message, callback) => callback(undefined); });
  const fallback = await inspect(); assert.equal(fallback.fields.find(field => field.name === 'title').refId, title.refId);
  assert.equal(fallback.fields.find(field => field.name === 'title').value, 'OpenBUA feedback request');
  const clicked = await page.evaluate(async () => {
    const { clickElementTool } = await import('/src/agent/tools.ts'); return clickElementTool.execute('post', { text: 'Post' });
  });
  assert.equal(clicked.details.success, true); assert.equal(await page.evaluate(() => window.postClicks), 1, 'serialized click finds nested shadow button exactly once');
  console.log('PASS shadow composer title/body/buttons, stable references, verified fill, visible page text, hidden-heading exclusion and serialized fallback');
} finally { await browser.close(); }
