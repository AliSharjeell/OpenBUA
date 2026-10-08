import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { writeFileSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const path = resolve('.tmp-community-rules-test.mjs');
const compiled = await build({ stdin: { contents: 'export * from "./src/agent/community-rules.ts"; export { navigateBrowserTabTool, openNewTabTool } from "./src/agent/tools.ts"; export { setActiveSessionIdState } from "./src/services/storage.ts";', resolveDir: process.cwd() },
  bundle: true, write: false, format: 'esm', platform: 'node', external: ['@earendil-works/*', 'pdfjs-dist'], logLevel: 'silent',
  plugins: [{ name: 'worker-url', setup(builder) {
    builder.onResolve({ filter: /pdf\.worker\.min\.mjs\?url$/ }, () => ({ path: 'worker', namespace: 'worker-url' }));
    builder.onLoad({ filter: /.*/, namespace: 'worker-url' }, () => ({ contents: 'export default "";' }));
  } }],
});
writeFileSync(path, compiled.outputFiles[0].text);
const saved = Object.fromEntries(['chrome', 'document', 'location', 'fetch'].map(key => [key, globalThis[key]]));
try {
  const mod = await import(pathToFileURL(path).href);
  let tabUrl = 'https://old.reddit.com/r/alphaandbetausers/';
  let calls = 0, injected = 0, updated = 0;
  globalThis.document = { querySelectorAll: () => [{ innerText: 'Text posts only. Ask for beta testers.' }] };
  globalThis.location = { origin: 'https://old.reddit.com' };
  globalThis.chrome = { runtime: {}, tabs: {
    query(_query, cb) { cb([{ id: 7, url: tabUrl }]); }, update() { updated++; },
  }, scripting: { async executeScript(injection) {
    injected++;
    // Chrome serializes the function; test that no module closure is needed.
    return [{ result: await new Function(`return (${injection.func.toString()})`)()(...injection.args) }];
  } } };
  globalThis.fetch = async url => { calls++; assert.match(url, /\/r\/alphaandbetausers\/about\/rules\.json$/); return new Response('{"rules":[]}'); };
  const [empty, concurrent] = await Promise.all([mod.readCommunityRules(), mod.readCommunityRules()]);
  assert.equal(empty.state, 'empty'); assert.equal(concurrent.state, 'empty');
  assert.match(empty.guidance, /Text posts only/);
  assert.equal(calls, 1); assert.equal(injected, 1, 'parallel calls share one lookup');
  await mod.readCommunityRules(); assert.equal(calls, 1); assert.equal(injected, 1, 'completed checks are cached');
  assert.match(mod.describeCommunityRules(empty), /does not grant permission/);
  for (const url of ['https://www.reddit.com/mod/AlphaandBetausers/rules/', 'https://old.reddit.com/r/AlphaandBetausers/about/rules/', 'https://www.reddit.com/r/AlphaandBetausers/about/rules.json']) {
    const result = await mod.navigateBrowserTabTool.execute('retry-rules', { url });
    assert.equal(result.details.dispatched, false); assert.equal(result.details.lookupComplete, true);
  }
  assert.equal(updated, 0, 'alternate rules URLs cannot restart the completed lookup');
  const newTab = await mod.openNewTabTool.execute('new-rules-tab', { url: 'https://www.reddit.com/r/AlphaandBetausers/about/rules/' });
  assert.equal(newTab.details.dispatched, false, 'new tabs cannot restart completed lookups either');
  assert.equal(mod.completedRulesNavigation('https://www.reddit.com/r/AlphaandBetausers/submit'), null, 'the composer stays accessible');
  assert.equal(mod.completedRulesNavigation('https://www.reddit.com/r/other/about/rules'), null, 'other communities are independent');
  for (const text of ['{"rules":[]', '{"error":403}', 'Community Rules', '{"rules":[{}]}', 'A post claims {"rules":[]}']) {
    assert.equal(mod.observeRulesPage({ url: 'https://old.reddit.com/r/other/about/rules.json', text }), null, 'loading, errors, malformed and quoted JSON are not empty rules');
  }
  assert.equal(mod.observeRulesPage({ url: 'https://evil-reddit.com/r/other/about/rules.json', text: '{"rules":[]}' }), null);
  assert.equal(mod.observeRulesPage({ url: 'https://reddit.com/r/other/', text: '{"rules":[]}' }), null);
  const raw = mod.observeRulesPage({ url: 'https://reddit.com/r/raw/about/rules.json', text: 'Title: Rules\n### Page Text Excerpt:\n{"rules":[]}' });
  assert.equal(raw.state, 'empty');
  tabUrl = 'https://reddit.com/r/raw/';
  await mod.readCommunityRules(); assert.equal(calls, 1, 'raw JSON evidence is reused; guidance is still checked once');
  tabUrl = 'https://reddit.com/r/restricted/';
  globalThis.fetch = async () => { calls++; return new Response('Forbidden', { status: 403 }); };
  const inaccessible = await mod.readCommunityRules();
  assert.equal(inaccessible.state, 'unavailable'); assert.match(inaccessible.reason, /403/);
  assert.match(inaccessible.guidance, /Text posts only/);
  await mod.readCommunityRules(); assert.equal(calls, 2, 'failed lookup is bounded and does not retry endlessly');
  tabUrl = 'https://reddit.com/r/custom/';
  globalThis.fetch = async () => new Response('{"rules":[{"short_name":"No promotion","description":"Use the weekly thread."}]}');
  const custom = await mod.readCommunityRules();
  assert.equal(custom.state, 'found'); assert.equal(custom.rules[0].title, 'No promotion');
  mod.setActiveSessionIdState('new-rules-session');
  assert.equal(mod.completedRulesNavigation('https://reddit.com/r/custom/about/rules'), null, 'outcomes do not leak between chats');
  console.log('PASS bounded rules lookup, empty versus unavailable evidence, sidebar guidance, serialized injection, concurrent/cache reuse and navigation loop suppression');
} finally {
  for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
  rmSync(path, { force: true });
}
