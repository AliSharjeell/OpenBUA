// IndexedDB-backed blob store for raw media bytes (videos, large images, binaries).
//
// WHY THIS EXISTS:
// Storing a video as a base64 data URL inside chrome.storage.local freezes the
// extension. An 88s clip becomes a multi-hundred-megabyte JS string that has to
// be built, JSON-serialized, written, read back, and re-rendered. Raw Blobs in
// IndexedDB avoid the 1.33x base64 blowup entirely and are written natively.
//
// Every function degrades gracefully: if IndexedDB is unavailable (private mode,
// restricted contexts) the caller falls back to the legacy inline dataUrl path.

const DB_NAME = 'openbua_media';
const DB_VERSION = 1;
const STORE_BLOBS = 'blobs';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function isIndexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

function openDb(): Promise<IDBDatabase | null> {
  if (!isIndexedDbAvailable()) return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        db.createObjectStore(STORE_BLOBS);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      console.warn('[OpenBUA] IndexedDB unavailable; falling back to inline file data.');
      resolve(null);
    };
    request.onblocked = () => resolve(null);
  });

  return dbPromise;
}

/**
 * Deterministic blob key for a memory document id.
 * Using the doc id keeps the blob lifetime tied to the document, so deleting the
 * memory entry can clean up its bytes with no extra bookkeeping.
 */
export function mediaBlobKeyFor(docId: string): string {
  return `media:${docId}`;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Persist raw media bytes. Returns true when the bytes actually landed in
 * IndexedDB, or false when the caller must fall back to an inline dataUrl.
 */
export async function putMediaBlob(key: string, blob: Blob): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;

  try {
    const tx = db.transaction(STORE_BLOBS, 'readwrite');
    // Store a plain Blob clone; File objects retain a live path reference we
    // do not want pinned in storage.
    tx.objectStore(STORE_BLOBS).put(blob.slice(0, blob.size, blob.type), key);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return true;
  } catch (err) {
    console.warn('[OpenBUA] Failed to store media blob:', err);
    return false;
  }
}

export async function getMediaBlob(key: string): Promise<Blob | null> {
  const db = await openDb();
  if (!db) return null;

  try {
    const tx = db.transaction(STORE_BLOBS, 'readonly');
    const result = await requestToPromise<Blob | undefined>(
      tx.objectStore(STORE_BLOBS).get(key)
    );
    return result ?? null;
  } catch (err) {
    console.warn('[OpenBUA] Failed to read media blob:', err);
    return null;
  }
}

export async function deleteMediaBlob(key: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE_BLOBS, 'readwrite');
    tx.objectStore(STORE_BLOBS).delete(key);
  } catch (err) {
    console.warn('[OpenBUA] Failed to delete media blob:', err);
  }
}

/**
 * Read a media blob as base64 WITHOUT materialising the whole file as one
 * string. Each slice is encoded independently, so peak memory stays bounded
 * regardless of file size.
 */
export async function readMediaBlobAsBase64Slices(
  blob: Blob,
  sliceBytes: number
): Promise<string[]> {
  const slices: string[] = [];
  for (let offset = 0; offset < blob.size; offset += sliceBytes) {
    const slice = blob.slice(offset, Math.min(offset + sliceBytes, blob.size));
    const buf = await slice.arrayBuffer();
    slices.push(bytesToBase64(new Uint8Array(buf)));
  }
  if (slices.length === 0) slices.push('');
  return slices;
}

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Chunked base64 encoder. Avoids `String.fromCharCode(...largeArray)` blowing the
 * argument limit and avoids btoa's per-call string spike on large buffers.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const len = bytes.length;
  if (len === 0) return '';

  const remainder = len % 3;
  const mainLen = len - remainder;
  let result = '';

  for (let i = 0; i < mainLen; i += 3) {
    const chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    result +=
      BASE64_CHARS[(chunk >> 18) & 63] +
      BASE64_CHARS[(chunk >> 12) & 63] +
      BASE64_CHARS[(chunk >> 6) & 63] +
      BASE64_CHARS[chunk & 63];
  }

  if (remainder === 1) {
    const chunk = bytes[mainLen];
    result +=
      BASE64_CHARS[chunk >> 2] + BASE64_CHARS[(chunk << 4) & 63] + '==';
  } else if (remainder === 2) {
    const chunk = (bytes[mainLen] << 8) | bytes[mainLen + 1];
    result +=
      BASE64_CHARS[chunk >> 10] +
      BASE64_CHARS[(chunk >> 4) & 63] +
      BASE64_CHARS[(chunk << 2) & 63] +
      '=';
  }

  return result;
}

/** Rough storage usage for stored media, for settings/debug display. */
export async function getMediaStoreUsage(): Promise<{ count: number; bytes: number }> {
  const db = await openDb();
  if (!db) return { count: 0, bytes: 0 };
  try {
    const tx = db.transaction(STORE_BLOBS, 'readonly');
    const store = tx.objectStore(STORE_BLOBS);
    const keys = await requestToPromise<IDBValidKey[]>(store.getAllKeys());
    const blobs = await requestToPromise<Blob[]>(store.getAll());
    const bytes = blobs.reduce((sum, b) => sum + (b?.size || 0), 0);
    return { count: keys.length, bytes };
  } catch {
    return { count: 0, bytes: 0 };
  }
}
