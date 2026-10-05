// Guards the canvas-editor input path.
//
// Two classes of bug are invisible to a reviewer here and to any source-level
// test:
//
//  1. Serialization. inPage* functions are shipped to the page by
//     chrome.scripting.executeScript({ func }), which serializes exactly one
//     function. A module-scope reference is undefined in the page. A previous
//     release shipped such a function and every fallback upload died with
//     ReferenceError.
//  2. Key codes. press_key_combination used key.charCodeAt(0), so "ArrowUp"
//     became keyCode 65 ('A') and "Home" became 124 ('|'). Every navigation key
//     was silently discarded, which is exactly what made Google Docs unusable.
//
// This executes the real functions, rebuilt from the esbuild output the way
// Chrome serializes them, against a DOM stub.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

// The canvas input path is split across two modules: the content script owns the
// primary implementation, the bridge owns the direct-injection fallback. Compile
// both and search whichever holds a given function.
const sources = {};
const modulePaths = {
  'browser-bridge.ts': 'src/agent/browser-bridge.ts',
  'content-script.ts': 'src/content/content-script.ts',
};
for (const [name, rel] of Object.entries(modulePaths)) {
  const compiled = await build({
    entryPoints: [`${repoRoot}${rel}`],
    bundle: false,
    write: false,
    format: 'esm',
    target: 'es2020',
    logLevel: 'silent',
  });
  sources[name] = compiled.outputFiles[0].text;
}
const src = sources['browser-bridge.ts'];
const allSrc = Object.values(sources).join('\n');

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
  if (!ok) failures++;
}

