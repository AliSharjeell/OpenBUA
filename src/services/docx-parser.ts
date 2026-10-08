/** Read Word's main document XML from a DOCX ZIP, preserving paragraph order. */
export async function extractTextFromDocx(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer);
  let end = bytes.length - 22;
  const floor = Math.max(0, bytes.length - 65557);
  for (; end >= floor; end--) if (view.getUint32(end, true) === 0x06054b50) break;
  if (end < floor) throw new Error('Invalid DOCX archive: ZIP directory is missing.');
  const entries = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  for (let index = 0; index < entries; index++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) throw new Error('Invalid DOCX ZIP directory.');
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (name === 'word/document.xml') {
      if (view.getUint16(offset + 8, true) & 1) throw new Error('Encrypted Word documents cannot be extracted.');
      if (size > 20 * 1024 * 1024) throw new Error('Word document text exceeds the extraction limit.');
      if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('Invalid DOCX document entry.');
      const start = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
      if (start + compressedSize > bytes.length) throw new Error('Incomplete DOCX document entry.');
      let xmlBytes = bytes.slice(start, start + compressedSize);
      if (method === 8) {
        const stream = new Blob([xmlBytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        xmlBytes = new Uint8Array(await new Response(stream).arrayBuffer());
      } else if (method !== 0) throw new Error('Unsupported Word document compression.');
      if (xmlBytes.length !== size) throw new Error('Incomplete Word document text.');
      const xml = new DOMParser().parseFromString(decoder.decode(xmlBytes), 'application/xml');
      if (xml.querySelector('parsererror')) throw new Error('Invalid Word document XML.');
      const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
      const lines = Array.from(xml.getElementsByTagNameNS(ns, 'p')).map(paragraph =>
        Array.from(paragraph.getElementsByTagName('*')).map(node => node.namespaceURI !== ns ? ''
          : node.localName === 't' ? node.textContent || '' : node.localName === 'tab' ? '\t'
          : node.localName === 'br' ? '\n' : '').join(''));
      const text = lines.join('\n').trim();
      if (!text) throw new Error('No readable text found in this Word document.');
      return text;
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error('DOCX archive contains no Word document text.');
}
