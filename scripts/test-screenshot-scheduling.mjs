import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { writeFileSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const path = resolve('.tmp-screenshot-test.mjs');
const output = await build({ stdin: { contents: 'export { captureScheduled } from "./src/agent/screenshot-capture.ts"; export { captureTabScreenshot } from "./src/agent/browser-bridge.ts"; export { captureTabScreenshotTool } from "./src/agent/tools.ts";', resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'node', external: ['@earendil-works/*','pdfjs-dist'], logLevel: 'silent',
  plugins: [{ name: 'worker-url', setup(builder) {
    builder.onResolve({ filter: /pdf\.worker\.min\.mjs\?url$/ }, () => ({ path: 'worker', namespace: 'worker-url' }));
    builder.onLoad({ filter: /.*/, namespace: 'worker-url' }, () => ({ contents: 'export default "";' }));
  } }],
});
writeFileSync(path, output.outputFiles[0].text);
const previous = globalThis.chrome;
try {
  const { captureScheduled, captureTabScreenshot, captureTabScreenshotTool } = await import(pathToFileURL(path).href);
  const calls = []; let failures = 0;
  globalThis.chrome = { runtime: {}, tabs: {
    query(_q, callback) { callback([{ id: 7, windowId: 9, url: 'https://reddit.com/r/test/submit' }]); },
    captureVisibleTab(windowId, _options, callback) {
      assert.equal(windowId, 9, 'do not fall back to another window'); calls.push(Date.now());
      if (failures-- > 0) { chrome.runtime.lastError = { message: 'MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota' }; callback(); delete chrome.runtime.lastError; }
      else callback('data:image/jpeg;base64,aW1hZ2U=');
    },
  } };
  await Promise.all([captureScheduled(9), captureScheduled(9), captureScheduled(9)]);
  for (let i = 1; i < calls.length; i++) assert.ok(calls[i] - calls[i-1] >= 600, 'parallel captures respect Chrome quota');
  failures = 1; const before = calls.length;
  await captureScheduled(9); assert.equal(calls.length - before, 2, 'quota error gets one paced retry');
  chrome.runtime.sendMessage = (_message, callback) => callback({ success: false, error: 'worker capture unavailable' });
  const routedBefore = calls.length;
  await assert.rejects(captureTabScreenshot(), /worker capture unavailable/);
  assert.equal(calls.length, routedBefore, 'worker error never triggers a duplicate direct capture');
  delete chrome.runtime.sendMessage;
  failures = 10; const permanentBefore = calls.length;
  await assert.rejects(captureScheduled(9), /do not loop/);
  assert.equal(calls.length - permanentBefore, 2, 'permanent quota failure is bounded');
  const result = await captureTabScreenshotTool.execute('screenshot', {});
  assert.equal(result.details.success, false); assert.equal(result.details.recovery, 'inspect-dom');
  assert.equal(calls.length - permanentBefore, 2, 'circuit prevents screenshot retry loops');
  console.log('PASS screenshot serialization, paced quota retry, no alternate-window fallback, worker failure propagation and bounded recovery');
} finally { globalThis.chrome = previous; rmSync(path, { force: true }); }
