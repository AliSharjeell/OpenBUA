import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { writeFileSync, rmSync } from 'node:fs';
const out = new URL('../.tmp-reference-test.mjs', import.meta.url);
const built = await build({entryPoints:['src/services/attachment-references.ts'], bundle:true, write:false, format:'esm', platform:'node'});
writeFileSync(out, built.outputFiles[0].text);
try {
  const {attachmentReferences, referencedAttachments} = await import(out.href);
  const docs = [
    {id:'resume', fileName:'Ali resume.pdf', title:'Ali resume', type:'pdf', dataUrl:'data:application/pdf;base64,cGRm', createdAt:3},
    {id:'pic2', fileName:'photo 2.png', type:'image', title:'photo 2', blobKey:'media:pic2', createdAt:2},
    {id:'pic1', fileName:'photo.png', type:'image', title:'photo', dataUrl:'data:image/png;base64,cGlj', createdAt:1},
    {id:'text-only', type:'text', title:'notes', content:'hello', createdAt:4},
  ];
  assert.equal(attachmentReferences(docs)[1].alias, 'img2');
  assert.deepEqual(referencedAttachments('Read @img2 and @"Ali resume.pdf"', docs).map(r=>r.doc.id), ['pic2','resume']);
  assert.deepEqual(referencedAttachments('Describe @photo.png, then apply with Ali resume.pdf', docs).map(r=>r.doc.id), ['pic1','resume']);
  assert.equal(referencedAttachments('@img20 @missing.pdf', docs).length, 0);
  assert.equal(referencedAttachments('@img2 @"photo 2.png"', docs).length, 1);
  assert.equal(referencedAttachments('Use my attached resume', docs)[0].doc.id, 'resume');
  assert.equal(referencedAttachments('Describe this image', docs)[0].doc.id, 'pic2');
  assert.equal(referencedAttachments('Read my @missing.pdf file', docs).length, 0);
  console.log('PASS media aliases, quoted filenames, plain filename mentions, deduplication and missing references');
} finally {rmSync(out, {force:true});}
