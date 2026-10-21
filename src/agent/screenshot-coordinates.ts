export interface ScreenshotViewport {
  width: number; height: number; devicePixelRatio: number;
  scrollX: number; scrollY: number; scale: number; url: string; documentId?: string;
}
export interface ScreenshotGeometry {
  imageWidth: number; imageHeight: number; viewport: ScreenshotViewport; capturedAt: number;
}

// Read encoded image dimensions, without assuming that screenshot pixels equal
// devicePixelRatio * CSS pixels (zoom, scaling and rounding can differ).
export function imageDimensions(dataUrl: string): { width: number; height: number } | undefined {
  const encoded = dataUrl.split(',')[1];
  if (!encoded) return;
  const data = Uint8Array.from(atob(encoded), value => value.charCodeAt(0));
  const u16 = (at: number) => data[at] * 256 + data[at + 1];
  const u32 = (at: number) => data[at] * 16777216 + data[at + 1] * 65536 + data[at + 2] * 256 + data[at + 3];
  if (data.length >= 24 && data[0] === 137 && data[1] === 80 && data[2] === 78 && data[3] === 71)
    return { width: u32(16), height: u32(20) };
  if (data[0] !== 255 || data[1] !== 216) return;
  for (let at = 2; at + 3 < data.length;) {
    if (data[at++] !== 255) return;
    while (data[at] === 255) at++;
    const marker = data[at++];
    if (marker === 217 || marker === 218) return;
    if (marker === 1 || marker >= 208 && marker <= 215) continue;
    const length = u16(at);
    if (length < 2 || at + length > data.length) return;
    if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 7)
      return { width: u16(at + 5), height: u16(at + 3) };
    at += length;
  }
}

export function sameScreenshotViewport(a: ScreenshotViewport, b: ScreenshotViewport) {
  return a.url === b.url && a.documentId === b.documentId && a.width === b.width && a.height === b.height &&
    a.scrollX === b.scrollX && a.scrollY === b.scrollY && a.devicePixelRatio === b.devicePixelRatio && a.scale === b.scale;
}

export function mapScreenshotPoint(image: ScreenshotGeometry, current: ScreenshotViewport, x: number, y: number, now = Date.now()) {
  if (now - image.capturedAt > 60_000 || !sameScreenshotViewport(image.viewport, current))
    throw new Error('The screenshot is stale: the page, scroll, viewport or zoom changed. Use DOM controls or capture the current view before clicking.');
  if (![x, y, image.imageWidth, image.imageHeight].every(Number.isFinite) || image.imageWidth <= 0 || image.imageHeight <= 0 ||
      x < 0 || y < 0 || x >= image.imageWidth || y >= image.imageHeight)
    throw new Error('Coordinates must be inside the original screenshot image dimensions. Do not use a resized preview.');
  return { cssX: x * current.width / image.imageWidth, cssY: y * current.height / image.imageHeight };
}
