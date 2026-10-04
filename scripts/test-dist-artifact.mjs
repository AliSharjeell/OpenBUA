// Verifies the SHIPPED, MINIFIED artifact rather than the source.
//
// The fallback uploader is passed to chrome.scripting.executeScript({ func }),
// which serializes exactly one function into the page. Two things can break
// that invisibly: referencing a module-scope helper (undefined in the page), and
// a build step that reintroduces such a reference. Neither shows up when testing
// source, so this runs the real minified function from dist/ against a DOM stub
// shaped like WhatsApp Web.
//
//   npm run build && npm run test:dist
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist', import.meta.url));

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
  if (!ok) failures++;
}

if (!existsSync(join(dist, 'assets'))) {
  console.error('dist/assets not found. Run `npm run build` first.');
  process.exit(1);
}

const bundleName = readdirSync(join(dist, 'assets')).find((f) => /^sidepanel-.*\.js$/.test(f));
const bundle = readFileSync(join(dist, 'assets', bundleName), 'utf8');
check('found built sidepanel bundle', Boolean(bundleName), bundleName);

// Locate the serialized commit function by a literal only it contains, so the
// test survives minifier renames.
const ANCHOR = 'No active file transfer on this page.';
const anchorAt = bundle.indexOf(ANCHOR);
check('fallback function present in built bundle', anchorAt > 0);

if (anchorAt < 0) {
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}

// Walk back to the nearest `function NAME(` at statement level, then match braces.
const fnStart = bundle.lastIndexOf('function ', anchorAt);
const fnNameEnd = bundle.indexOf('(', fnStart);
let depth = 0;
let i = fnNameEnd;
for (; i < bundle.length; i++) {
  if (bundle[i] === '(') depth++;
  else if (bundle[i] === ')') {
    depth--;
    if (depth === 0) break;
  }
}
const bodyStart = bundle.indexOf('{', i);
depth = 0;
for (i = bodyStart; i < bundle.length; i++) {
  if (bundle[i] === '{') depth++;
  else if (bundle[i] === '}') {
    depth--;
    if (depth === 0) break;
  }
}
const fnSrc = bundle.slice(fnStart, i + 1);
check('extracted the fallback function', fnSrc.length > 500, `${fnSrc.length} chars`);

// Self-containment: it may not reference an identifier it does not declare.
// Rather than a full scope analysis, prove the property behaviourally by
// running it in a scope containing nothing but true browser globals.
function makeInput(accept) {
  const el = {
    accept,
    type: 'file',
    multiple: false,
    parentElement: null,
    getAttribute: (k) => (k === 'accept' ? accept : null),
    closest: () => null,
    dispatchEvent: () => true,
  };
  Object.defineProperty(el, 'files', { get: () => ({ length: el._set ? 1 : 0 }), set: (v) => { el._set = v; } });
  return el;
}

const mediaInput = makeInput('image/*,video/*');
const docInput = makeInput(null);
const fakeDocument = {
  querySelectorAll: (sel) => (sel.includes('input[type="file"]') ? [mediaInput, docInput] : []),
  querySelector: () => null,
};
const transferStore = {
  xfer1: {
    meta: { fileName: 'Assignment # 1.pdf', mimeType: 'application/pdf', totalChunks: 1 },
    chunks: [Buffer.from('%PDF-1.4 fake').toString('base64')],
  },
};
const fakeWindow = { __OPENBUA_FILE_TRANSFERS__: transferStore };

let commit;
try {
  const built = new Function(
    'window',
    'document',
    'DataTransfer',
    'File',
    'Event',
    'DragEvent',
    'getComputedStyle',
    'atob',
    `return (${fnSrc});`
  );
  commit = built(
    fakeWindow,
    fakeDocument,
    function DataTransfer() {
      this.items = { add: () => {} };
      this.files = { length: 1 };
    },
    function File(parts, name, opts) {
      this.name = name;
      this.type = opts.type;
    },
    function Event(type) {
      this.type = type;
    },
    function DragEvent() {},
    () => ({ position: 'static' }),
    (s) => Buffer.from(s, 'base64').toString('binary')
  );
  check('minified fallback rebuilds from its own source', typeof commit === 'function');
} catch (err) {
  check('minified fallback rebuilds from its own source', false, err.message);
  console.log(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}

const result = commit('xfer1');
check('minified fallback runs without ReferenceError', result.success === true, JSON.stringify(result));
check(
  'PDF routes to the unconstrained document input, not the media input',
  Boolean(docInput._set) && !mediaInput._set,
  `doc=${Boolean(docInput._set)} media=${Boolean(mediaInput._set)}`
);
check('no accept warning for a correctly routed document', !/WARNING/.test(result.message || ''), result.message);

transferStore.xfer2 = {
  meta: { fileName: 'clip.mp4', mimeType: 'video/mp4', totalChunks: 1 },
  chunks: [Buffer.from('fakevideo').toString('base64')],
};
mediaInput._set = undefined;
docInput._set = undefined;
const mediaResult = commit('xfer2');
check(
  'video still routes to the media input accepting video/*',
  Boolean(mediaInput._set) && !docInput._set,
  `media=${Boolean(mediaInput._set)} doc=${Boolean(docInput._set)}`
);

// The content script carries the primary path; assert its accept logic shipped.
const content = readFileSync(join(dist, 'content.js'), 'utf8');
for (const marker of [
  'PREPARE_FILE_UPLOAD',
  'COMMIT_FILE_UPLOAD',
  '__OPENBUA_FILE_TRANSFERS__',
  'acceptAllowsFile',
  'scoreFileInput',
  'openAttachmentMenuForFile',
]) {
  check(`content.js ships "${marker}"`, content.includes(marker));
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
