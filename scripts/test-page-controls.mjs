import assert from 'node:assert/strict';
const { chromium } = await import(process.env.OPENBUA_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.OPENBUA_CHROME_PATH ? { executablePath: process.env.OPENBUA_CHROME_PATH } : {}) });
const page = await browser.newPage();
try {
  await page.goto('http://127.0.0.1:5173/test-form.html');
  await page.evaluate(() => {
    document.body.innerHTML = `<label for="email">Email address</label><input id="email" type="email" required value="bad-email">
      <input type="password" value="do-not-expose-secret"><input type="file" style="display:none" accept="application/pdf">
      <select aria-label="City">${Array.from({ length: 150 }, (_, i) => `<option value="city-${i}" ${i === 145 ? 'selected' : ''}>City ${i}</option>`).join('')}</select>
      <button disabled>Unavailable</button><button aria-label="Open settings"><svg></svg></button>
      <a href="/next">Continue reading</a><div role="switch" aria-checked="true" tabindex="0">Notifications</div>
      <div role="combobox" aria-expanded="true" aria-haspopup="listbox" tabindex="0">Choose a city</div>
      <div contenteditable="true" aria-label="Post body">Existing body</div>
      <label for="hidden-check">Subscribe</label><input id="hidden-check" type="checkbox" style="display:none">
      <div style="display:none"><button>Hidden action</button></div>
      <div inert><button>Inert action</button></div><custom-dialog></custom-dialog>
      <div id="many">${Array.from({ length: 130 }, (_, i) => `<button>Action ${i}</button>`).join('')}</div>
      <iframe title="Embedded form" src="about:blank"></iframe><canvas></canvas>`;
    document.querySelector('custom-dialog').attachShadow({ mode: 'open' }).innerHTML = '<section role="dialog" aria-label="Choices"><inner-options></inner-options><button id="apply">Apply selection</button></section>';
    document.querySelector('custom-dialog').shadowRoot.querySelector('inner-options').attachShadow({ mode: 'open' }).innerHTML = '<div role="option" aria-selected="true">Ride Along Story</div><input aria-label="Search choices">';
    document.querySelector('custom-dialog').shadowRoot.querySelector('#apply').onclick = () => { window.applied = true; };
    window.chrome = { tabs: { query: (_q, callback) => callback([{ id: 7, url: location.href }]) }, scripting: { executeScript: async injection => [{ result: await new Function(`return (${injection.func.toString()})`)()(...(injection.args || [])) }] } };
  });
  const inspect = params => page.evaluate(async params => {
    const { inspectPageControlsTool } = await import('/src/agent/tools.ts');
    return (await inspectPageControlsTool.execute('inspect', params)).details;
  }, params);
  let result = await inspect({ limit: 25 });
  const controls = [...result.controls];
  while (result.nextOffset !== null) {
    result = await inspect({ offset: result.nextOffset, limit: 25 });
    controls.push(...result.controls);
  }
  assert.equal(controls.length, result.total);
  assert.equal(new Set(controls.map(item => item.refId)).size, controls.length);
  const find = label => controls.find(item => item.label === label);
  assert.equal(find('Email address').required, true);
  assert.equal(find('Email address').invalid, true);
  assert.ok(find('Email address').validationMessage);
  assert.equal(controls.find(item => item.type === 'password').value, '[redacted]');
  assert.equal(JSON.stringify(controls).includes('do-not-expose-secret'), false);
  assert.equal(controls.find(item => item.type === 'file').accept, 'application/pdf');
  assert.equal(find('Unavailable').disabled, true);
  assert.equal(find('Inert action').disabled, true);
  assert.equal(find('Hidden action'), undefined);
  assert.equal(find('Notifications').checked, 'true');
  assert.equal(find('Choose a city').expanded, 'true');
  assert.equal(find('Post body').value, 'Existing body');
  assert.equal(find('Action 129').inViewport, false);
  assert.equal(find('Ride Along Story').selected, 'true');
  assert.equal(find('Apply selection').popup.label, 'Choices');
  assert.equal(result.frames[0].title, 'Embedded form');
  const city = find('City');
  assert.equal(city.optionTotal, 150);
  assert.equal(city.options.length, 100);
  assert.equal(city.nextOptionOffset, 100);
  const remaining = await inspect({ selector: city.selector, optionOffset: city.nextOptionOffset });
  assert.equal(remaining.controls[0].refId, city.refId);
  assert.equal(remaining.controls[0].options.length, 50);
  assert.equal(remaining.controls[0].options.find(item => item.selected).label, 'City 145');
  assert.equal((await inspect({ selector: '#missing-popup' })).scopeFound, false);
  await page.evaluate(async assignments => {
    const { fillFormFieldsTool } = await import('/src/agent/tools.ts');
    const result = await fillFormFieldsTool.execute('fill', { assignments });
    if (result.details.errors?.length) throw new Error(JSON.stringify(result));
  }, [{ refId: find('Email address').refId, value: 'tester@example.com' }, { refId: city.refId, value: 'city-5' }]);
  assert.equal(await page.evaluate(() => document.querySelector('#email').value), 'tester@example.com');
  assert.equal(await page.evaluate(() => document.querySelector('select').value), 'city-5');
  for (const label of ['Apply selection', 'Subscribe']) {
    await page.evaluate(async refId => {
      const { clickElementTool } = await import('/src/agent/tools.ts');
      const result = await clickElementTool.execute('click', { refId });
      if (!result.details.success) throw new Error(JSON.stringify(result));
    }, find(label).refId);
  }
  assert.equal(await page.evaluate(() => window.applied), true);
  assert.equal(await page.evaluate(() => document.querySelector('#hidden-check').checked), true);
  const again = await inspect({ selector: find('Apply selection').selector });
  assert.equal(again.controls[0].refId, find('Apply selection').refId);
  console.log('PASS full paginated control inventory, dropdown option paging, live states, shadow targets, hidden checkbox/upload controls, password redaction and exact-ref activation');
} finally { await browser.close(); }
