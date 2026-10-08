import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.OPENBUA_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.OPENBUA_CHROME_PATH ? { executablePath: process.env.OPENBUA_CHROME_PATH } : {}) });
const page = await browser.newPage();
try {
  await page.goto('http://127.0.0.1:5173/test-form.html');
  await page.evaluate(() => {
    window.chrome = {
      runtime: { lastError: null, onMessage: { addListener(listener) { window.testListener = listener; } } },
      tabs: { query(_q, cb) { cb([{ id: 7 }]); }, sendMessage(_id, message, cb) { window.testListener(message, {}, cb); } },
      scripting: { executeScript: async injection => [{ frameId: 0, result: await (new Function(`return (${injection.func.toString()})`))()(...(injection.args || [])) }] },
    };
  });
  await page.addScriptTag({ path: fileURLToPath(new URL('../dist/content.js', import.meta.url)) });
  await page.setContent('<form><div id="q1"><p>Q1: How soon can you start?</p><div><input id="start" type="number" aria-label="First name"></div></div><div id="q2"><p>Q2: Expected hourly rate?</p><div><input id="rate" type="number" aria-label="First name"></div></div><div id="q3"><p>Q3: Available hours per week?</p><div><input id="hours" type="number" aria-label="First name"></div></div><button>Next</button></form>');
  const inspect = () => page.evaluate(async () => {
    const { getActiveTabFormTool } = await import('/src/agent/tools.ts');
    return (await getActiveTabFormTool.execute('inspect', {})).details;
  });
  const initial = await inspect();
  for (const [id, prefix] of [['start', 'Q1'], ['rate', 'Q2'], ['hours', 'Q3']]) {
    assert.ok(initial.fields.find(field => field.id === id).label.startsWith(prefix), 'actual screening question overrides a copied aria-label');
  }
  await page.evaluate(() => {
    const form = document.querySelector('form');
    form.prepend(document.getElementById('q3'));
    const input = document.createElement('input'); input.id = 'new'; form.prepend(input);
    document.getElementById('start').style.display = 'none';
  });
  const reordered = await inspect();
  for (const field of initial.fields) {
    const ref = await page.evaluate(id => document.getElementById(id).getAttribute('data-autoform-ref'), field.id);
    assert.equal(ref, field.refId, 'reordering/hiding/inserting does not rename existing controls');
  }
  assert.equal(new Set(reordered.fields.map(field => field.refId)).size, reordered.fields.length);
  await page.evaluate(() => { document.getElementById('start').style.display = ''; window.chrome.tabs.sendMessage = (_id, _message, cb) => cb(undefined); });
  const fallback = await inspect();
  for (const field of reordered.fields) {
    const next = fallback.fields.find(next => next.id === field.id);
    assert.equal(next.refId, field.refId, 'serialized fallback shares DOM identities');
    assert.equal(next.label, field.label, 'serialized fallback identifies the same question');
  }
  console.log('PASS stable form references and screening labels across reordering, inserted/hidden inputs, and transport fallback');
} finally { await browser.close(); }
