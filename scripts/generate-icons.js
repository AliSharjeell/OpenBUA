import fs from 'fs';
import zlib from 'zlib';

function createPNG(size, primaryColor = [24, 24, 27], accentColor = [250, 250, 250]) {
  const width = size;
  const height = size;
  
  // Create raw RGBA image data
  const rawData = Buffer.alloc(height * (1 + width * 4));
  
  const radius = size * 0.22;
  const cx = size / 2;
  const cy = size / 2;
  
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (1 + width * 4);
    rawData[rowOffset] = 0; // Filter type 0 (None)
    
    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 4;
      
      // Rounded rect mask
      const dx = Math.max(Math.abs(x - cx) - (cx - radius), 0);
      const dy = Math.max(Math.abs(y - cy) - (cy - radius), 0);
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist <= radius) {
        // Inside rounded square
        // Check if inside inner symbol (Form lines + lightning bolt / arrow)
        const nx = (x - cx) / (size * 0.5);
        const ny = (y - cy) / (size * 0.5);
        
        let isAccent = false;
        // Draw an 'F' with AI dot / spark
        if (nx >= -0.4 && nx <= -0.15 && ny >= -0.5 && ny <= 0.5) isAccent = true; // Stem
        if (nx >= -0.15 && nx <= 0.4 && ny >= -0.5 && ny <= -0.25) isAccent = true; // Top bar
        if (nx >= -0.15 && nx <= 0.25 && ny >= -0.1 && ny <= 0.15) isAccent = true; // Middle bar
        if (nx >= 0.15 && nx <= 0.45 && ny >= 0.25 && ny <= 0.5) isAccent = true; // Spark dot

        if (isAccent) {
          rawData[pxOffset] = accentColor[0];     // R
          rawData[pxOffset + 1] = accentColor[1]; // G
          rawData[pxOffset + 2] = accentColor[2]; // B
          rawData[pxOffset + 3] = 255;            // A
        } else {
          // Dark zinc background
          rawData[pxOffset] = primaryColor[0];
          rawData[pxOffset + 1] = primaryColor[1];
          rawData[pxOffset + 2] = primaryColor[2];
          rawData[pxOffset + 3] = 255;
        }
      } else {
        // Transparent
        rawData[pxOffset] = 0;
        rawData[pxOffset + 1] = 0;
        rawData[pxOffset + 2] = 0;
        rawData[pxOffset + 3] = 0;
      }
    }
  }
  
  // Deflate compressed data
  const compressed = zlib.deflateSync(rawData);
  
  // PNG Signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  
  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // Bit depth: 8
  ihdr[9] = 6; // Color type: 6 (RGBA)
  ihdr[10] = 0; // Compression: 0
  ihdr[11] = 0; // Filter: 0
  ihdr[12] = 0; // Interlace: 0
  
  function makeChunk(type, data) {
    const len = data.length;
    const buf = Buffer.alloc(12 + len);
    buf.writeUInt32BE(len, 0);
    buf.write(type, 4, 4, 'ascii');
    data.copy(buf, 8);
    
    // CRC32 calculation
    const crc = crc32(Buffer.concat([Buffer.from(type, 'ascii'), data]));
    buf.writeUInt32BE(crc, 8 + len);
    return buf;
  }
  
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      if (c & 1) c = 0xedb88320 ^ (c >>> 1);
      else c = c >>> 1;
    }
    crcTable[n] = c;
  }
  
  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }
  
  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));
  
  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

[16, 48, 128].forEach(size => {
  const png = createPNG(size);
  fs.writeFileSync(`public/icons/icon${size}.png`, png);
  console.log(`Generated public/icons/icon${size}.png`);
});
