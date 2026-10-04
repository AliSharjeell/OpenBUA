// Chunked, size-independent file injection into a page.
//
// WHY THIS EXISTS:
// The old transport shipped the whole file as a single base64 data URL through
// `chrome.scripting.executeScript` args / `chrome.tabs.sendMessage`. Chrome
// validates and serializes those args, and a large video blows straight through
// the limit - the observed failure was:
//
//   Error at parameter 'injection': Error at property 'args':
//   Error at index 0: Value is unserializable.
//
// This module never sends more than one bounded chunk at a time, so any file
// size works. It prefers the content script (which can hold page-side state
// between messages) and falls back to direct script injection when no content
// script is listening.

import { getMediaBlob, readMediaBlobAsBase64Slices } from '../services/blob-store';

/** Raw bytes per chunk. Base64 grows this by ~33%, keeping messages well bounded. */
export const MEDIA_CHUNK_BYTES = 512 * 1024;

export type FileSource =
  | { kind: 'blob'; blob: Blob }
  | { kind: 'dataUrl'; dataUrl: string };

export interface InjectionRequest {
  fileName: string;
  mimeType: string;
  source: FileSource;
  refId?: string;
  selector?: string;
  /** Stop dispatching drag events (some pickers mis-handle them). */
  dropEvents?: boolean;
  onProgress?: (sent: number, total: number) => void;
}

export interface InjectionResult {
  success: boolean;
  message: string;
  transport?: 'content-script' | 'execute-script';
  bytes?: number;
  fileName?: string;
  attached?: boolean;
  previewDetected?: boolean;
  target?: string;
}

export type MessageSender = <T = any>(
  tabId: number,
  message: any,
  timeoutMs?: number
) => Promise<T>;

let transferCounter = 0;
function nextTransferId(): string {
  transferCounter += 1;
  return `xfer-${Date.now().toString(36)}-${transferCounter}`;
}

/** Decode one base64 chunk into bytes. Mirrors the page-side implementation. */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Split a full base64 payload into byte-aligned chunks.
 * Chunks are cut on multiples of 4 base64 chars (3 whole bytes) so each chunk
 * decodes independently and the receiver can simply concatenate the results.
 */
export function splitBase64IntoChunks(base64: string, chunkBytes: number): string[] {
  const charsPerChunk = Math.max(4, Math.floor(chunkBytes / 3) * 4);
  const chunks: string[] = [];
  for (let i = 0; i < base64.length; i += charsPerChunk) {
    chunks.push(base64.slice(i, Math.min(i + charsPerChunk, base64.length)));
  }
  return chunks.length ? chunks : [''];
}

