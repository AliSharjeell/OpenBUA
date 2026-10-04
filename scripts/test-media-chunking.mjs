// Verifies the chunked media transport round-trips bytes exactly.
// A corrupt base64 boundary would silently upload a broken video, so this
// checks the real functions from src, not a reimplementation.
import { base64ToBytes, splitBase64IntoChunks, buildChunkList, MEDIA_CHUNK_BYTES } from '../src/agent/file-injection.ts';
import { bytesToBase64 } from '../src/services/blob-store.ts';

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
  if (!ok) failures++;
}

// 1. Encoder matches the platform's own base64 (the real risk is a hand-rolled
//    encoder diverging from atob/btoa on padding or non-multiple-of-3 lengths).
for (const len of [0, 1, 2, 3, 4, 5, 6, 7, 255, 256, 257, 1024, 65535]) {
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = (i * 37 + 11) & 0xff;
  const mine = bytesToBase64(bytes);
  const native = Buffer.from(bytes).toString('base64');
  check(`bytesToBase64 length ${len} matches Buffer`, mine === native, mine === native ? '' : `got ${mine.slice(0, 24)} want ${native.slice(0, 24)}`);
}

// 2. Every chunk decodes independently AND concatenated chunks rebuild the file.
function roundTrip(label, bytes, chunkBytes) {
  const full = bytesToBase64(bytes);
  const chunks = splitBase64IntoChunks(full, chunkBytes);
  const rebuilt = new Uint8Array(chunks.reduce((s, c) => s + base64ToBytes(c).length, 0));
  let off = 0;
  for (const c of chunks) {
    const part = base64ToBytes(c);
    rebuilt.set(part, off);
    off += part.length;
  }
  let identical = rebuilt.length === bytes.length;
  if (identical) {
    for (let i = 0; i < bytes.length; i++) {
      if (rebuilt[i] !== bytes[i]) { identical = false; break; }
    }
  }
  check(`${label}: ${bytes.length} bytes over ${chunks.length} chunks`, identical && off === bytes.length,
    identical ? '' : `size ${rebuilt.length} vs ${bytes.length}`);
}

roundTrip('small file', new Uint8Array([1, 2, 3, 4, 5]), MEDIA_CHUNK_BYTES);
roundTrip('exact chunk', new Uint8Array(MEDIA_CHUNK_BYTES).fill(7), MEDIA_CHUNK_BYTES);
roundTrip('chunk + 1', new Uint8Array(MEDIA_CHUNK_BYTES + 1).fill(8), MEDIA_CHUNK_BYTES);
roundTrip('chunk - 1', new Uint8Array(MEDIA_CHUNK_BYTES - 1).fill(9), MEDIA_CHUNK_BYTES);
roundTrip('tiny chunk 3B', new Uint8Array(1000).fill(10), 3);
roundTrip('tiny chunk 1B', new Uint8Array(300).fill(11), 1);

// 3. buildChunkList over a real Blob, the path the extension actually uses.
const SIZE = 3 * 1024 * 1024 + 12345; // spans several chunks, non-round size
const blob = new Blob([new Uint8Array(SIZE).map((_, i) => (i * 7) & 0xff)]);
const { chunks, bytes } = await buildChunkList({ kind: 'blob', blob });
check('buildChunkList reports correct byte count', bytes === blob.size, `${bytes} vs ${blob.size}`);

const reassembled = new Uint8Array(bytes);
let pos = 0;
for (const c of chunks) {
  const part = base64ToBytes(c);
  reassembled.set(part, pos);
  pos += part.length;
}
let blobOk = pos === blob.size;
if (blobOk) {
  const src = new Uint8Array(await blob.arrayBuffer());
  for (let i = 0; i < src.length; i++) {
    if (reassembled[i] !== src[i]) { blobOk = false; break; }
  }
}
check(`3MB blob round-trips byte-identical over ${chunks.length} chunks`, blobOk);

// 4. No single message may exceed a safe size, or Chrome rejects it again.
const maxChunk = Math.max(...chunks.map((c) => c.length));
check(`largest chunk is bounded (${(maxChunk / 1024).toFixed(0)}KB <= 1MB)`, maxChunk <= 1024 * 1024);

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
