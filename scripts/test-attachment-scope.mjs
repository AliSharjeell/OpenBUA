import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { writeFileSync, rmSync } from 'node:fs';
const output = new URL('../.tmp-attachment-scope.mjs', import.meta.url);
const result = await build({ stdin: { contents: `export {resolveStoredFile} from './src/agent/browser-bridge'; export {setActiveSessionIdState, getActiveContextMemories} from './src/services/storage';`, resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
writeFileSync(output, result.outputFiles[0].text);
const doc = (id, fileName, extra = {}) => ({ id, title: fileName.replace(/\.[^.]+$/, ''), fileName, type: 'pdf', content: 'resume text', dataUrl: 'data:application/pdf;base64,cGRm', isActiveForContext: true, createdAt: 1, ...extra });
const stored = { autoform_global_memory: [doc('old', 'resume.pdf')], autoform_tab_mem_session_job: [doc('new', 'resume.pdf', {tabUrlPattern: 'session_job', createdAt: 2})], autoform_tab_mem_tab_123: [doc('wrong-tab', 'elsewhere.pdf')] };
globalThis.chrome = { runtime: {id: 'test', lastError: null}, tabs: { query(_query, cb) {cb([{id: 123, url: 'https://www.linkedin.com/jobs/view/1'}]);}}, storage: {local: {get(keys, cb) {cb(Object.fromEntries(keys.map(k => [k, stored[k]])));}}}};
try {
  const api = await import(output.href);
  api.setActiveSessionIdState('session_job');
  assert.equal((await api.resolveStoredFile({fileName: 'resume.pdf'})).doc.id, 'new');
  assert.equal((await api.resolveStoredFile({fileName: 'new'})).doc.id, 'new');
  assert.equal(await api.resolveStoredFile({fileName: 'missing.pdf'}), null);
  assert.equal(await api.resolveStoredFile({fileName: 'elsewhere.pdf'}), null);
  assert.equal((await api.getActiveContextMemories('session_job')).length, 2);
  stored.autoform_tab_mem_session_job[0].isActiveForContext = false;
  assert.equal((await api.resolveStoredFile({fileName: 'resume.pdf'})).doc.id, 'old');
  console.log('PASS session attachment lookup, current-session precedence, exact ID, missing-file isolation and inactive memory');
} finally {rmSync(output, {force: true});}