/** Produce the byte-aligned base64 chunk list for any supported source. */
export async function buildChunkList(source: FileSource): Promise<{ chunks: string[]; bytes: number }> {
  if (source.kind === 'blob') {
    const slices = await readMediaBlobAsBase64Slices(source.blob, MEDIA_CHUNK_BYTES);
    return { chunks: slices, bytes: source.blob.size };
  }
  const commaIndex = source.dataUrl.indexOf(',');
  const base64 = commaIndex >= 0 ? source.dataUrl.slice(commaIndex + 1) : source.dataUrl;
  const chunks = splitBase64IntoChunks(base64, MEDIA_CHUNK_BYTES);
  return { chunks, bytes: Math.floor((base64.length * 3) / 4) };
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${i > 0 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

// ---------------------------------------------------------------------------
// Page-side helpers for the direct executeScript fallback.
// These are serialized by Chrome, so they must be fully self-contained:
// no imports, no closure over module scope, no TypeScript-only syntax.
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
function inPageBeginTransfer(transferId: string, meta: { fileName: string; mimeType: string; totalChunks: number }): { ok: boolean } {
  const w = window as any;
  if (!w.__OPENBUA_FILE_TRANSFERS__) w.__OPENBUA_FILE_TRANSFERS__ = {};
  w.__OPENBUA_FILE_TRANSFERS__[transferId] = { meta, chunks: new Array(meta.totalChunks) };
  return { ok: true };
}

function inPagePushChunk(transferId: string, index: number, data: string): { ok: boolean; received: number } {
  const w = window as any;
  const tx = w.__OPENBUA_FILE_TRANSFERS__?.[transferId];
  if (!tx) return { ok: false, received: 0 };
  tx.chunks[index] = data;
  let received = 0;
  for (let i = 0; i < tx.chunks.length; i++) if (tx.chunks[i] !== undefined) received++;
  return { ok: true, received };
}

/**
 * Reassemble the transferred chunks and attach the resulting File.
 *
 * IMPORTANT: this function is shipped to the page by
 * `chrome.scripting.executeScript({ func })`, which serializes ONLY this
 * function's source. Anything it calls from module scope is undefined in the
 * page, so every helper it needs is declared inside its own body. Do not
 * extract these.
 */
function inPageCommitTransfer(transferId: string): { success: boolean; message: string; bytes: number } {
  const w = window as any;
  const tx = w.__OPENBUA_FILE_TRANSFERS__?.[transferId];
  if (!tx) return { success: false, message: 'No active file transfer on this page.', bytes: 0 };

  // --- local helpers (must stay inside this function) ---
  const acceptAllows = (accept: string | null, file: File): boolean => {
    const raw = (accept || '').trim().toLowerCase();
    if (!raw || raw === '*' || raw.split(',').some((t: string) => t.trim() === '*/*')) return true;
    const type = (file.type || '').toLowerCase();
    const name = (file.name || '').toLowerCase();
    const main = type.split('/')[0] || '';
    return raw.split(',').some((t: string) => {
      const token = t.trim();
      if (!token) return false;
      if (token === type && type) return true;
      if (token === main + '/*' && main) return true;
      if (token.startsWith('.') && name.endsWith(token)) return true;
      return false;
    });
  };

  const isVisible = (el: HTMLElement): boolean => {
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0 || el.offsetParent !== null;
  };

  // Rank inputs by whether `accept` actually permits the file. Sites such as
  // WhatsApp keep one input per attachment-menu entry, and the first in DOM
  // order is usually the media-only one, which renders a preview and then
  // rejects the file as "not supported".
  const bestInput = (file: File): HTMLInputElement | null => {
    const inputs = Array.from(document.querySelectorAll('input[type="file"]')) as HTMLInputElement[];
    let best: HTMLInputElement | null = null;
    let bestScore = -1;
    for (const el of inputs) {
      const dialog = el.closest('[role="dialog"], dialog, [aria-modal="true"]');
      const inDialog = Boolean(dialog) && isVisible(dialog as HTMLElement);
      const raw = (el.getAttribute('accept') || '').trim().toLowerCase();
      let score: number;
      if (!raw) score = 800;
      else if (raw.split(',').some((t: string) => t.trim() === '*/*')) score = 600;
      else if (acceptAllows(el.getAttribute('accept'), file)) score = 1000;
      else continue; // this input explicitly excludes the file
      if (inDialog) score += 50;
      if (el.multiple) score += 25;
      if (score > bestScore) {
        best = el;
        bestScore = score;
      }
    }
    return best;
  };

  try {
    const parts: Uint8Array[] = [];
    for (let i = 0; i < tx.chunks.length; i++) {
      const chunk = tx.chunks[i];
      if (chunk === undefined) {
        delete w.__OPENBUA_FILE_TRANSFERS__[transferId];
        return { success: false, message: `File transfer incomplete: missing chunk ${i + 1}.`, bytes: 0 };
      }
      const binary = atob(chunk);
      const bytes = new Uint8Array(binary.length);
      for (let j = 0; j < binary.length; j++) bytes[j] = binary.charCodeAt(j);
      parts.push(bytes);
    }
    const total = parts.reduce((sum, p) => sum + p.length, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      merged.set(part, offset);
      offset += part.length;
    }
    delete w.__OPENBUA_FILE_TRANSFERS__[transferId];

    const file = new File([merged], tx.meta.fileName, { type: tx.meta.mimeType || 'application/octet-stream' });
    const input = bestInput(file);
    if (!input) {
      return { success: false, message: 'No file input found on the page.', bytes: total };
    }

    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

    // Some pickers (Reddit, LinkedIn) only register a drop, so replay the drag
    // sequence on the surrounding dropzone as well.
    const dropzone =
      input.closest('[data-dropzone], [data-testid="dropzone"], .dropzone, [class*="dropzone"]') ||
      input.parentElement;
    if (dropzone && dropzone !== input) {
      for (const type of ['dragenter', 'dragover', 'drop']) {
        try {
          dropzone.dispatchEvent(
            new DragEvent(type, { bubbles: true, cancelable: true, composed: true, dataTransfer: transfer })
          );
        } catch {
          /* DragEvent unsupported */
        }
      }
    }

    const attached = Boolean(input.files && input.files.length > 0);
    const acceptAttr = input.getAttribute('accept') || '';
    const warning = acceptAllows(acceptAttr, file)
      ? ''
      : ` WARNING: the chosen input (accept="${acceptAttr}") does not allow ${file.type}. This site may reject it as "not supported" despite a preview. Open the attach menu and choose the correct option.`;

    return {
      success: true,
      attached,
      message: attached
        ? `Attached "${file.name}" (${total} bytes) to the file input.${warning}`
        : `Set "${file.name}" on the file input but the page reported no file.${warning}`,
      bytes: total,
    };
  } catch (err: any) {
    return { success: false, message: `Failed to attach file: ${err?.message || err}`, bytes: 0 };
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Inject a file into a tab, chunk by chunk.
 *
 * `send` is the caller's message sender (browser-bridge supplies one that also
 * retries content-script injection), which keeps this module free of any
 * dependency on the bridge and avoids a circular import.
 */
export async function injectFileIntoTab(
  tabId: number,
  request: InjectionRequest,
  send: MessageSender
): Promise<InjectionResult> {
  const { chunks, bytes } = await buildChunkList(request.source);
  const transferId = nextTransferId();
  const meta = {
    fileName: request.fileName,
    mimeType: request.mimeType,
    totalChunks: chunks.length,
  };

  // Transport A: content script. Preferred - it keeps transfer state in the page
  // and can post back real attachment verification.
  try {
    const prepared = await send<{ success: boolean }>(
      tabId,
      { action: 'PREPARE_FILE_UPLOAD', transferId, ...meta },
      5000
    );
    if (prepared && prepared.success !== false) {
      for (let i = 0; i < chunks.length; i++) {
        await send(tabId, { action: 'FILE_UPLOAD_CHUNK', transferId, index: i, data: chunks[i] }, 8000);
        request.onProgress?.(i + 1, chunks.length);
        // Yield so a multi-hundred-chunk transfer never blocks the UI thread.
        if (i % 8 === 7) await new Promise((r) => setTimeout(r, 0));
      }
      const committed = await send<InjectionResult>(
        tabId,
        {
          action: 'COMMIT_FILE_UPLOAD',
          transferId,
          refId: request.refId,
          selector: request.selector,
          dropEvents: request.dropEvents !== false,
        },
        15000
      );
      if (committed) {
        return {
          ...committed,
          transport: 'content-script',
          bytes,
          fileName: request.fileName,
        };
      }
    }
  } catch (err: any) {
    console.warn('[OpenBUA] Content-script file transfer unavailable, using script injection:', err?.message || err);
  }

  // Transport B: direct script injection with the same chunking guarantees.
  if (typeof chrome === 'undefined' || !chrome.scripting) {
    return { success: false, message: 'No script injection API available in this context.' };
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: inPageBeginTransfer,
      args: [transferId, meta],
    });

    for (let i = 0; i < chunks.length; i++) {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: inPagePushChunk,
        args: [transferId, i, chunks[i]],
      });
      request.onProgress?.(i + 1, chunks.length);
      if (i % 8 === 7) await new Promise((r) => setTimeout(r, 0));
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: inPageCommitTransfer,
      args: [transferId],
    });
    const result = results?.[0]?.result as
      | { success: boolean; message: string; bytes: number; attached?: boolean }
      | undefined;

    if (!result) {
      return { success: false, message: 'File transfer finished but the page returned no result.' };
    }
    return {
      success: result.success,
      message: `${result.message} (${formatBytes(bytes)} transferred in ${chunks.length} chunks)`,
      transport: 'execute-script',
      bytes,
      attached: result.attached,
      fileName: request.fileName,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `File injection failed: ${err?.message || err}`,
      transport: 'execute-script',
      bytes,
    };
  }
}

/**
 * Resolve the raw bytes for a memory document reference into a FileSource.
 * Prefers the blob store (memory-efficient) and falls back to inline dataUrl.
 */
export async function resolveFileSource(doc: {
  blobKey?: string;
  dataUrl?: string;
  mimeType?: string;
  fileName?: string;
}): Promise<FileSource | null> {
  if (doc.blobKey) {
    const blob = await getMediaBlob(doc.blobKey);
    if (blob) return { kind: 'blob', blob };
  }
  if (doc.dataUrl) return { kind: 'dataUrl', dataUrl: doc.dataUrl };
  return null;
}
