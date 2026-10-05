import type { UserDocument } from '../types';
import { mediaBlobKeyFor, putMediaBlob } from './blob-store';

// Keep memory lists small enough to deserialize on every panel launch.
// Small attachments and thumbnails remain inline; videos and large raw files
// live in IndexedDB and are read only when an upload or download needs them.
const MAX_INLINE_CHARACTERS = 3 * 1024 * 1024;

export async function compactMemoryMedia(doc: UserDocument): Promise<UserDocument> {
  if (!doc.dataUrl || !doc.dataUrl.startsWith('data:')) return doc;
  const isVideo = doc.type === 'video' || doc.mimeType?.startsWith('video/') ||
    doc.dataUrl.startsWith('data:video/');
  if (!isVideo && doc.dataUrl.length <= MAX_INLINE_CHARACTERS) return doc;

  try {
    const blob = await (await fetch(doc.dataUrl)).blob();
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
