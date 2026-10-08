// Guards two properties of the direct executeScript transport that are easy to
// break and impossible to notice in review:
//
//  1. The function handed to chrome.scripting.executeScript is serialized on its
//     own, so any reference to a module-scope helper becomes an undefined
//     identifier in the page. A previous version called attachFileToPage() from
//     inPageCommitTransfer and threw ReferenceError on every fallback upload.
//  2. Inputs are ranked by whether `accept` permits the file, which is what
//     stops a PDF landing in a media-only input (the WhatsApp "not supported"
//     bug). Ranking is reproduced here from the shipped source.
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

// Strip TypeScript with the project's own esbuild, exactly as the real build
// does, so the function we execute is the one that ships to the page.
const compiled = await build({
  entryPoints: [`${repoRoot}src/agent/file-injection.ts`],
  bundle: false,
  write: false,
  format: 'esm',
  target: 'es2020',
  logLevel: 'silent',
});
const src = compiled.outputFiles[0].text;

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
  if (!ok) failures++;
}

// --- 1. serialization self-containment -------------------------------------
// Pull the shipped function out of the compiled module and build a real
// Function from its source, the way Chrome serializes it. If it references a
// module-scope helper, that helper is simply not there in the page.
function extractFunction(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} not found`);
  // Walk the parameter list, then take the brace that opens the body.
  let i = src.indexOf('(', start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') {
      depth--;
      if (depth === 0) break;
    }
  }
  const bodyStart = src.indexOf('{', i);
  depth = 0;
  for (i = bodyStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  return src.slice(start, i + 1);
}

const commitSrc = extractFunction('inPageCommitTransfer');
check('inPageCommitTransfer is extractable', commitSrc.length > 500, `${commitSrc.length} chars`);
check('extracted source has no TypeScript syntax left', !/:\s*string/.test(commitSrc) && !/\):\s*\{/.test(commitSrc));

// The only identifiers a serialized function may reference are its own params,
// locals, and true globals. Assert it no longer calls the removed helper.
check(
  'inPageCommitTransfer no longer calls the extracted attachFileToPage helper',
  !/\battachFileToPage\b/.test(commitSrc),
  /\battachFileToPage\b/.test(commitSrc) ? 'still referenced' : ''
);
check(
  'attachFileToPage is fully removed from the module',
  !/function attachFileToPage/.test(src)
);

// Every helper it uses must be declared inside its own body.
const declaredInside = [...commitSrc.matchAll(/\b(?:const|function|let)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
for (const helper of ['acceptAllows', 'isVisible', 'bestInput']) {
  check(`helper "${helper}" is declared inside the serialized function`, declaredInside.includes(helper));
}

// Actually run it in a jsdom-free stub to prove it reaches the attach path
// rather than throwing ReferenceError.
const built = new Function(
  'window',
  'document',
  'DataTransfer',
  'File',
  'Event',
  'DragEvent',
  'getComputedStyle',
  'atob',
  `return (${commitSrc});`
);

// Minimal DOM stand-ins modelling the WhatsApp shape: a media-only input first
// in DOM order, a document input after it.
function makeInput(accept, files) {
  return {
    accept,
    type: 'file',
    matches: selector => selector === 'input[type="file"]',
    querySelectorAll: () => [],
    disabled: false,
    multiple: false,
    files: null,
    getAttribute: (k) => (k === 'accept' ? accept : null),
    closest: () => null,
    dispatchEvent: () => true,
  };
}

const mediaInput = makeInput('image/*,video/*', null);
const docInput = makeInput(null, null);
const sent = [];
docInput.dispatchEvent = (e) => {
  sent.push(e.type);
  return true;
};
Object.defineProperty(docInput, 'files', {
  get: () => ({ length: 1 }),
  set: (v) => {
    docInput._set = v;
  },
});
docInput.closest = () => null;
docInput.parentElement = null;

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

const commit = built(
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

const result = commit('xfer1');
check('commit runs without ReferenceError', result.success === true, JSON.stringify(result));
check(
  'PDF lands on the unconstrained (document) input, not the media input',
  docInput._set !== undefined && mediaInput._set === undefined,
  `doc=${Boolean(docInput._set)} media=${Boolean(mediaInput._set)}`
);
check('input and change events are dispatched', sent.includes('input') && sent.includes('change'), sent.join(','));
check(
  'no bogus accept warning for a correctly routed document',
  !/WARNING/.test(result.message || ''),
  result.message
);

// Media file must still route to the media input.
transferStore.xfer2 = {
  meta: { fileName: 'clip.mp4', mimeType: 'video/mp4', totalChunks: 1 },
  chunks: [Buffer.from('fakevideo').toString('base64')],
};
mediaInput._set = undefined;
docInput._set = undefined;
Object.defineProperty(mediaInput, 'files', {
  get: () => ({ length: 1 }),
  set: (v) => {
    mediaInput._set = v;
  },
});
const mediaResult = commit('xfer2');
check(
  'video lands on the media input that accepts video/*',
  mediaInput._set !== undefined && docInput._set === undefined,
  `media=${Boolean(mediaInput._set)} doc=${Boolean(docInput._set)}`
);
check('media attach succeeds', mediaResult.success === true, JSON.stringify(mediaResult));

// Easy Apply-style hidden PDF controls: an explicit selector must win over DOM order.
const resumeInput = makeInput('.pdf,.doc,.docx', null);
const videoTransfer = () => ({meta: {fileName:'resume.pdf', mimeType:'application/pdf', totalChunks:1}, chunks:[Buffer.from('resume bytes').toString('base64')]});
const originalQuery = fakeDocument.querySelectorAll;
fakeDocument.querySelectorAll = sel => sel === '#resume-upload' ? [resumeInput] : originalQuery(sel);
transferStore.targeted = videoTransfer();
const targeted = commit('targeted', undefined, '#resume-upload', false);
check('explicit Easy Apply resume target accepts PDF extension', targeted.success && resumeInput.files?.length === 1);
resumeInput.files = null;
resumeInput.disabled = true;
transferStore.disabled = videoTransfer();
check('disabled explicit input never receives a file', !commit('disabled', undefined, '#resume-upload').success && !resumeInput.files);
resumeInput.disabled = false;
transferStore.missingTarget = videoTransfer();
check('missing explicit selector never uploads to another control', !commit('missingTarget', undefined, '#missing').success);
const shadowInput = makeInput('application/pdf', null);
const shadowRoot = {querySelectorAll: sel => sel === 'input[type="file"]' ? [shadowInput] : []};
fakeDocument.querySelectorAll = sel => sel === '*' ? [{shadowRoot}] : originalQuery(sel);
transferStore.shadow = videoTransfer();
check('PDF upload finds an input inside open shadow DOM', commit('shadow').success && shadowInput.files?.length === 1);
// Frame discovery is also serialized independently by Chrome.
const probeSrc = extractFunction('inPageFindUploadTarget');
const probe = new Function('document', `return (${probeSrc});`)(fakeDocument);
check('frame probe finds compatible shadow upload without mutating it', probe('resume.pdf', 'application/pdf') >= 0);
check('frame probe rejects incompatible explicit upload', probe('resume.pdf', 'application/pdf', undefined, '#media-only') < 0);

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
