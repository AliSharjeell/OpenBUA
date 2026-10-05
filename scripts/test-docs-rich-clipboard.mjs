import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';

const compiled = await build({ entryPoints: ['src/agent/docs-rich-clipboard.ts'], bundle: false, write: false, format: 'esm', target: 'es2020' });
const source = compiled.outputFiles[0].text;
const readSource = source.slice(source.indexOf('async function readDocsClipboard('), source.indexOf('function dispatchDocsRichPaste(')).trim();
const pasteSource = source.slice(source.indexOf('function dispatchDocsRichPaste('), source.indexOf('\nexport {')).trim();
let clipboardText = 'Termote\nTechnologies: Rust\nBuilt an app\n', clipboardHtml = '<h3>Termote</h3><p><b>Technologies:</b> Rust</p><ul><li>Built an app</li></ul>';
const read = runInNewContext(`(${readSource})`, { navigator: { clipboard: { read: async () => [{ types: ['text/plain', 'text/html'], getType: async type => new Blob([type === 'text/plain' ? clipboardText : clipboardHtml]) }] } } });
assert.equal((await read(clipboardText)).success, true, 'actual clipboard text and HTML are verified');
assert.equal((await read('Different source')).success, false, 'stale clipboard cannot masquerade as the source');
assert.equal((await read('\u00a0')).success, false, 'placeholder selection cannot verify copy');
clipboardHtml = '';
assert.equal((await read(clipboardText)).success, false, 'plain-text-only copy cannot claim preserved formatting');
let selected = '', consumes = true, sent = 0, event;
class DataTransfer { constructor() { this.data = {}; } setData(type, value) { this.data[type] = value; } }
class ClipboardEvent { constructor(type, init) { this.type = type; Object.assign(this, init); this.defaultPrevented = false; } preventDefault() { this.defaultPrevented = true; } }
const target = { isContentEditable: true, dispatchEvent(value) { sent++; event = value; if (consumes) value.preventDefault(); } };
const view = { DataTransfer, ClipboardEvent, getSelection: () => ({ isCollapsed: !selected, toString: () => selected }) };
const doc = { activeElement: target, defaultView: view };
const paste = runInNewContext(`(${pasteSource})`, { document: { querySelectorAll: () => [{ id: 'docs-texteventtarget-iframe', className: '', contentDocument: doc }] } });
selected = 'Entire original project';
assert.equal(paste('Project', '<b>Project</b>').dispatched, false, 'paste cannot overwrite a still-selected original');
assert.equal(sent, 0);
selected = '';
const pasted = paste('Project', '<b>Project</b>');
assert.equal(pasted.dispatched, true);
assert.equal(pasted.handlerConsumed, true);
assert.equal(pasted.documentVerified, false, 'handler acceptance is not visual duplicate confirmation');
assert.equal(event.clipboardData.data['text/html'], '<b>Project</b>', 'rich formatting reaches the editor handler');
assert.equal(event.clipboardData.data['text/plain'], 'Project');
consumes = false;
assert.equal(paste('Project', '<b>Project</b>').handlerConsumed, false, 'unhandled paste is reported');
assert.equal(paste('Project', '').dispatched, false);
console.log('PASS verified rich copy, stale/empty clipboard rejection, collapsed caret and editor paste handler routing');
