import assert from 'node:assert/strict';
const { chromium } = await import(process.env.OPENBUA_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.OPENBUA_CHROME_PATH ? { executablePath: process.env.OPENBUA_CHROME_PATH } : {}) });
const page = await browser.newPage();
try {
  await page.goto('http://127.0.0.1:5173/test-form.html');
  await page.evaluate(() => {
    document.body.innerHTML = '<r-post-flairs-modal></r-post-flairs-modal><input type="radio" aria-label="Outside choice">';
    const modal = document.querySelector('r-post-flairs-modal');
    modal.attachShadow({ mode: 'open' }).innerHTML = '<faceplate-radio-input></faceplate-radio-input><div role="radio" aria-checked="false" tabindex="0">Discussion</div><button>Add</button>';
    const radio = modal.shadowRoot.querySelector('faceplate-radio-input');
    radio.attachShadow({ mode: 'open' }).innerHTML = '<label for="story">Ride Along Story</label><input style="display:none" type="radio" id="story">';
    modal.shadowRoot.querySelector('[role="radio"]').onclick = event => event.currentTarget.setAttribute('aria-checked', 'true');
    window.chrome = { tabs: { query: (_q, callback) => callback([{ id: 7, url: location.href }]) }, scripting: { executeScript: async injection => [{ result: await new Function(`return (${injection.func.toString()})`)()(...(injection.args || [])) }] } };
  });
  const inspect = selector => page.evaluate(async selector => {
    const { getActiveTabFormTool } = await import('/src/agent/tools.ts');
    return getActiveTabFormTool.execute('inspect', { selector });
  }, selector);
  let result = await inspect('[role="dialog"]');
  assert.equal(result.details.scopeFound, false);
  assert.match(result.content[0].text, /Requested scope was not found/);
  assert.deepEqual(result.details.selectionControls.map(item => item.label), ['Ride Along Story', 'Discussion']);
  const story = result.details.selectionControls.find(item => item.label === 'Ride Along Story');
  assert.equal(story.selected, false);
  await page.evaluate(async refId => {
    const { clickElementTool } = await import('/src/agent/tools.ts');
    const result = await clickElementTool.execute('choose', { refId });
    if (!result.details.success) throw new Error(JSON.stringify(result));
  }, story.refId);
  result = await inspect();
  assert.equal(result.details.selectionControls.find(item => item.label === 'Ride Along Story').selected, true);
  assert.equal(result.details.selectionControls.find(item => item.label === 'Ride Along Story').refId, story.refId);
  assert.match(result.content[0].text, /Ride Along Story.*SELECTED/);
  await page.evaluate(() => {
    document.body.innerHTML = '<div role="listbox"><div role="option" aria-selected="true">Karachi</div><div role="option" aria-disabled="true">Unavailable</div></div>';
  });
  result = await inspect();
  assert.equal(result.details.selectionControls[0].selected, true);
  assert.equal(result.details.selectionControls[1].disabled, true);
  console.log('PASS custom shadow flair choices, hidden native radio activation, missing-scope recovery, persistent refs and generic listbox states');
} finally { await browser.close(); }
