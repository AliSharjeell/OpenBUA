import assert from 'node:assert/strict';
const { chromium } = await import(process.env.OPENBUA_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.OPENBUA_CHROME_PATH ? { executablePath: process.env.OPENBUA_CHROME_PATH } : {}) });
const page = await browser.newPage();
try {
  await page.goto('http://127.0.0.1:5173/test-form.html');
  await page.evaluate(() => { window.chrome = { tabs: { query: (_q, cb) => cb([{ id: 7, url: 'https://www.reddit.com/r/test/submit/' }]) }, scripting: { executeScript: async injection => [{ result: await new Function(`return (${injection.func.toString()})`)()(...(injection.args || [])) }] } }; });
  const setup = () => page.evaluate(() => {
    history.replaceState({}, '', '/r/test/submit/');
    document.body.innerHTML = '<textarea name="title">New post</textarea><textarea name="body">Complete body</textarea><button>Post</button>';
    document.documentElement.dataset.openbuaRedditDraft = JSON.stringify({ url: location.href, values: { title: 'New post', body: 'Complete body' } });
    delete document.documentElement.dataset.openbuaRedditSubmitAttempt;
    window.clicks = 0;
  });
  const submit = () => page.evaluate(async () => { const { submitRedditPostTool } = await import('/src/agent/tools.ts'); return (await submitRedditPostTool.execute('submit', {})).details; });
  await setup();
  await page.evaluate(() => { document.querySelector('button').onclick = () => { window.clicks++; history.pushState({}, '', '/r/test/?created=t3_abc123'); document.body.innerHTML = '<shreddit-post post-title="New post" permalink="/r/test/comments/abc123/new_post/"></shreddit-post>'; }; });
  let result = await submit(); assert.equal(result.state, 'posted'); assert.equal(result.postVerified, true); assert.match(result.url, /\/comments\/abc123\//); assert.equal(await page.evaluate(() => window.clicks), 1);
  await page.evaluate(() => { document.querySelector('shreddit-post').setAttribute('permalink', '/r/test/comments/wrong/new_post/'); });
  result = await page.evaluate(async () => { const { verifyRedditPostTool } = await import('/src/agent/tools.ts'); return (await verifyRedditPostTool.execute('verify', {})).details; });
  assert.equal(result.postVerified, false, 'matching title with wrong created ID is not confirmation');
  await page.evaluate(() => { document.querySelector('shreddit-post').setAttribute('permalink', '/r/test/comments/abc123/new_post/'); document.querySelector('shreddit-post').setAttribute('post-title', 'Different title'); });
  result = await page.evaluate(async () => { const { verifyRedditPostTool } = await import('/src/agent/tools.ts'); return (await verifyRedditPostTool.execute('verify', {})).details; });
  assert.equal(result.postVerified, false, 'created ID alone does not verify the intended post');
  await setup();
  await page.evaluate(() => { document.querySelector('button').onclick = () => { window.clicks++; document.body.insertAdjacentHTML('beforeend', '<faceplate-form-helper-text><span>Rate limit exceeded. Please wait 7 minutes and try again</span></faceplate-form-helper-text>'); }; });
  result = await submit(); assert.equal(result.state, 'rate_limited'); assert.equal(result.retryAfterSeconds, 420); assert.equal(result.dispatched, true);
  result = await submit(); assert.equal(result.dispatched, false); assert.equal(await page.evaluate(() => window.clicks), 1);
  const started = Date.now();
  const wait = await page.evaluate(async () => { const { waitSecondsTool } = await import('/src/agent/tools.ts'); return waitSecondsTool.execute('wait', { seconds: 30, reason: 'Reddit rate limit: waiting before retrying post' }); });
  assert.equal(wait.details.state, 'rate_limited'); assert.ok(Date.now() - started < 5000, 'known rate-limit wait loops return immediately');
  await page.evaluate(() => { document.querySelector('faceplate-form-helper-text').remove(); document.body.insertAdjacentHTML('beforeend', '<blockquote>Rate limit exceeded. Please wait 7 minutes and try again</blockquote>'); });
  result = await page.evaluate(async () => { const { verifyRedditPostTool } = await import('/src/agent/tools.ts'); return (await verifyRedditPostTool.execute('verify', {})).details; });
  assert.equal(result.state, 'unconfirmed', 'a quoted rate limit is not a site error');
  await page.evaluate(() => { document.body.insertAdjacentHTML('beforeend', '<div role="alert">Rate limit exceeded.</div>'); });
  result = await page.evaluate(async () => { const { verifyRedditPostTool } = await import('/src/agent/tools.ts'); return (await verifyRedditPostTool.execute('verify', {})).details; });
  assert.equal(result.state, 'rate_limited'); assert.equal(result.retryAfterSeconds, null, 'no invented cooldown duration');
  console.log('PASS Reddit feed redirect confirmation, title/ID checks, inline rate-limit detection, cooldown retry/wait suppression and quoted notice exclusion');
} finally { await browser.close(); }
