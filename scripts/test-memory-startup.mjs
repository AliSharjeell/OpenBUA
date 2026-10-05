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
let holdBlob = false;
const stalledWrites = [];
const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function waitForStalledWrite() {
  for (let i = 0; i < 100 && !stalledWrites.length; i++) await pause(5);
  assert(stalledWrites.length, 'test migration reached the deliberately stalled blob transaction');
}
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
      if (holdBlob) stalledWrites.push(() => tx.oncomplete?.());
      else setTimeout(() => tx.oncomplete?.(), 0);
    }, delete(key) { blobs.delete(key); } }) };
    return tx;
  } };
  setTimeout(() => request.onsuccess(), 0);
  return request;
} };
const nativeAtob = globalThis.atob;
globalThis.atob = (...args) => { conversions++; return nativeAtob(...args); };
const video = { id: 'legacy-video', type: 'video', title: 'Saved clip', content: 'Video description',
  isActiveForContext: true, thumbnailUrl: 'data:image/jpeg;base64,dGh1bWI=', videoDuration: 88,
  dataUrl: 'data:video/mp4;base64,' + Buffer.from('original video bytes').toString('base64') };
try {
  const storage = await import(pathToFileURL(output).href);
  stored.autoform_global_memory = [video];
  const [first, concurrent] = await Promise.all([storage.loadGlobalMemories(), storage.loadGlobalMemories()]);
  assert.equal(reads, 1, 'concurrent startup readers share one storage read');
  assert.equal(conversions, 0, 'startup reads never decode legacy video bytes');
  assert.deepEqual(first, concurrent);
  assert.equal(first[0].dataUrl, video.dataUrl, 'legacy attachment stays usable before maintenance');
  holdBlob = true;
  const migration = storage.migrateGlobalMemoryMedia(first);
  const duplicateMigration = storage.migrateGlobalMemoryMedia(first);
  await waitForStalledWrite();
  const whileStalled = await Promise.race([
    storage.loadGlobalMemories(),
    pause(100).then(() => { throw new Error('Startup waited for a stalled blob store'); }),
  ]);
  assert.equal(whileStalled[0].dataUrl, video.dataUrl, 'startup loads while IndexedDB remains stalled');
  await storage.toggleGlobalMemoryActive(video.id);
  stalledWrites.shift()();
  holdBlob = false;
  const compacted = await migration;
  assert.deepEqual(compacted, await duplicateMigration);
  assert.equal(conversions, 1, 'duplicate maintenance callers migrate only once');
  assert(!compacted[0].dataUrl, 'maintenance removes inline bytes after committing the blob');
  assert.equal(compacted[0].isActiveForContext, false, 'migration preserves a concurrent memory toggle');
  assert.equal(compacted[0].thumbnailUrl, video.thumbnailUrl);
  assert.equal(compacted[0].videoDuration, 88);
  assert.equal(compacted[0].content, video.content);
  assert.equal(await blobs.get(compacted[0].blobKey).text(), 'original video bytes');
  assert(!stored.autoform_global_memory[0].dataUrl, 'persistent memory list contains metadata only');
  await storage.loadGlobalMemories();
  assert.equal(conversions, 1, 'later launches never decode migrated video bytes');

  const image = { ...video, id: 'small-image', type: 'image', dataUrl: 'data:image/png;base64,cGl4ZWxz' };
  await storage.saveTabMemory('chat', image);
  assert.equal((await storage.loadTabMemories('chat'))[0].dataUrl, image.dataUrl, 'small images remain inline');
  await storage.saveTabMemory('chat', { ...video, id: 'chat-video' });
  assert((await storage.loadTabMemories('chat'))[0].blobKey, 'new video saves are compact too');

  const large = { ...image, id: 'large-image', dataUrl: 'data:image/png;base64,' + Buffer.alloc(2400000, 7).toString('base64') };
  let responsiveTicks = 0;
  const responsivenessTimer = setInterval(() => responsiveTicks++, 0);
  try {
    await storage.saveGlobalMemory(large);
  } finally {
    clearInterval(responsivenessTimer);
  }
  const largeSaved = stored.autoform_global_memory.find(doc => doc.id === large.id);
  assert(!largeSaved.dataUrl);
  assert.equal(blobs.get(largeSaved.blobKey).size, 2400000, 'large attachments migrate without truncation');
  assert(Buffer.from(await blobs.get(largeSaved.blobKey).arrayBuffer()).equals(Buffer.alloc(2400000, 7)), 'decoded bytes match across batch boundaries');
  assert(responsiveTicks > 1, 'large conversion yields repeatedly to the event loop');

  // Deleting a memory while decoding must not resurrect it or retain its new blob.
  stored.autoform_global_memory = [video];
  holdBlob = true;
  const deletedMigration = storage.migrateGlobalMemoryMedia([video]);
  await waitForStalledWrite();
  await storage.deleteGlobalMemory(video.id);
  const deletedBlobKey = [...blobs.keys()].at(-1);
  stalledWrites.shift()();
  holdBlob = false;
  assert.deepEqual(await deletedMigration, []);
  assert(!blobs.has(deletedBlobKey), 'unused migration blob is cleaned up after concurrent deletion');

  // An old migration cannot overwrite bytes for a replacement with the same id.
  stored.autoform_global_memory = [video];
  holdBlob = true;
  const replacedMigration = storage.migrateGlobalMemoryMedia([video]);
  await waitForStalledWrite();
  holdBlob = false;
  await storage.saveGlobalMemory({ ...video, title: 'New clip', dataUrl: 'data:video/mp4;base64,' + Buffer.from('new video bytes').toString('base64') });
  stalledWrites.shift()();
  const replacement = (await replacedMigration)[0];
  assert.equal(replacement.title, 'New clip');
  assert.equal(await blobs.get(replacement.blobKey).text(), 'new video bytes');

  failBlob = true;
  stored.autoform_global_memory = [video];
  assert.equal((await storage.loadGlobalMemories())[0].dataUrl, video.dataUrl);
  assert.equal((await storage.migrateGlobalMemoryMedia([video]))[0].dataUrl, video.dataUrl, 'blob failure preserves inline attachment');
  assert.equal(stored.autoform_global_memory[0].dataUrl, video.dataUrl);
  failBlob = false;
  failMetadata = true;
  const blobsBeforeFailedMetadata = blobs.size;
  await assert.rejects(storage.migrateGlobalMemoryMedia([video]), /quota failure/);
  assert.equal(blobs.size, blobsBeforeFailedMetadata, 'failed migration does not retain another full video blob');
  assert.equal((await storage.loadGlobalMemories())[0].dataUrl, video.dataUrl, 'startup still loads after failed maintenance');
  assert.equal(stored.autoform_global_memory[0].dataUrl, video.dataUrl, 'failed metadata save leaves original storage untouched');
  await assert.rejects(storage.saveSettings(storage.DEFAULT_SETTINGS), /quota failure/);
  failMetadata = false;
  assert((await storage.migrateGlobalMemoryMedia([video]))[0].blobKey, 'migration can retry after failure');
  console.log('PASS memory startup migration, repeat loads, preserved bytes, and failure recovery');
} finally {
  globalThis.atob = nativeAtob;
  delete globalThis.chrome;
  delete globalThis.indexedDB;
  rmSync(output, { force: true });
}
