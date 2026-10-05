import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const output = fileURLToPath(new URL('../.tmp-memory-startup-test.mjs', import.meta.url));
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/services/storage.ts', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent',
});
writeFileSync(output, bundle.outputFiles[0].text);
const stored = {};
const blobs = new Map();
let reads = 0, conversions = 0, failBlob = false, failMetadata = false;
globalThis.chrome = { runtime: { lastError: null }, storage: { local: {
  get(keys, callback) {
    reads++;
    setTimeout(() => callback(Object.fromEntries(keys.map(key => [key, structuredClone(stored[key])]))), 0);
  },
  set(values, callback) {
    setTimeout(() => {
      chrome.runtime.lastError = failMetadata ? { message: 'Simulated quota failure' } : null;
      if (!failMetadata) Object.assign(stored, structuredClone(values));
      callback();
      chrome.runtime.lastError = null;
    }, 0);
  },
} } };
globalThis.indexedDB = { open() {
  const request = {};
  request.result = { transaction() {
    if (failBlob) throw new Error('Simulated blob-store failure');
    const tx = { objectStore: () => ({ put(blob, key) {
      blobs.set(key, blob);
      setTimeout(() => tx.oncomplete?.(), 0);
    } }) };
    return tx;
  } };
  setTimeout(() => request.onsuccess(), 0);
  return request;
} };
const nativeFetch = globalThis.fetch;
globalThis.fetch = (...args) => { conversions++; return nativeFetch(...args); };
const video = { id: 'legacy-video', type: 'video', title: 'Saved clip', content: 'Video description',
  isActiveForContext: true, thumbnailUrl: 'data:image/jpeg;base64,dGh1bWI=', videoDuration: 88,
  dataUrl: 'data:video/mp4;base64,' + Buffer.from('original video bytes').toString('base64') };
try {
  const storage = await import(pathToFileURL(output).href);
  stored.autoform_global_memory = [video];
  const [first, concurrent] = await Promise.all([storage.loadGlobalMemories(), storage.loadGlobalMemories()]);
  assert.equal(reads, 1, 'concurrent startup readers share one storage read');
  assert.equal(conversions, 1, 'concurrent readers migrate only once');
  assert.deepEqual(first, concurrent);
  assert(!first[0].dataUrl, 'startup state does not retain inline video bytes');
  assert.equal(first[0].thumbnailUrl, video.thumbnailUrl);
  assert.equal(first[0].videoDuration, 88);
  assert.equal(first[0].content, video.content);
  assert.equal(await blobs.get(first[0].blobKey).text(), 'original video bytes');
  assert(!stored.autoform_global_memory[0].dataUrl, 'persistent memory list contains metadata only');
  await storage.loadGlobalMemories();
  assert.equal(conversions, 1, 'later launches never decode migrated video bytes');

  const image = { ...video, id: 'small-image', type: 'image', dataUrl: 'data:image/png;base64,cGl4ZWxz' };
  await storage.saveTabMemory('chat', image);
  assert.equal((await storage.loadTabMemories('chat'))[0].dataUrl, image.dataUrl, 'small images remain inline');
  await storage.saveTabMemory('chat', { ...video, id: 'chat-video' });
  assert((await storage.loadTabMemories('chat'))[0].blobKey, 'new video saves are compact too');

  const large = { ...image, id: 'large-image', dataUrl: 'data:image/png;base64,' + Buffer.alloc(2400000, 7).toString('base64') };
  await storage.saveGlobalMemory(large);
  const largeSaved = stored.autoform_global_memory.find(doc => doc.id === large.id);
  assert(!largeSaved.dataUrl);
  assert.equal(blobs.get(largeSaved.blobKey).size, 2400000, 'large attachments migrate without truncation');

  failBlob = true;
  stored.autoform_global_memory = [video];
  assert.equal((await storage.loadGlobalMemories())[0].dataUrl, video.dataUrl, 'blob failure preserves inline attachment');
  assert.equal(stored.autoform_global_memory[0].dataUrl, video.dataUrl);
  failBlob = false;
  failMetadata = true;
  const usable = await storage.loadGlobalMemories();
  assert(usable[0].blobKey, 'metadata write failure does not block startup');
  assert.equal(stored.autoform_global_memory[0].dataUrl, video.dataUrl, 'failed metadata save leaves original storage untouched');
  await assert.rejects(storage.saveSettings(storage.DEFAULT_SETTINGS), /quota failure/, 'normal writes expose failure');
  failMetadata = false;
  assert((await storage.loadGlobalMemories())[0].blobKey, 'migration can retry after failure');
  console.log('PASS memory startup migration, repeat loads, preserved bytes, and failure recovery');
} finally {
  globalThis.fetch = nativeFetch;
  delete globalThis.chrome;
  delete globalThis.indexedDB;
  rmSync(output, { force: true });
}
