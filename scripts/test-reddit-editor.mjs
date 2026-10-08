import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.OPENBUA_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.OPENBUA_CHROME_PATH ? { executablePath: process.env.OPENBUA_CHROME_PATH } : {}) });
const page = await browser.newPage();
const title = 'I built a browser agent that handles job applications';
const body = 'Hey everyone,\n\nI built OpenBUA to handle repetitive forms.\n\nPromo video: https://lnkd.in/p/d3miiQ4P\n\nSite: https://openbua.com\n\nWould love feedback from early testers.';
try {
  await page.goto('http://127.0.0.1:5173/test-form.html');
  await page.evaluate(() => {
    window.chrome = { runtime: { onMessage: { addListener(listener) { window.listener = listener; } } }, tabs: {
      query(_q, callback) { callback([{ id: 7, url: 'https://www.reddit.com/r/test/submit/' }]); },
      sendMessage(_id, message, callback) { window.listener(message, {}, callback); },
    }, scripting: { executeScript: async injection => [{ result: await new Function(`return (${injection.func.toString()})`)()(...(injection.args || [])) }] } };
  });
  await page.addScriptTag({ path: fileURLToPath(new URL('../dist/content.js', import.meta.url)) });
  const setup = async markdown => {
    await page.setContent('<reddit-composer></reddit-composer>');
    await page.evaluate(markdown => {
      delete document.documentElement.dataset.openbuaRedditDraft;
      const root = document.querySelector('reddit-composer').attachShadow({ mode: 'open' });
      root.innerHTML = '<textarea name="title" aria-label="Post title"></textarea><div contenteditable="true" name="body" aria-label="Post body text field"><p>Garbled old draft. Garbled old draft.</p></div><button type="button">Post</button>';
      window.postClicks = 0; root.querySelector('button').onclick = () => window.postClicks++;
      if (markdown) {
        const toggle = document.createElement('button'); toggle.textContent = 'Switch to Markdown'; root.append(toggle);
        toggle.onclick = () => {
          const body = root.querySelector('[name="body"]');
          const area = document.createElement('textarea'); area.name = 'body'; area.setAttribute('aria-label', 'Post body Markdown'); area.value = body.innerText;
          area.oninput = () => { window.savedBody = area.value; }; body.replaceWith(area); toggle.remove();
        };
      } else {
        root.querySelector('[name="body"]').onpaste = event => {
          event.preventDefault();
          // Emulate a framework-owned paste: parse paragraphs into editor state.
          event.currentTarget.innerHTML = event.clipboardData.getData('text/html');
          window.savedBody = event.currentTarget.innerText;
        };
      }
    }, markdown);
  };
  const prepare = () => page.evaluate(async ({ title, body }) => {
    const { prepareRedditPostTool } = await import('/src/agent/tools.ts'); return prepareRedditPostTool.execute('prepare', { title, body });
  }, { title, body });
  await setup(true);
  const prepared = await prepare(); assert.equal(prepared.details.success, true); assert.equal(prepared.details.mode, 'markdown');
  const read = () => page.evaluate(() => {
    const root = document.querySelector('reddit-composer').shadowRoot;
    return { title: root.querySelector('[name="title"]').value, body: root.querySelector('[name="body"]').value ?? root.querySelector('[name="body"]').innerText, saved: window.savedBody, posts: window.postClicks };
  });
  assert.deepEqual(await read(), { title, body, saved: body, posts: 0 });
  await prepare(); assert.equal((await read()).body, body, 'retry replaces instead of duplicating');
  await page.evaluate(() => {
    const root = document.querySelector('reddit-composer').shadowRoot;
    const target = root.querySelector('[name="title"]'); target.focus(); target.value = 'Wrong title';
  });
  const typed = await page.evaluate(async title => {
    const { typeTextTool } = await import('/src/agent/tools.ts'); return typeTextTool.execute('type-title', { text: title, clearFirst: true });
  }, title);
  assert.equal(typed.details.success, true); assert.equal((await read()).title, title); assert.equal((await read()).body, body, 'focused title is never routed into body');
  await page.evaluate(() => { chrome.tabs.sendMessage = (_id, _message, callback) => callback(undefined); });
  const fallback = await page.evaluate(async title => {
    const root = document.querySelector('reddit-composer').shadowRoot;
    root.querySelector('[name="title"]').value = 'Bad'; root.querySelector('[name="title"]').focus();
    const { typeTextTool } = await import('/src/agent/tools.ts'); return typeTextTool.execute('fallback-title', { text: title, clearFirst: true });
  }, title);
  assert.equal(fallback.details.success, true); assert.equal((await read()).title, title); assert.equal((await read()).body, body);
  await page.evaluate(() => { const root = document.querySelector('reddit-composer').shadowRoot; root.querySelector('[name="body"]').value += '\nDuplicated tail'; });
  const blocked = await page.evaluate(async () => { const { clickElementTool } = await import('/src/agent/tools.ts'); return clickElementTool.execute('post', { text: 'Post' }); });
  assert.equal(blocked.details.dispatched, false); assert.equal((await read()).posts, 0, 'full draft verification blocks damaged-tail submission');
  await prepare();
  const posted = await page.evaluate(async () => { const { clickElementTool } = await import('/src/agent/tools.ts'); return clickElementTool.execute('post-good', { text: 'Post' }); });
  assert.equal(posted.details.success, true); assert.equal((await read()).posts, 1);
  await setup(false);
  const rich = await prepare(); assert.equal(rich.details.success, true); assert.equal(rich.details.mode, 'rich-text');
  assert.equal((await read()).body, body); assert.equal((await read()).title, title);
  await prepare(); assert.equal((await read()).body, body, 'framework paste replacement does not duplicate old text');
  const duplicate = await page.evaluate(async body => {
    const root = document.querySelector('reddit-composer').shadowRoot;
    root.querySelector('[name="body"]').setAttribute('data-autoform-ref', 'af_test');
    const { fillFormFieldsTool } = await import('/src/agent/tools.ts');
    return fillFormFieldsTool.execute('wrong-refs', { assignments: [{ refId: 'af_test', value: 'Title' }, { refId: 'af_test', value: body }] });
  }, body);
  assert.equal(duplicate.details.successCount, 0); assert.equal((await read()).body, body, 'duplicate title/body target refused before mutation');
  await page.evaluate(() => {
    const root = document.querySelector('reddit-composer').shadowRoot;
    root.querySelector('[name="body"]').onpaste = event => { event.preventDefault(); event.currentTarget.textContent = event.clipboardData.getData('text/plain').slice(0, 25); };
  });
  const truncated = await prepare(); assert.equal(truncated.details.success, false, 'matching prefix cannot verify a truncated body');
  const files = await page.evaluate(async () => {
    const input = document.createElement('input'); input.type = 'file'; input.hidden = true; input.id = 'reddit-media'; document.body.append(input);
    const { inPageWriteRedditDraft } = await import('/src/agent/reddit-editor.ts');
    return inPageWriteRedditDraft([{ selector: '#reddit-media', value: 'clip.mp4' }]);
  });
  assert.equal(files.mode, 'file-input', 'hidden media inputs retain the normal upload path');
  console.log('PASS distinct Reddit title/body, Markdown paragraph/URL preservation, framework paste, exact full-value verification, idempotent replacement, focused title typing, clearFirst fallback, and damaged-draft Post suppression');
} finally { await browser.close(); }
