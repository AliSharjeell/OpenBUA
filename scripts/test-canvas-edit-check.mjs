import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const compiled = await build({
  entryPoints: [fileURLToPath(new URL('../src/agent/canvas-edit-check.ts', import.meta.url))],
  bundle: false, write: false, format: 'esm', target: 'es2020', logLevel: 'silent',
});
const source = compiled.outputFiles[0].text;
const serialized = source.slice(source.indexOf('function inspectCanvasInsertion('), source.indexOf('async function checkCanvasTextInsertion(')).trim();
let style = 'Title', bold = true, context = 'Termote — Rust-Based Agentic Development Environment';
let isDocs = true;
const document = {
  querySelector(selector) {
    if (selector.startsWith('.kix-appview')) return isDocs ? {} : null;
    if (selector.startsWith('#headingStyleSelect')) return { textContent: style, querySelector: () => ({ textContent: style }) };
    if (selector === '#boldButton') return { getAttribute: () => String(bold) };
    return null;
  },
  querySelectorAll: () => [{ className: 'docs-texteventtarget-iframe', id: '', contentWindow: { getSelection: () => ({ toString: () => context }) } }],
};
// Rebuild the serialized function as Chrome does; no module helpers are available.
const check = runInNewContext(`(${serialized})`, { document, window: { getSelection: () => ({ toString: () => '' }) } });
assert.equal(check('Project\nTechnologies: Rust\nBuilt an app').allowed, false, 'mixed block cannot inherit title style');
assert.equal(check('Replacement title', 'Termote').allowed, true, 'single-line title replacement remains possible');
context = 'Designed a session-managed agent loop in ArmUP';
assert.equal(check('Replacement title', 'Termote').allowed, false, 'experience context cannot masquerade as project heading');
assert.equal(check('Title\nTitle', 'Termote', true).allowed, false, 'format override cannot bypass caret mismatch');
context = 'Termote';
assert.equal(check('Title\nTitle', 'Termote', true).allowed, true, 'explicit intentional uniform headings supported');
style = 'Normal text'; bold = false;
assert.equal(check('Body\nBody', 'Termote').allowed, true, 'normal body paragraphs supported');
bold = true;
assert.equal(check('Body\nBody').allowed, false, 'all-bold body insertion is blocked');
style = 'Heading 3'; bold = false;
assert.equal(check('Body\nBody').allowed, false, 'heading-style body insertion is blocked');
context = '';
assert.equal(check('Title', 'Termote').allowed, true, 'missing selection does not falsely claim a different caret location');
isDocs = false;
assert.equal(check('Text\nText').allowed, true, 'ordinary editors are unaffected');
console.log('PASS serialized canvas formatting and caret-context guard');

// Exercise the exported wrapper too: Chrome rejects undefined injection args.
const wrapper = source.slice(source.indexOf('async function checkCanvasTextInsertion('), source.indexOf('\nexport {'));
let injected;
const checkWrapper = runInNewContext(`(${wrapper.trim()})`, {
  getActiveTab: async () => ({ id: 7, url: 'https://docs.google.com/document/d/test/edit' }),
  inspectCanvasInsertion: check,
  chrome: { scripting: { executeScript: async (request) => {
    injected = request;
    assert.ok(request.args.every(arg => arg !== undefined), 'injection arguments must be serializable');
    return [{ result: { allowed: true } }];
  } } },
});
await checkWrapper('abc');
assert.equal(injected.args[1], '');
assert.equal(injected.args[2], false);
await checkWrapper('abc', 'Termote', true);
assert.equal(injected.args[1], 'Termote');
assert.equal(injected.args[2], true);
console.log('PASS omitted and explicit Docs injection arguments');
