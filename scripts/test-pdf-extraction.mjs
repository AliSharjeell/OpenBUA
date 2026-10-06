import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { writeFileSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const output = fileURLToPath(new URL('../.tmp-pdf-extraction-test.mjs', import.meta.url));
const workerUrl = new URL('../node_modules/pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/services/pdf-parser.ts', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent',
  external: ['pdfjs-dist'],
  plugins: [{ name: 'worker-url', setup(builder) {
    builder.onResolve({ filter: /pdf\.worker\.min\.mjs\?url$/ }, () => ({ path: 'worker', namespace: 'worker-url' }));
    builder.onLoad({ filter: /.*/, namespace: 'worker-url' }, () => ({ contents: `export default ${JSON.stringify(workerUrl)};` }));
  } }],
});
writeFileSync(output, bundle.outputFiles[0].text);

// A real PDF with correct byte offsets exercises PDF.js and its matching worker.
function makePdf(text) {
  const stream = `BT /F1 12 Tf 50 750 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new File([pdf], 'resume.pdf', { type: 'application/pdf' });
}

try {
  const parser = await import(pathToFileURL(output).href);
  const text = 'Jane Doe - Software Engineer - Work Experience - Education - JavaScript';
  const file = makePdf(text);
  assert.equal(await parser.extractTextFromPdf(file), `### Page 1\n${text}`);

  // Already-saved, incorrectly extracted attachments can be decoded again.
  const saved = { type: 'pdf', title: 'resume', fileName: file.name, mimeType: file.type,
    ocrStatus: 'done', content: '\ufffd corrupted old extraction',
    dataUrl: `data:application/pdf;base64,${Buffer.from(await file.arrayBuffer()).toString('base64')}` };
  assert.equal(await parser.extractTextForDocument(saved), `### Page 1\n${text}`);

  // The old regex fallback treated these binary parenthesized bytes as text.
  const corrupt = new File([Buffer.from('%PDF-1.4\nstream\n' + '(\ufffd\u0000garbage)'.repeat(12) + '\nendstream')], 'broken.pdf', { type: 'application/pdf' });
  await assert.rejects(parser.extractTextFromPdf(corrupt), /Failed to extract text from PDF/);

  globalThis.document = { createElement: () => ({ getContext: () => null }) };
  assert.equal(await parser.extractTextFromPdf(makePdf('Jane Doe')), '### Page 1\nJane Doe');
  await assert.rejects(parser.extractTextFromPdf(makePdf('')), /No readable text found/);

  // Check the shipping artifact, not just the test's Node worker substitution.
  const assets = fileURLToPath(new URL('../dist/assets/', import.meta.url));
  const files = readdirSync(assets);
  const worker = files.find(name => /^pdf\.worker\.min-.*\.mjs$/.test(name));
  assert.ok(worker, 'extension bundles a local PDF worker');
  const sidepanel = readFileSync(new URL(`../dist/assets/${files.find(name => /^sidepanel-.*\.js$/.test(name))}`, import.meta.url), 'utf8');
  assert.ok(sidepanel.includes(worker), 'sidepanel references the packaged worker');
  assert.ok(!sidepanel.includes('cdnjs.cloudflare.com/ajax/libs/pdf.js'), 'PDF extraction does not depend on remote code');
  console.log('PASS: real PDF text, saved attachment repair, corrupt binary rejection, short/empty PDFs, and packaged worker');
} finally {
  rmSync(output, { force: true });
}
