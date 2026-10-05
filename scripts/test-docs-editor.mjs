import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';

const compiled = await build({ entryPoints: ['src/agent/docs-editor.ts'], bundle: false, write: false, format: 'esm', target: 'es2020' });
const source = compiled.outputFiles[0].text;
function extract(name, next) {
  return source.slice(source.indexOf(`function ${name}(`), source.indexOf(next, source.indexOf(`function ${name}(`))).trim();
}
let state = 'true', clicks = 0, disabled = false, focused = true, accepted = true;
const button = {
  id: 'boldButton', textContent: '',
  getClientRects: () => [{}], getBoundingClientRect: () => ({ x: 10, y: 20, width: 30, height: 40 }),
  getAttribute: key => key === 'aria-pressed' ? state : key === 'aria-disabled' ? String(disabled) : key === 'aria-label' ? 'Bold' : null,
  querySelector: () => null,
  click: () => { clicks++; state = state === 'true' ? 'false' : 'true'; },
};
const editorDocument = {
  get activeElement() { return focused ? { isContentEditable: true } : { tagName: 'BODY' }; },
  execCommand: action => { assert.ok(['copy', 'paste', 'cut'].includes(action)); return accepted; },
};
const document = {
  getElementById: () => button,
  querySelectorAll: selector => selector === 'iframe' ? [{ id: 'docs-texteventtarget-iframe', className: '', contentDocument: editorDocument, contentWindow: { getSelection: () => ({ toString: () => 'Selected project' }) } }] : [button],
};
const globals = { document, window: { getSelection: () => ({ toString: () => '' }) }, devicePixelRatio: 2 };
const inspect = runInNewContext(`(${extract('inspectDocsEditor', 'function setDocsToggle')})`, globals);
const toggle = runInNewContext(`(${extract('setDocsToggle', 'async function runDocsInspection')})`, globals);
const clipboard = runInNewContext(`(${extract('commandDocsClipboard', 'async function runDocsClipboard')})`, globals);
let result = inspect();
assert.equal(result.controls[0].label, 'Bold');
assert.equal(result.controls[0].pressed, 'true');
assert.equal(result.controls[0].screenshotPosition.x, 50);
assert.equal(result.selectionText, 'Selected project');
assert.equal(toggle('boldButton', true).changed, false);
assert.equal(clicks, 0, 'already-correct formatting must not toggle');
assert.equal(toggle('boldButton', false).success, true);
assert.equal(clicks, 1);
state = null;
assert.equal(toggle('boldButton', false).success, false, 'unknown/mixed state must not toggle');
assert.equal(clicks, 1);
disabled = true;
assert.equal(toggle('boldButton', true).success, false);
assert.equal(toggle('untrusted-control', true).success, false);
assert.equal(clipboard('copy').commandAccepted, true);
assert.equal(clipboard('paste').placementVerified, false, 'acceptance must not claim placement');
accepted = false;
assert.equal(clipboard('paste').success, false);
focused = false;
assert.equal(clipboard('copy').success, false, 'toolbar focus must not copy unrelated text');
assert.equal(clipboard('duplicate').success, false);
console.log('PASS serialized Docs DOM inspection, idempotent formatting, clipboard rejection and focus guards');
