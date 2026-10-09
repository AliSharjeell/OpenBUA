import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transform } from 'esbuild';
const { chromium } = await import(process.env.OPENBUA_PLAYWRIGHT_MODULE || 'playwright');
const source = readFileSync('src/agent/browser-bridge.ts', 'utf8');
const snippet = source.slice(source.indexOf('function inPageFillForm('), source.indexOf('function inPageClickElement('));
const { code } = await transform(snippet, { loader: 'ts', target: 'es2022' });
const browser = await chromium.launch({ headless: true, ...(process.env.OPENBUA_CHROME_PATH ? { executablePath: process.env.OPENBUA_CHROME_PATH } : {}) });
try {
  const page = await browser.newPage();
  await page.setContent('<reply-box></reply-box>');
  await page.evaluate('(() => {\n' + code + '\nwindow.inPageFillForm = inPageFillForm;\n})()');
  await page.evaluate(() => {
    document.querySelector('reply-box').attachShadow({ mode: 'open' }).innerHTML = '<div contenteditable="true" data-autoform-ref="reply">Old duplicated reply. Old duplicated reply.</div>';
  });
  const fill = () => page.evaluate(() => inPageFillForm([{ refId: 'reply', value: 'How do you keep the data fresh?' }]));
  let result = await fill();
  assert.equal(result.successCount, 1);
  result = await fill();
  assert.equal(result.successCount, 1);
  assert.equal(result.verifications[0].actualValue, 'How do you keep the data fresh?', 'second fill replaces instead of duplicating');
  // A controlled editor that refuses deletion must never receive another copy.
  await page.evaluate(() => {
    const editor = document.querySelector('reply-box').shadowRoot.querySelector('div');
    editor.textContent = 'Original reply';
    const original = document.execCommand.bind(document);
    document.execCommand = (command, ...args) => command === 'delete' ? false : original(command, ...args);
  });
  result = await fill();
  assert.equal(result.successCount, 0);
  assert.match(result.errors.join(' '), /did not clear/);
  assert.equal(await page.evaluate(() => document.querySelector('reply-box').shadowRoot.querySelector('div').textContent), 'Original reply');
  await page.goto('http://127.0.0.1:5173/test-form.html');
  const limited = await page.evaluate(async () => {
    window.chrome = { tabs: { query: (_q, cb) => cb([{ id: 7, url: 'https://www.reddit.com/r/test/comments/example/thread/' }]) }, scripting: { executeScript: async injection => [{ result: await new Function('return (' + injection.func.toString() + ')')()(...(injection.args || [])) }] } };
    document.body.innerHTML = '<div role="alert">Rate limit exceeded. Please wait 9 minutes and try again</div><button>Comment</button>';
    window.clicks = 0;
    document.querySelector('button').onclick = () => window.clicks++;
    const { clickElementTool } = await import('/src/agent/tools.ts');
    return { result: await clickElementTool.execute('comment', { text: 'Comment' }), clicks: window.clicks };
  });
  assert.equal(limited.result.details.state, 'rate_limited');
  assert.equal(limited.result.details.retryAfterSeconds, 540);
  assert.equal(limited.clicks, 0, 'a visible comment cooldown prevents further submission clicks');
  console.log('PASS shadow reply replacement, exact verification, repeated fill and failed-clear no-append behavior');
} finally { await browser.close(); }
