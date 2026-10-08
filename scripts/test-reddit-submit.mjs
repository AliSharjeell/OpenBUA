import assert from 'node:assert/strict';
const { chromium } = await import(process.env.OPENBUA_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.OPENBUA_CHROME_PATH ? { executablePath: process.env.OPENBUA_CHROME_PATH } : {}) });
const page = await browser.newPage();
try {
  await page.goto('http://127.0.0.1:5173/test-form.html');
  await page.evaluate(() => {
    window.chrome = { tabs: { query: (_q, cb) => cb([{ id: 7, url: 'https://www.reddit.com/r/test/submit/' }]) }, scripting: { executeScript: async injection => [{ result: await new Function(`return (${injection.func.toString()})`)()(...(injection.args || [])) }] } };
  });
  const setup = async (disabled = false) => {
    await page.evaluate(disabled => {
      history.replaceState({}, '', '/r/test/submit/');
      document.body.innerHTML = '<textarea name="title">Four word post title</textarea><textarea name="body">Body text</textarea><r-post-form-submit-button>Post</r-post-form-submit-button>';
      const host = document.querySelector('r-post-form-submit-button');
      host.attachShadow({ mode: 'open' }).innerHTML = `<button ${disabled ? 'disabled' : ''}><slot></slot></button>`;
      document.documentElement.dataset.openbuaRedditDraft = JSON.stringify({ url: location.href, values: { title: 'Four word post title', body: 'Body text' } });
      delete document.documentElement.dataset.openbuaRedditSubmitAttempt;
      window.clicks = 0;
      host.shadowRoot.querySelector('button').onclick = () => { window.clicks++; };
    }, disabled);
  };
  const action = () => page.evaluate(async () => { const { submitRedditPostTool } = await import('/src/agent/tools.ts'); return submitRedditPostTool.execute('submit', {}); });
  await setup(true);
  let result = await action(); assert.equal(result.details.dispatched, false); assert.match(result.details.message, /disabled/); assert.equal(await page.evaluate(() => window.clicks), 0);
  for (const layout of ['light-button', 'role-wrapper', 'slotted-button']) {
    await setup();
    await page.evaluate(layout => {
      const previous = document.querySelector('r-post-form-submit-button');
      const host = document.createElement('r-post-form-submit-button'); previous.replaceWith(host);
      if (layout === 'light-button') host.innerHTML = '<button id="real-post">Post</button>';
      else if (layout === 'role-wrapper') host.innerHTML = '<div role="button"> <button id="real-post">Post</button> </div>';
      else {
        host.innerHTML = '<button id="real-post">Post</button>';
        host.attachShadow({ mode: 'open' }).innerHTML = '<div role="button"><slot></slot></div>';
      }
      host.querySelector('button').onclick = () => {
        window.clicks++; history.pushState({}, '', '/r/test/comments/nested/post/'); document.body.innerHTML = '<h1>Four word post title</h1>';
      };
    }, layout);
    result = await action(); assert.equal(result.details.postVerified, true, `one physical Post is resolved for ${layout}`);
    assert.equal(await page.evaluate(() => window.clicks), 1);
  }
  await setup();
  await page.evaluate(() => { document.body.insertAdjacentHTML('beforeend', '<button>Post</button>'); });
  result = await action(); assert.equal(result.details.dispatched, false); assert.match(result.details.message, /2 independent Post controls/);
  assert.equal(await page.evaluate(() => window.clicks), 0, 'genuinely separate controls remain ambiguous');
  await setup();
  await page.evaluate(() => {
    const host = document.querySelector('r-post-form-submit-button');
    host.setAttribute('aria-disabled', 'true');
  });
  result = await action(); assert.equal(result.details.dispatched, false); assert.match(result.details.message, /disabled/);
  await setup();
  await page.evaluate(() => { document.querySelector('textarea[name="body"]').value += ' bad tail'; });
  result = await action(); assert.equal(result.details.dispatched, false); assert.equal(await page.evaluate(() => window.clicks), 0);
  await setup();
  await page.evaluate(() => {
    document.querySelector('r-post-form-submit-button').shadowRoot.querySelector('button').onclick = () => {
      window.clicks++; document.body.insertAdjacentHTML('beforeend', '<div role="alert">Post flair is required</div>');
    };
  });
  result = await action(); assert.equal(result.details.state, 'blocked'); assert.match(result.details.message, /flair is required/); assert.equal(await page.evaluate(() => window.clicks), 1);
  await setup();
  result = await action(); assert.equal(result.details.state, 'unconfirmed'); assert.equal(result.details.success, false);
  result = await action(); assert.equal(result.details.dispatched, false); assert.equal(await page.evaluate(() => window.clicks), 1, 'unconfirmed submission never re-clicked');
  result = await page.evaluate(async () => {
    const button = document.querySelector('r-post-form-submit-button').shadowRoot.querySelector('button');
    const rect = button.getBoundingClientRect();
    const { clickAtPositionTool } = await import('/src/agent/tools.ts');
    return clickAtPositionTool.execute('coordinate-retry', { x: (rect.x + rect.width / 2) * devicePixelRatio, y: (rect.y + rect.height / 2) * devicePixelRatio });
  });
  assert.equal(result.details.dispatched, false); assert.equal(await page.evaluate(() => window.clicks), 1, 'coordinate clicks cannot bypass duplicate protection');
  await setup();
  await page.evaluate(() => {
    document.querySelector('r-post-form-submit-button').shadowRoot.querySelector('button').onclick = () => {
      window.clicks++; history.pushState({}, '', '/r/test/comments/abc123/post/'); document.body.innerHTML = '<h1>Four word post title</h1>';
    };
  });
  result = await action(); assert.equal(result.details.postVerified, true); assert.equal(result.details.state, 'posted');
  // A full navigation erases document markers; the panel remembers the intended
  // title and a read-only verifier still requires the matching permalink/title.
  await page.evaluate(() => { delete document.documentElement.dataset.openbuaRedditDraft; });
  result = await page.evaluate(async () => { const { verifyRedditPostTool } = await import('/src/agent/tools.ts'); return verifyRedditPostTool.execute('verify', {}); });
  assert.equal(result.details.postVerified, true);
  result = await page.evaluate(async () => { const { verifyApplicationStatusTool } = await import('/src/agent/tools.ts'); return verifyApplicationStatusTool.execute('misnamed-verifier', {}); });
  assert.equal(result.details.postVerified, true, 'legacy job verifier delegates to Reddit verification on Reddit');
  await page.evaluate(() => { document.querySelector('h1').textContent = 'Different unrelated title'; });
  result = await page.evaluate(async () => { const { verifyRedditPostTool } = await import('/src/agent/tools.ts'); return verifyRedditPostTool.execute('verify', {}); });
  assert.equal(result.details.postVerified, false);
  console.log('PASS Reddit shadow Post control, disabled and corrupted draft blocking, visible flair rejection, no duplicate uncertain submission, matching permalink/title confirmation and read-only verification after navigation');
} finally { await browser.close(); }
