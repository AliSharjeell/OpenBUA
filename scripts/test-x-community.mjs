import assert from 'node:assert/strict';
const { chromium } = await import(process.env.OPENBUA_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.OPENBUA_CHROME_PATH ? { executablePath: process.env.OPENBUA_CHROME_PATH } : {}) });
const page = await browser.newPage({ deviceScaleFactor: 2 });
try {
  await page.goto('http://127.0.0.1:5173/test-form.html');
  await page.evaluate(() => {
    history.replaceState({}, '', '/i/communities/123');
    window.chrome = { tabs: { query: (_q, cb) => cb([{ id: 7, url: 'https://x.com/i/communities/123' }]) }, scripting: { executeScript: async injection => [{ result: await new Function(`return (${injection.func.toString()})`)()(...(injection.args || [])) }] } };
  });
  const setup = async (label = 'Join') => page.evaluate(label => {
    history.replaceState({}, '', '/i/communities/123');
    document.body.innerHTML = `<main><button data-autoform-ref="af_12">${label}</button></main>`;
    delete document.documentElement.dataset.openbuaXCommunityAttempts;
    window.clicks = 0; window.downs = 0;
    const button = document.querySelector('button');
    button.onmousedown = () => { window.downs++; button.textContent = button.textContent === 'Join' ? 'Leave' : 'Join'; };
    button.onclick = () => { window.clicks++; button.textContent = button.textContent === 'Join' ? 'Leave' : 'Join'; };
  }, label);
  const action = (params = {}) => page.evaluate(async params => { const { joinXCommunityTool } = await import('/src/agent/tools.ts'); return joinXCommunityTool.execute('join', params); }, params);
  await setup();
  let result = await action(); assert.equal(result.details.state, 'joined'); assert.equal(result.details.dispatched, true);
  assert.deepEqual(await page.evaluate(() => [window.clicks, window.downs]), [1, 0], 'native activation cannot double-toggle via synthetic press handlers');
  result = await action(); assert.equal(result.details.dispatched, false); assert.equal(await page.evaluate(() => window.clicks), 1);
  // A stale Join ref and screenshot coordinates now hit Leave: both are read-only.
  result = await page.evaluate(async () => { const { clickElementTool } = await import('/src/agent/tools.ts'); return clickElementTool.execute('stale', { refId: 'af_12' }); });
  assert.equal(result.details.state, 'joined'); assert.equal(result.details.dispatched, false);
  result = await page.evaluate(async () => { const b = document.querySelector('button').getBoundingClientRect(); const { clickAtPositionTool } = await import('/src/agent/tools.ts'); return clickAtPositionTool.execute('coordinate', { x: (b.x + b.width / 2) * devicePixelRatio, y: (b.y + b.height / 2) * devicePixelRatio }); });
  assert.equal(result.details.dispatched, false); assert.equal(await page.evaluate(() => window.clicks), 1);
  await setup();
  await page.evaluate(() => { document.querySelector('button').onclick = () => { window.clicks++; document.body.insertAdjacentHTML('beforeend', '<div role="dialog">Community rules: stay on topic.<button>Agree and join</button></div>'); const confirm = document.querySelector('[role="dialog"] button'); confirm.onclick = () => { window.clicks++; document.querySelector('[role="dialog"]').remove(); document.querySelector('button').textContent = 'Leave'; }; }; });
  result = await action(); assert.equal(result.details.state, 'rules_required'); assert.match(result.details.rules, /stay on topic/);
  result = await action(); assert.equal(result.details.dispatched, false); assert.equal(await page.evaluate(() => window.clicks), 1);
  result = await action({ confirmRules: true }); assert.equal(result.details.state, 'joined'); assert.equal(await page.evaluate(() => window.clicks), 2);
  for (const label of ['Requested', 'Cancel request']) { await setup(label); result = await action(); assert.equal(result.details.state, 'requested'); assert.equal(result.details.membershipVerified, false); assert.equal(await page.evaluate(() => window.clicks), 0); }
  await setup(); await page.evaluate(() => { document.querySelector('button').disabled = true; });
  result = await action(); assert.equal(result.details.state, 'blocked'); assert.equal(result.details.dispatched, false);
  await setup(); await page.evaluate(() => { document.body.insertAdjacentHTML('beforeend', '<button>Join</button>'); });
  result = await action(); assert.match(result.details.message, /2 independent/); assert.equal(await page.evaluate(() => window.clicks), 0);
  await setup(); await page.evaluate(() => { document.querySelector('button').onclick = () => { window.clicks++; }; });
  result = await action(); assert.equal(result.details.state, 'unconfirmed'); assert.equal(result.details.success, false);
  result = await action(); assert.equal(result.details.dispatched, false); assert.equal(await page.evaluate(() => window.clicks), 1);
  result = await action({ verifyOnly: true }); assert.equal(result.details.dispatched, false);
  await page.evaluate(() => { history.replaceState({}, '', '/i/communities/456'); document.querySelector('button').onclick = () => { window.clicks++; document.querySelector('button').textContent = 'Leave'; }; });
  result = await action(); assert.equal(result.details.state, 'joined'); assert.equal(result.details.communityId, '456', 'attempts are scoped to the community, not every destination');
  await setup(); await page.evaluate(() => { document.querySelector('button').onclick = () => { window.clicks++; setTimeout(() => { document.querySelector('button').textContent = 'Leave'; }, 350); }; });
  const concurrent = await page.evaluate(async () => { const { xCommunityAction } = await import('/src/agent/x-community.ts'); const first = xCommunityAction(7, 'join'); const second = await xCommunityAction(7, 'join'); return [await first, second]; });
  assert.equal(concurrent[0].state, 'joined'); assert.equal(concurrent[1].state, 'pending'); assert.equal(await page.evaluate(() => window.clicks), 1);
  console.log('PASS X single activation, rules confirmation, stale refs/coordinates, pending approval, disabled/ambiguous controls, bounded uncertain attempts and concurrent suppression');
} finally { await browser.close(); }
