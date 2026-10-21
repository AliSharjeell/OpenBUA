import assert from 'node:assert/strict';
import { build } from 'esbuild';

let chromium;
try {
  ({ chromium } = await import('@playwright/test'));
} catch {
  ({ chromium } = await import('file:///C:/AppsNew/nascon-agentika/node_modules/@playwright/test/index.mjs'));
}

async function source(file) {
  const result = await build({ entryPoints: [file], bundle: true, platform: 'node', format: 'esm', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const { inPageControls } = await source('src/agent/page-controls.ts');
const { inPageSelectionControls } = await source('src/agent/selection-controls.ts');
const { imageDimensions, mapScreenshotPoint } = await source('src/agent/screenshot-coordinates.ts');

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.JOBIFY_EXTENSION_CHROME_PATH || 'C:/Users/alish/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
});

try {
  const context = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.route('https://forms.example.test/', route => route.fulfill({ contentType: 'text/html', body: '<title>DOM fixture</title>' }));
  await page.goto('https://forms.example.test/');

  await page.setContent(`<fieldset><legend>Can you work remotely?</legend><label><input id="yes" type="radio" name="remote" checked>Yes</label><label><input type="radio" name="remote">No</label></fieldset>
    <label><input id="locationYes" name="location" type="radio" aria-label="Do you live in the US?">Yes</label><label><input id="locationNo" name="location" type="radio" aria-label="Do you live in the US?">No</label>
    <div><div><input name="wrapped" type="radio" aria-label="Can you relocate?"></div><span>Yes</span></div><div><div><input name="wrapped" type="radio" aria-label="Can you relocate?"></div><span>No</span></div>
    <label for="email">Email address</label><input id="email" aria-describedby="help"><p id="help">Use your preferred contact email.</p>
    <input type="password" value="never-expose-this"><div id="custom" style="cursor:pointer">Open form details</div><custom-controls></custom-controls>
    <button id="covered" style="position:absolute;top:300px;left:20px;width:150px;height:40px">Covered action</button>
    <div style="position:absolute;top:300px;left:20px;width:150px;height:40px;z-index:5;background:black"></div>
    <button style="position:absolute;top:1100px">Offscreen action</button>`);

  await page.evaluate(() => document.querySelector('custom-controls').attachShadow({ mode: 'open' }).innerHTML = '<button aria-label="Shadow action">Open</button>');

  const first = await page.evaluate(inPageControls);
  const find = label => first.controls.find(control => control.label === label);

  assert.equal(find('Yes').group, 'Can you work remotely?');
  assert.equal(find('Yes').checked, true);

  const locationChoices = first.controls.filter(control => control.group === 'Do you live in the US?');
  assert.deepEqual(locationChoices.map(control => control.label), ['Yes', 'No'], 'Question aria-labels must not hide distinct option labels');
  assert.deepEqual(first.controls.filter(control => control.group === 'Can you relocate?').map(control => control.label), ['Yes', 'No'], 'Nested unlabeled inputs use the nearest single-choice text');

  const choices = await page.evaluate(inPageSelectionControls);
  assert.deepEqual(choices.controls.filter(control => control.group === 'Do you live in the US?').map(control => control.label), ['Yes', 'No']);
  assert.deepEqual(choices.controls.filter(control => control.group === 'Can you relocate?').map(control => control.label), ['Yes', 'No']);

  assert.equal(find('Email address').description, 'Use your preferred contact email.');
  assert.equal(find('Shadow action').hitTest.actionable, true);
  assert.ok(find('Open form details'), 'Custom pointer controls are part of the DOM inventory');
  assert.equal(find('Covered action').hitTest.actionable, false);
  assert.equal(find('Offscreen action').hitTest.needsScroll, true);
  assert.equal(find('Yes').rect.coordinateSpace, 'css-viewport');
  assert.ok(!JSON.stringify(first).includes('never-expose-this'));

  const second = await page.evaluate(inPageControls);
  assert.equal(second.controls.find(control => control.label === 'Shadow action').refId, find('Shadow action').refId);

  await page.setContent(`<section><p>Can you complete a background check and drug screening?</p><div><div><div><label><div><div><input type="checkbox" id="deep-yes"></div></div><span>Yes</span></label></div><div><label><div><div><input type="checkbox"></div></div><span>No</span></label></div></div></div></section><section><p>Do you accept travel?</p><label><input type="checkbox">Yes</label><label><input type="checkbox">No</label></section>`);
  const deep = await page.evaluate(inPageControls);
  assert.deepEqual(deep.controls.filter(control => control.label === 'Yes').map(control => control.group), ['Can you complete a background check and drug screening?', 'Do you accept travel?']);

  const deepChoices = await page.evaluate(inPageSelectionControls);
  assert.deepEqual(deepChoices.controls.filter(control => control.label === 'Yes').map(control => control.group), ['Can you complete a background check and drug screening?', 'Do you accept travel?']);

  await page.setContent('<section><p>Question one?</p><p>Question two?</p><label><input type="checkbox">Yes</label><label><input type="checkbox">No</label></section>');
  assert.equal((await page.evaluate(inPageControls)).controls.find(control => control.label === 'Yes').group, undefined, 'Ambiguous question groups must remain unknown');

  await page.setContent('<div><label>Have you built an agent?</label><div><button aria-pressed="true">Yes</button><button aria-pressed="false">No</button></div></div><div><label>Can you relocate?</label><button>Yes</button><button>No</button></div>');
  const binary = await page.evaluate(inPageControls);
  assert.deepEqual(binary.controls.filter(control => control.label === 'Yes').map(control => control.group), ['Have you built an agent?', 'Can you relocate?']);
  assert.equal(binary.controls.find(control => control.label === 'Yes').pressed, 'true');

  await page.setContent(`<select aria-label="School">${Array.from({length:2467},(_,i)=>`<option value="${i}">${i===2200?'FAST NUCES Karachi':`School ${i}`}</option>`).join('')}</select>`);
  const searchedOptions = await page.evaluate(inPageControls, { optionQuery: 'fast nuces' });
  assert.equal(searchedOptions.controls[0].optionTotal, 2467);
  assert.equal(searchedOptions.controls[0].optionMatchTotal, 1);
  assert.deepEqual(searchedOptions.controls[0].options.map(option => option.label), ['FAST NUCES Karachi']);
  assert.equal(searchedOptions.controls[0].nextOptionOffset, null);
  assert.equal((await page.evaluate(inPageControls, { optionQuery: 'nonexistent university' })).controls[0].options.length, 0, 'Never invent missing select options');

  await page.setContent('<iframe title="Application" src="https://jobs.ashbyhq.com/example/job-id?embed=js"></iframe><iframe src="https://untrusted.example/frame"></iframe>');
  const embedded = await page.evaluate(inPageControls);
  assert.equal(embedded.frames[0].applicationUrl, 'https://jobs.ashbyhq.com/example/job-id?embed=js');
  assert.equal(embedded.frames[1].applicationUrl, undefined, 'Only recognized employer frames get application navigation hints');

  // Verify screenshot dimensions and coordinate mapping
  const png1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  assert.deepEqual(imageDimensions(png1x1), { width: 1, height: 1 });

  const viewport = { width: 800, height: 600, devicePixelRatio: 2, scrollX: 0, scrollY: 0, scale: 1, url: 'https://forms.example.test/', documentId: 'doc-1' };
  const geometry = { imageWidth: 1600, imageHeight: 1200, viewport, capturedAt: 100_000 };
  assert.deepEqual(mapScreenshotPoint(geometry, viewport, 400, 300, 110_000), { cssX: 200, cssY: 150 });
  assert.throws(() => mapScreenshotPoint(geometry, { ...viewport, scrollY: 10 }, 400, 300, 110_000), /stale/);
  assert.throws(() => mapScreenshotPoint(geometry, viewport, 400, 300, 170_000), /stale/);

  console.log('PASS: labeled/grouped/shadow DOM targets, custom controls, occlusion, stable refs, password redaction, actual PNG/JPEG dimensions and stale coordinate rejection.');
} finally {
  await browser.close();
}
