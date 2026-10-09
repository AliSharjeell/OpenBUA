import assert from 'node:assert/strict';
const { chromium } = await import(process.env.OPENBUA_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.OPENBUA_CHROME_PATH ? { executablePath: process.env.OPENBUA_CHROME_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 440, height: 850 } });
const prompt = 'go to youtube and search mufeez perspective and comment on first vid saying good';
const title = 'Comment On Mufeez YouTube Video';
let namingCalls = 0;
await page.addInitScript(() => {
  localStorage.setItem('autoform_settings', JSON.stringify({ selectedMode: 'free', activeProvider: 'openai', free: { baseUrl: 'http://127.0.0.1:5173/fake/v1', apiKey: 'test-key', model: 'test-model' } }));
  localStorage.setItem('autoform_chat_sessions', JSON.stringify([{ id: 'existing-chat', title: 'Chat 1', createdAt: 1, updatedAt: 1 }]));
  localStorage.setItem('openbua_last_active_session_id', JSON.stringify('existing-chat'));
});
await page.route('**/fake/v1/chat/completions', async route => {
  const body = route.request().postDataJSON();
  if (body.stream) {
    await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', content: 'Ready.' }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n` });
  } else {
    namingCalls++;
    assert.equal(body.messages[1].content, prompt);
    await route.fulfill({ json: { choices: [{ message: { content: title } }] } });
  }
});
try {
  await page.goto('http://127.0.0.1:5173/sidepanel.html');
  await page.getByTitle('Open Menu', { exact: true }).click();
  await page.getByRole('button', { name: 'New Chat', exact: true }).click();
  const input = page.getByPlaceholder('Ask OpenBUA ? @ to reference files');
  await input.fill(prompt);
  await input.press('Enter');
  await page.waitForFunction(expected => JSON.parse(localStorage.getItem('autoform_chat_sessions')).some(session => session.title === expected), title);
  await page.getByTitle('Open Menu', { exact: true }).click();
  await page.getByText(title, { exact: true }).waitFor({ state: 'visible' });
  assert.equal(namingCalls, 1);
  // Stop the initialization fixture from resetting storage on reload.
  const saved = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
  await page.addInitScript(saved => { for (const [key, value] of Object.entries(saved)) localStorage.setItem(key, value); }, saved);
  await page.reload();
  await page.getByTitle('Open Menu', { exact: true }).click();
  await page.getByText(title, { exact: true }).waitFor({ state: 'visible' });
  assert.equal(namingCalls, 1);
  console.log('PASS new chat first prompt updates the visible sidebar title and persists across reload');
} finally { await browser.close(); }
