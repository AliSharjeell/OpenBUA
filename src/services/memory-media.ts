import type { UserDocument } from '../types';
import { mediaBlobKeyFor, putMediaBlob } from './blob-store';

// Keep memory lists small enough to deserialize on every panel launch.
// Small attachments and thumbnails remain inline; videos and large raw files
// live in IndexedDB and are read only when an upload or download needs them.
const MAX_INLINE_CHARACTERS = 3 * 1024 * 1024;

/** Decode base64 in bounded batches, allowing rendering and input between them. */
export async function inlineMediaToBlob(dataUrl: string): Promise<Blob> {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) throw new Error('Invalid media data URL');
  const header = dataUrl.slice(0, comma);
  if (!/;base64$/i.test(header)) {
    // Non-base64 legacy attachments are rare; preserve their standard decoding.
    return (await fetch(dataUrl)).blob();
  }
  const parts: BlobPart[] = [];
  // A multiple of four keeps each base64 slice independently decodable.
  const batchCharacters = 256 * 1024;
  for (let offset = comma + 1; offset < dataUrl.length; offset += batchCharacters) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const binary = atob(dataUrl.slice(offset, offset + batchCharacters));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    parts.push(bytes);
  }
  return new Blob(parts, { type: header.slice(5).split(';')[0] || 'application/octet-stream' });
}

export async function compactMemoryMedia(doc: UserDocument): Promise<UserDocument> {
  if (!doc.dataUrl || !doc.dataUrl.startsWith('data:')) return doc;
  const isVideo = doc.type === 'video' || doc.mimeType?.startsWith('video/') ||
    doc.dataUrl.startsWith('data:video/');
  if (!isVideo && doc.dataUrl.length <= MAX_INLINE_CHARACTERS) return doc;

  try {
    const blob = await inlineMediaToBlob(doc.dataUrl);
    const blobKey = doc.blobKey || mediaBlobKeyFor(doc.id);
    if (!await putMediaBlob(blobKey, blob)) return doc;
    const { dataUrl: _inlineBytes, ...metadata } = doc;
    return { ...metadata, blobKey };
  } catch (error) {
    // Preserve the original attachment if conversion or persistence fails.
    console.warn('[OpenBUA] Could not migrate inline attachment:', error);
    return doc;
  }
}