/** Slice one function out of compiled source, skipping params and return types. */
function extractFunction(name) {
  // Search the bridge first, then the content script, so a function that exists
  // in both resolves to the one being asserted about.
  let haystack = src;
  if (!src.includes(`function ${name}(`)) {
    if (allSrc.includes(`function ${name}(`)) haystack = allSrc;
  }
  const start = haystack.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} not found in compiled output`);
  let i = haystack.indexOf('(', start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') {
      depth--;
      if (depth === 0) break;
    }
  }
  const bodyStart = haystack.indexOf('{', i);
  depth = 0;
  for (i = bodyStart; i < haystack.length; i++) {
    if (haystack[i] === '{') depth++;
    else if (haystack[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  return haystack.slice(start, i + 1);
}

/** Rebuild a function the way Chrome does: source only, no closure. */
function rebuild(name, globals) {
  const fnSrc = extractFunction(name);
  const keys = Object.keys(globals);
  const built = new Function(...keys, `return (${fnSrc});`);
  return { fn: built(...keys.map((k) => globals[k])), source: fnSrc };
}

// --- DOM stub ---------------------------------------------------------------
function makeKeyboardEvent(type, init) {
  return { type, ...init };
}
function makeMouseEvent(type, init) {
  return { type, ...init };
}
function makeEvent(type) {
  return { type, bubbles: true };
}
function makeInputEvent(type, init) {
  return { type, ...init };
}

function makeCanvasEl() {
  const el = {
    tagName: 'CANVAS',
    isContentEditable: false,
    textContent: '',
    value: '',
    ownerDocument: null,
    _events: [],
    focus() {},
    dispatchEvent(e) {
      el._events.push(e);
      return true;
    },
    getBoundingClientRect: () => ({ width: 800, height: 900, top: 0, left: 0 }),
  };
  return el;
}

/** A minimal Google Docs-like page: a canvas plus the hidden input iframe. */
function makeDocsPage(opts = {}) {
  // By default the editor ACCEPTS input and its content grows, which is what a
  // working Docs looks like. Pass { rejectInput: true } to model an editor that
  // silently discards the insert - the failure that made the agent loop.
  const rejectInput = Boolean(opts.rejectInput);
  const canvas = makeCanvasEl();

  const innerBody = {
    tagName: 'BODY',
    isContentEditable: true,
    textContent: '',
    ownerDocument: null,
    _events: [],
    focus() {},
    dispatchEvent(e) {
      innerBody._events.push(e);
      return true;
    },
  };
  const innerDoc = {
    body: innerBody,
    activeElement: innerBody,
    execCommand: (cmd, _ui, value) => {
      page.execCalls.push(cmd);
      if (rejectInput) return true; // dispatch succeeds, nothing lands
      if (cmd === 'insertText' && typeof value === 'string') {
        innerBody.textContent += value;
      }
      return true;
    },
    getSelection: () => null,
    defaultView: { KeyboardEvent: makeKeyboardEvent, Event: makeEvent, InputEvent: makeInputEvent },
    querySelector: () => null,
  };
  innerBody.ownerDocument = innerDoc;

  const frame = {
    className: 'docs-texteventtarget-iframe',
    id: '',
    src: '',
    contentDocument: innerDoc,
  };

  const page = {
    execCalls: [],
    body: {
      tagName: 'BODY',
      isContentEditable: false,
      textContent: '',
      ownerDocument: null,
      _events: [],
      focus() {},
      dispatchEvent(e) {
        page.body._events.push(e);
        return true;
      },
    },
    activeElement: null,
    execCommand(cmd) {
      page.execCalls.push(cmd);
      return true;
    },
    getSelection: () => null,
    defaultView: { KeyboardEvent: makeKeyboardEvent, Event: makeEvent, InputEvent: makeInputEvent },
    querySelector(sel) {
      // A canvas editor shell is present, so the editor is treated as JS-driven.
      if (sel.includes('kix-appview')) return { tagName: 'DIV' };
      return null;
    },
    querySelectorAll(sel) {
      if (sel.includes('iframe')) return [frame];
      if (sel.includes('contenteditable')) return [];
      return [];
    },
    elementFromPoint: () => canvas,
  };
  page.body.ownerDocument = page;
  return { page, canvas, frame, innerBody };
}

// --- 1. inPageTypeText ------------------------------------------------------
{
  const { page, canvas, innerBody } = makeDocsPage();
  const { fn, source } = rebuild('inPageTypeText', {
    document: page,
    Event: makeEvent,
    InputEvent: makeInputEvent,
  });

  check('inPageTypeText rebuilds from its own source', typeof fn === 'function');
  check(
    'inPageTypeText declares its helpers internally',
    /const\s+pressEnter\s*=/.test(source),
    'pressEnter must be inside the function body'
  );

  const res = fn('First line\nSecond line\nThird line', true);
  check('multi-line typing succeeds', res.success === true, JSON.stringify(res));
  check(
    'a Shift key is dispatched to prime the editor focus before typing',
    innerBody._events.some((e) => e.type === 'keydown' && e.keyCode === 16),
    'the missing focus step that made typing silently no-op'
  );
  check('reports 3 lines', res.lines === 3, String(res.lines));
  check(
    'one insertText per non-empty line',
    page.execCalls.filter((c) => c === 'insertText').length === 3,
    JSON.stringify(page.execCalls)
  );
  const enters = innerBody._events.filter((e) => e.type === 'keydown' && e.keyCode === 13);
  check(
    'newlines become real Enter keydowns with keyCode 13 in a canvas editor',
    enters.length === 2,
    `got ${enters.length}`
  );
  check(
    'no insertParagraph alongside Enter in a canvas editor (would double-insert)',
    !page.execCalls.includes('insertParagraph'),
    JSON.stringify(page.execCalls)
  );
  check(
    'typing resolves the hidden texteventtarget iframe, not the top body',
    page.body._events.length === 0,
    `top body got ${page.body._events.length} events`
  );
}

// --- 1b. an editor that silently discards input must NOT report success ----
{
  const { page, innerBody } = makeDocsPage({ rejectInput: true });
  const { fn } = rebuild('inPageTypeText', { document: page, Event: makeEvent, InputEvent: makeInputEvent });

  const res = fn('Z', true);
  check(
    'silently-rejecting editor reports failure, not "Typed 1 character"',
    res.success === false,
    JSON.stringify(res)
  );
  check(
    'the failure explains a coordinate click alone does not give the editor focus',
    /keyboard focus/i.test(res.message),
    res.message
  );
  check(
    'the failure tells the agent what to do next (click, press a key, retry)',
    /Home|End|navigation key/i.test(res.message) && /again/i.test(res.message),
    res.message
  );
  check('the target content really did not change', innerBody.textContent === '', JSON.stringify(innerBody.textContent));
}

// --- 2. plain textarea path -------------------------------------------------
{
  const { page } = makeDocsPage();
  const textarea = {
    tagName: 'TEXTAREA',
    value: '',
    selectionStart: 0,
    selectionEnd: 0,
    ownerDocument: page,
    _events: [],
    focus() {},
    setSelectionRange() {},
    dispatchEvent(e) {
      textarea._events.push(e);
      return true;
    },
  };
  page.querySelectorAll = (sel) => (sel.includes('contenteditable') ? [textarea] : []);
  page.activeElement = textarea;

  const { fn } = rebuild('inPageTypeText', { document: page, Event: makeEvent, InputEvent: makeInputEvent });
  const res = fn('hello', true);
  check('textarea typing succeeds', res.success === true, JSON.stringify(res));
  check('textarea receives the text', textarea.value === 'hello', textarea.value);
  check('textarea gets an input event', textarea._events.some((e) => e.type === 'input'));
  check('textarea path does not use execCommand', page.execCalls.length === 0, JSON.stringify(page.execCalls));
}

// --- 3. inPageClickAtPoint --------------------------------------------------
{
  const { page, canvas } = makeDocsPage();
  const { fn } = rebuild('inPageClickAtPoint', {
    document: page,
    window: { screenX: 0, screenY: 0, innerWidth: 1079, innerHeight: 1067, devicePixelRatio: 1.6 },
    PointerEvent: makeMouseEvent,
    MouseEvent: makeMouseEvent,
  });

  const res = fn(420, 260, 1, 0);
  check('coordinate click succeeds', res.success === true, JSON.stringify(res));
  check('reports the element under the cursor', res.element === 'canvas', res.element);
  const types = canvas._events.map((e) => e.type);
  check(
    'dispatches the full pointer/mouse/click sequence',
    ['pointerdown', 'mousedown', 'mouseup', 'click'].every((t) => types.includes(t)),
    types.join(',')
  );
  const mousedown = canvas._events.find((e) => e.type === 'mousedown');
  check(
    'mousedown carries the exact coordinates (this is what places the caret)',
    mousedown.clientX === 420 && mousedown.clientY === 260,
    `${mousedown.clientX},${mousedown.clientY}`
  );

  // Double click selects a word.
  canvas._events.length = 0;
  const dbl = fn(100, 100, 2, 0);
  const dblTypes = canvas._events.map((e) => e.type);
  check('double click emits two mousedowns', dblTypes.filter((t) => t === 'mousedown').length === 2, dblTypes.join(','));
  check('double click emits dblclick', dblTypes.includes('dblclick'), dblTypes.join(','));
  check('double click succeeds', dbl.success === true);
}

// --- 3b. shift+click must extend the selection, the only way to select a
//         range in a canvas editor where there is no element to target.
{
  const { page, canvas } = makeDocsPage();
  const { fn } = rebuild('inPageClickAtPoint', {
    document: page,
    window: { screenX: 0, screenY: 0, innerWidth: 1081, innerHeight: 1060, devicePixelRatio: 1.6 },
    PointerEvent: makeMouseEvent,
    MouseEvent: makeMouseEvent,
  });

  const shifted = fn(300, 500, 1, 0, true);
  check('shift+click succeeds', shifted.success === true, JSON.stringify(shifted));
  const shiftDown = canvas._events.filter((e) => e.type === 'mousedown');
  check('shift+click dispatches mousedown with shiftKey true', shiftDown.some((e) => e.shiftKey === true), JSON.stringify(shiftDown.map((e) => e.shiftKey)));
  check('shift+click also sets the other modifiers false, not undefined', shiftDown.every((e) => e.ctrlKey === false && e.altKey === false && e.metaKey === false), JSON.stringify(shiftDown));
  check('reply confirms the selection was extended', /extending the selection/i.test(shifted.message), shifted.message);

  // A normal click must NOT claim a selection extension.
  const { page: page2, canvas: canvas2 } = makeDocsPage();
  const plain = rebuild('inPageClickAtPoint', {
    document: page2,
    window: { screenX: 0, screenY: 0, innerWidth: 1081, innerHeight: 1060, devicePixelRatio: 1.6 },
    PointerEvent: makeMouseEvent,
    MouseEvent: makeMouseEvent,
  }).fn;
  const normal = plain(300, 500, 1, 0, false);
  const normalDown = canvas2._events.find((e) => e.type === 'mousedown');
  check('plain click has shiftKey false', normalDown.shiftKey === false, String(normalDown.shiftKey));
  check('plain click does not claim to extend the selection', !/extending the selection/i.test(normal.message), normal.message);
}

// --- 4. miss reports honestly ----------------------------------------------
{
  const { page } = makeDocsPage();
  page.elementFromPoint = () => null;
  const { fn } = rebuild('inPageClickAtPoint', {
    document: page,
    window: { screenX: 0, screenY: 0, innerWidth: 1079, innerHeight: 1067, devicePixelRatio: 1.6 },
    PointerEvent: makeMouseEvent,
    MouseEvent: makeMouseEvent,
  });
  const res = fn(9999, 9999, 1, 0);
  check('out-of-bounds click fails honestly instead of pretending', res.success === false, JSON.stringify(res));
  check('and explains to check the screenshot', /screenshot/i.test(res.message), res.message);
  // The reported viewport must be real numbers, not "undefinedxundefined".
  check(
    'the failure reports the actual CSS viewport and device pixel ratio',
    res.viewport?.width === 1079 && res.viewport?.height === 1067 && res.viewport?.devicePixelRatio === 1.6,
    JSON.stringify(res.viewport)
  );
  check(
    'the failure names the device pixel ratio so the agent stops guessing the scale',
    /1\.6/.test(res.message),
    res.message
  );
  check(
    'the failure says screenshots are larger than the CSS viewport',
    /screenshot/i.test(res.message) && /larger/i.test(res.message),
    res.message
  );
}

// --- 5. keyCode regression: the bug that blocked Google Docs ----------------
{
  const { page, innerBody } = makeDocsPage();
  page.activeElement = innerBody;
  const { fn } = rebuild('inPagePressKey', { document: page, KeyboardEvent: makeKeyboardEvent });

  const expected = {
    ArrowUp: 38,
    ArrowDown: 40,
    ArrowLeft: 37,
    ArrowRight: 39,
    Home: 36,
    End: 35,
    PageUp: 33,
    PageDown: 34,
    Enter: 13,
    Tab: 9,
    Escape: 27,
    Backspace: 8,
    Delete: 46,
    Space: 32,
  };
  let allOk = true;
  const wrong = [];
  for (const [key, want] of Object.entries(expected)) {
    innerBody._events.length = 0;
    fn({ key });
    const kd = innerBody._events.find((e) => e.type === 'keydown');
    if (!kd || kd.keyCode !== want) {
      allOk = false;
      wrong.push(`${key}=${kd ? kd.keyCode : 'none'} (want ${want})`);
    }
  }
  check('navigation/editing keys dispatch correct keyCodes', allOk, wrong.join(' '));

  // The specific regression: charCodeAt(0) would give 65 and 124.
  innerBody._events.length = 0;
  fn({ key: 'ArrowUp' });
  const up = innerBody._events.find((e) => e.type === 'keydown');
  check('ArrowUp is 38, not the letter A (65)', up.keyCode === 38 && up.keyCode !== 65, String(up.keyCode));
  innerBody._events.length = 0;
  fn({ key: 'Home' });
  const home = innerBody._events.find((e) => e.type === 'keydown');
  check('Home is 36, not "|" (124)', home.keyCode === 36 && home.keyCode !== 124, String(home.keyCode));

  // Key events must reach the hidden iframe body, not the top document.
  check('keys are delivered into the texteventtarget iframe', innerBody._events.length > 0, String(innerBody._events.length));

  // Ctrl modifier must survive.
  innerBody._events.length = 0;
  fn({ key: 'a', ctrlKey: true });
  const ctrlA = innerBody._events.find((e) => e.type === 'keydown');
  check('Ctrl+key keeps its modifier', ctrlA.ctrlKey === true && ctrlA.keyCode === 65, JSON.stringify({ c: ctrlA.ctrlKey, k: ctrlA.keyCode }));

  // Regression: keypress means "insert this character", and editors turn its
  // legacy char code into String.fromCharCode(which). A keypress on a
  // navigation key therefore types '$' (Home=36) or '#' (End=35) into the
  // document - a real session littered a Google Doc with exactly those
  // characters after pressing Home/End ten times "to give the editor focus".
  const navKeys = [
    'Home', 'End', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'PageUp', 'PageDown', 'Escape', 'Tab', 'Backspace', 'Delete', 'F1',
  ];
  const leaked = [];
  for (const key of navKeys) {
    innerBody._events.length = 0;
    fn({ key });
    const presses = innerBody._events.filter((e) => e.type === 'keypress');
    if (presses.length > 0) leaked.push(`${key}->${presses.map((p) => p.which).join(',')}`);
  }
  check(
    'navigation/editing keys never dispatch keypress (that is what typed $ and #)',
    leaked.length === 0,
    leaked.join(' ') || `leaked ${leaked.length}`
  );

  // Character keys must still keypress - that is how text is inserted - and the
  // keypress must carry the character's own code (String.fromCharCode(97) ===
  // 'a'), not the physical key code (65 would uppercase).
  innerBody._events.length = 0;
  fn({ key: 'a' });
  const aPress = innerBody._events.find((e) => e.type === 'keypress');
  const aDown = innerBody._events.find((e) => e.type === 'keydown');
  check('a character key still dispatches keypress', Boolean(aPress));
  check(
    'its keypress carries the character code 97, not the letter code 65',
    aPress && aPress.which === 97 && aPress.keyCode === 97,
    JSON.stringify(aPress)
  );
  check('while keydown keeps the physical code 65', aDown && aDown.keyCode === 65, JSON.stringify(aDown));

  innerBody._events.length = 0;
  fn({ key: 'Space' });
  const spacePress = innerBody._events.find((e) => e.type === 'keypress');
  check(
    'Space keypresses a real space (char 32)',
    spacePress && spacePress.which === 32 && spacePress.key === ' ',
    JSON.stringify(spacePress)
  );

  innerBody._events.length = 0;
  fn({ key: 'Enter' });
  const enterPress = innerBody._events.find((e) => e.type === 'keypress');
  check('Enter still keypresses (char 13)', enterPress && enterPress.which === 13, JSON.stringify(enterPress));
}

// --- 6. clipboard must prime focus and send a real Ctrl shortcut ----------
// The content script is injected as a file, not serialized by executeScript, so
// clipboardActionInPage may call module-scope helpers. Rebuild those too so the
// function runs in isolation here.
function buildContentScriptHelpers(globals) {
  const detect = rebuild('detectCanvasEditor', globals).fn;
  const prime = rebuild('primeEditorFocus', globals).fn;
  const resolve = rebuild('resolveTypingTarget', { ...globals, detectCanvasEditor: detect }).fn;
  return { detect, prime, resolve };
}
{
  const combos = {
    copy: 'c',
    cut: 'x',
    paste: 'v',
    selectAll: 'a',
    duplicate: 'd',
  };
  for (const [action, letter] of Object.entries(combos)) {
    const { page, innerBody } = makeDocsPage();
    const base = { document: page, location: { hostname: 'docs.google.com' }, Event: makeEvent, InputEvent: makeInputEvent };
    const h = buildContentScriptHelpers(base);
    const { fn } = rebuild('clipboardActionInPage', {
      ...base,
      detectCanvasEditor: h.detect,
      primeEditorFocus: h.prime,
      resolveTypingTarget: h.resolve,
    });
    const res = fn(action);
    const kd = innerBody._events.find((e) => e.type === 'keydown' && e.key === letter);
    const ok = res.success === true && kd && kd.ctrlKey === true;
    check(
      `clipboard "${action}" dispatches Ctrl+${letter.toUpperCase()} to the editor frame`,
      ok,
      JSON.stringify({ success: res.success, key: kd && kd.key, ctrl: kd && kd.ctrlKey })
    );
    check(
      `clipboard "${action}" also sends keyup`,
      innerBody._events.some((e) => e.type === 'keyup' && e.key === letter)
    );
  }

  // It must prime focus first, or the shortcut is discarded like the typing was.
  const { page, innerBody } = makeDocsPage();
  const base = { document: page, location: { hostname: 'docs.google.com' }, Event: makeEvent, InputEvent: makeInputEvent };
  const h = buildContentScriptHelpers(base);
  const { fn } = rebuild('clipboardActionInPage', {
    ...base,
    detectCanvasEditor: h.detect,
    primeEditorFocus: h.prime,
    resolveTypingTarget: h.resolve,
  });
  fn('copy');
  const firstKeydown = innerBody._events.find((e) => e.type === 'keydown');
  check(
    'clipboard primes editor focus with Shift before sending the shortcut',
    firstKeydown && firstKeydown.keyCode === 16,
    JSON.stringify(firstKeydown)
  );

  const bad = fn('nonsense');
  check('an unknown clipboard action fails instead of doing something random', bad.success === false, JSON.stringify(bad));
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
