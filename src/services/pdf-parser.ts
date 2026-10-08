import { extractTextFromDocx } from './docx-parser';
// Client-side PDF, image, video, and text document parser for extracting resume/profile text and raw file data
import { DocumentFileType, UserDocument } from '../types';
import { getMediaBlob, mediaBlobKeyFor, putMediaBlob } from './blob-store';
import { loadSettings } from './storage';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

/**
 * Files at or below this size keep an inline base64 dataUrl, which keeps the
 * existing OCR/extract and simple-upload flows working unchanged. Anything
 * larger (and every video, regardless of size) is stored as a raw Blob instead.
 */
export const INLINE_DATA_URL_MAX_BYTES = 3 * 1024 * 1024; // 3 MB

// PDF decoding is not needed to open the panel or load saved memory metadata.
// Load the large PDF engine only when a PDF actually needs parsing.
let pdfLibraryPromise: Promise<typeof import('pdfjs-dist')> | undefined;
function loadPdfLibrary(): Promise<typeof import('pdfjs-dist')> {
  if (!pdfLibraryPromise) {
    pdfLibraryPromise = import('pdfjs-dist').then((library) => {
      // Extension CSP forbids remote worker code. Vite emits the matching worker
      // alongside our own assets, so extraction also works without CDN access.
      library.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      return library;
    }).catch((error) => {
      pdfLibraryPromise = undefined;
      throw error;
    });
  }
  return pdfLibraryPromise;
}

/**
 * Convert a File or Blob into a Base64 data URL string
 */
export function fileToDataUrl(file: Blob | File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to read file as data URL'));
      }
    };
    reader.onerror = () => reject(reader.error || new Error('FileReader error'));
    reader.readAsDataURL(file);
  });
}

/**
 * Recreate a native DOM File instance from a Base64 data URL string
 */
export function dataUrlToFile(dataUrl: string, fileName: string, mimeType?: string): File {
  const parts = dataUrl.split(',');
  const mimeMatch = parts[0]?.match(/:(.*?);/);
  const detectedMime = mimeType || (mimeMatch ? mimeMatch[1] : 'application/octet-stream');
  const base64Data = parts[1] || '';
  const binaryString = atob(base64Data);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new File([bytes], fileName, { type: detectedMime });
}

/**
 * Human readable file size formatter
 */
export function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const safeI = Math.min(i, units.length - 1);
  return `${(bytes / Math.pow(1024, safeI)).toFixed(safeI > 0 ? 1 : 0)} ${units[safeI]}`;
}

/**
 * Detect document category based on filename and optional text content
 */
export function detectDocumentCategory(
  fileName: string,
  content?: string
): 'resume' | 'id_card' | 'photo' | 'video' | 'document' | 'other' {
  const lowerName = fileName.toLowerCase();
  const lowerContent = (content || '').toLowerCase();

  if (
    /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(fileName) ||
    lowerName.includes('video') ||
    lowerName.includes('demo') ||
    lowerName.includes('trailer') ||
    lowerName.includes('promo') ||
    lowerName.includes('recording') ||
    lowerContent.includes('video demo') ||
    lowerContent.includes('video walkthrough')
  ) {
    return 'video';
  }

  const isResume =
    lowerName.includes('resume') ||
    lowerName.includes('cv') ||
    lowerName.includes('curriculum') ||
    lowerContent.includes('curriculum vitae') ||
    lowerContent.includes('work experience') ||
    lowerContent.includes('education') ||
    lowerContent.includes('employment history');

  if (isResume) return 'resume';

  const isId =
    lowerName.includes('passport') ||
    lowerName.includes('id_card') ||
    lowerName.includes('idcard') ||
    lowerName.includes('cnic') ||
    lowerName.includes('license') ||
    lowerName.includes('identity');

  if (isId) return 'id_card';

  if (/\.(png|jpe?g|webp|gif|svg)$/i.test(fileName)) {
    return 'photo';
  }

  return 'document';
}

/**
 * Detect file type enum from filename extension and MIME type
 */
export function detectFileType(fileName: string, mimeType?: string): DocumentFileType {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  if (['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v'].includes(ext) || mimeType?.startsWith('video/')) return 'video';
  if (ext === 'pdf' || mimeType === 'application/pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext) || mimeType?.startsWith('image/')) return 'image';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (ext === 'json') return 'json';
  if (['txt', 'csv', 'tsv', 'log', 'rtf'].includes(ext) || mimeType?.startsWith('text/')) return 'text';
  return 'file';
}

/**
 * Extract text from images or documents using the user's active AI provider VLM (Vision Language Model)
 */
export async function extractTextWithVlm(
  dataUrl: string,
  mimeType: string,
  customPrompt?: string,
  signal?: AbortSignal
): Promise<string> {
  const settings = await loadSettings();
  const promptText =
    customPrompt ||
    'Extract all readable text and data from this document or image in structured Markdown. Preserve contact information, personal details, work experience, education, and skills verbatim. For images, also describe visible objects, layout, charts, and other relevant visual details in a separate Visual description section. Distinguish visible facts from uncertainty; do not invent details.';

  if (settings.selectedMode === 'free') {
    const baseUrl = settings.free?.baseUrl || 'https://generativelanguage.googleapis.com/v1beta/openai/';
    const apiKey = settings.free?.apiKey || '';
    const model = settings.free?.model || 'gemini-3.5-flash-lite';
    const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const payload = {
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: promptText },
            {
              type: 'image_url',
              image_url: {
                url: dataUrl,
              },
            },
          ],
        },
      ],
      max_tokens: 3000,
    };

    const res = await fetch(endpoint, {
      signal,
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`VLM OCR failed (${res.status}): ${errText.slice(0, 300)}`);
    }

    const json = await res.json();
    const reply = json.choices?.[0]?.message?.content;
    if (!reply) {
      throw new Error('VLM OCR returned empty content');
    }
    return reply.trim();
  }

  // BYOK Mode: OpenAI or Anthropic
  if (settings.activeProvider === 'anthropic') {
    const baseUrl = settings.anthropic?.baseUrl || 'https://api.anthropic.com/v1';
    const apiKey = settings.anthropic?.apiKey || '';
    const model = settings.anthropic?.model || 'claude-sonnet-5-5';
    const endpoint = `${baseUrl.replace(/\/+$/, '')}/messages`;

    const base64Data = dataUrl.split(',')[1] || '';
    let validMediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' = 'image/png';
    if (mimeType.includes('jpeg') || mimeType.includes('jpg')) validMediaType = 'image/jpeg';
    else if (mimeType.includes('webp')) validMediaType = 'image/webp';
    else if (mimeType.includes('gif')) validMediaType = 'image/gif';

    const res = await fetch(endpoint, {
      signal,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 3000,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: validMediaType,
                  data: base64Data,
                },
              },
              {
                type: 'text',
                text: promptText,
              },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic OCR failed (${res.status}): ${errText.slice(0, 300)}`);
    }

    const json = await res.json();
    const reply = json.content?.[0]?.text;
    if (!reply) {
      throw new Error('Anthropic OCR returned empty content');
    }
    return reply.trim();
  } else {
    // BYOK OpenAI
    const baseUrl = settings.openai?.baseUrl || 'https://api.openai.com/v1';
    const apiKey = settings.openai?.apiKey || '';
    const model = settings.openai?.model || 'gpt-4o-mini';
    const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

    const res = await fetch(endpoint, {
      signal,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: promptText },
              {
                type: 'image_url',
                image_url: {
                  url: dataUrl,
                },
              },
            ],
          },
        ],
        max_tokens: 3000,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI OCR failed (${res.status}): ${errText.slice(0, 300)}`);
    }

    const json = await res.json();
    const reply = json.choices?.[0]?.message?.content;
    if (!reply) {
      throw new Error('OpenAI OCR returned empty content');
    }
    return reply.trim();
  }
}

/**
 * Extract text from PDF using pdfjs-dist.
 * If text length is < 50 characters (e.g. scanned image PDF), automatically renders
 * pages to canvas and runs VLM OCR extraction.
 */
export async function extractTextFromPdf(file: File): Promise<string> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdfjsLib = await loadPdfLibrary();
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(arrayBuffer),
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true,
    });

    const pdf = await loadingTask.promise;
    const pageTexts: string[] = [];
    let totalChars = 0;

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const strings = textContent.items
        .map((item: any) => ('str' in item ? item.str : ''))
        .filter(Boolean);

      const pageMerged = strings.join(' ').replace(/\s+/g, ' ').trim();
      totalChars += pageMerged.length;
      pageTexts.push(`### Page ${pageNum}\n${pageMerged}`);
    }

    // If PDF contains ample text, return it immediately
    if (totalChars >= 50) {
      return pageTexts.join('\n\n');
    }

    // If text is minimal or empty, this is likely a scanned PDF.
    // Render pages to canvas and perform VLM OCR
    console.log('[AutoForm AI] Scanned PDF detected (chars < 50). Running VLM OCR on pages...');
    const ocrPages: string[] = [];
    const maxPagesToOcr = Math.min(pdf.numPages, 4);

    for (let pageNum = 1; pageNum <= maxPagesToOcr; pageNum++) {
      try {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          await (page as any).render({ canvasContext: ctx, viewport }).promise;
          const pageDataUrl = canvas.toDataURL('image/jpeg', 0.85);
          const pageOcr = await extractTextWithVlm(
            pageDataUrl,
            'image/jpeg',
            `Extract all text, sections, and structured details from page ${pageNum} of this scanned PDF document verbatim:`
          );
          if (pageOcr && pageOcr.trim()) {
            ocrPages.push(`### Page ${pageNum} (Scanned OCR)\n${pageOcr.trim()}`);
          }
        }
      } catch (ocrErr) {
        console.warn(`[AutoForm AI] Failed to OCR PDF page ${pageNum}:`, ocrErr);
      }
    }

    if (ocrPages.length > 0) {
      return ocrPages.join('\n\n');
    }

    // Preserve short text documents, but do not report empty OCR as success.
    if (totalChars > 0) return pageTexts.join('\n\n');
    throw new Error('No readable text found. Scanned PDF extraction requires a working vision provider.');
  } catch (error: any) {
    console.error('[AutoForm AI] Error parsing PDF with pdfjs:', error);
    // PDF streams are binary and often compressed; decoding their bytes as
    // UTF-8 can turn a parser failure into apparently successful garbage text.
    throw new Error(`Failed to extract text from PDF: ${error?.message || error}`);
  }
}

export interface ParsedFileResult {
  title: string;
  fileName: string;
  type: DocumentFileType;
  mimeType: string;
  content: string;
  /** Present only for small files kept inline. */
  dataUrl?: string;
  /** Present when raw bytes live in the IndexedDB blob store. */
  blobKey?: string;
  sizeBytes: number;
  ocrStatus: 'pending' | 'processing' | 'done' | 'failed';
  fileCategory: 'resume' | 'id_card' | 'photo' | 'video' | 'document' | 'other';
  tags: string[];
  filePath?: string;
  thumbnailUrl?: string;
  videoDuration?: number;
}

/**
 * Extract a video frame thumbnail and duration using offscreen HTMLVideoElement
 *
 * Reads the video through a blob/object URL so the file is never base64-encoded
 * into memory. Resolves with empty values on any failure, and always settles:
 * a stalled decode or metadata load can never hang the caller.
 */
export function generateVideoThumbnail(
  source: File | Blob | string
): Promise<{ thumbnailUrl: string; duration: number }> {
  return new Promise((resolve) => {
    let objectUrl = '';
    let video: HTMLVideoElement | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    const finish = (thumbnailUrl: string, duration: number) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      try {
        video?.remove();
      } catch {
        /* noop */
      }
      resolve({ thumbnailUrl, duration });
    };

    try {
      video = document.createElement('video');
      if (typeof source === 'string') {
        video.src = source;
      } else {
        objectUrl = URL.createObjectURL(source);
        video.src = objectUrl;
      }
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      // Never set crossOrigin on a blob: URL - it makes the fetch fail and the
      // thumbnail decode to nothing.

      const drawFrame = () => {
        try {
          const width = video!.videoWidth || 0;
          const height = video!.videoHeight || 0;
          if (!width || !height) {
            finish('', video!.duration || 0);
            return;
          }
          const canvas = document.createElement('canvas');
          canvas.width = Math.min(width, 640);
          canvas.height = Math.round((height / width) * canvas.width);
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            finish('', video!.duration || 0);
            return;
          }
          ctx.drawImage(video!, 0, 0, canvas.width, canvas.height);
          finish(canvas.toDataURL('image/jpeg', 0.8), video!.duration || 0);
        } catch (e) {
          console.warn('[AutoForm AI] Failed to draw video thumbnail:', e);
          finish('', video!.duration || 0);
        }
      };

      video.onerror = () => finish('', 0);

      video.onloadeddata = () => {
        // Frames are available. Seeking can stall on some codecs, so if the
        // seeked event does not arrive we still capture the current frame.
        if (timer) clearTimeout(timer);
        timer = setTimeout(drawFrame, 1500);
      };

      video.onseeked = () => {
        if (timer) clearTimeout(timer);
        drawFrame();
      };

      video.onloadedmetadata = () => {
        const duration = isFinite(video!.duration) ? video!.duration : 0;
        // Seeking to 0 never fires `seeked`; start slightly into the clip so we
        // get a representative frame instead of a black first frame.
        video!.currentTime = duration > 0.5 ? Math.min(1, duration / 4) : 0.1;
      };

      video.load();

      // Hard safety net: never let a stalled decode block the upload flow.
      timer = setTimeout(() => finish('', isFinite(video?.duration || 0) ? video!.duration : 0), 6000);
    } catch {
      finish('', 0);
    }
  });
}

/**
 * Attempt to load file data from a local disk path or media URL.
 *
 * Returns the raw Blob plus an inline dataUrl ONLY when the file is small
 * enough to keep in memory. Large media is returned as `blob` alone so callers
 * can persist it in the blob store instead of freezing on a huge base64 string.
 */
export async function tryLoadFileFromLocalPath(
  pathOrUrl: string
): Promise<{
  blob: Blob;
  dataUrl?: string;
  mimeType: string;
  sizeBytes: number;
  fileName: string;
} | null> {
  const trimmed = pathOrUrl.trim();
  if (!trimmed) return null;

  let fetchUrl = trimmed;
  // Convert Windows path C:\path\file.mp4 to file:///C:/path/file.mp4
  if (/^[a-zA-Z]:[/\\]/.test(trimmed)) {
    fetchUrl = `file:///${trimmed.replace(/\\/g, '/')}`;
  }

  try {
    const res = await fetch(fetchUrl);
    if (!res.ok) return null;
    const blob = await res.blob();
    const fileName = trimmed.split(/[/\\]/).pop() || 'media_file';
    const mimeType = blob.type || 'application/octet-stream';
    const dataUrl =
      blob.size <= INLINE_DATA_URL_MAX_BYTES ? await fileToDataUrl(blob) : undefined;
    return { blob, dataUrl, mimeType, sizeBytes: blob.size, fileName };
  } catch (e) {
    console.debug('[AutoForm AI] Could not fetch local file path:', e);
    return null;
  }
}

/**
 * Process any uploaded file (PDF, image, video, markdown, json, text, or binary).
 *
 * PERFORMANCE: raw bytes for large media (always video, anything over
 * INLINE_DATA_URL_MAX_BYTES) are written to the IndexedDB blob store and only
 * referenced by `blobKey`. We never build a base64 copy of a large video, which
 * is what previously froze the Memory tab on upload.
 *
 * Small files keep an inline `dataUrl` so existing OCR/extract flows and simple
 * form uploads are unaffected.
 */
export async function processUploadedFile(
  file: File,
  options?: { runOcr?: boolean; filePath?: string; docId?: string }
): Promise<ParsedFileResult> {
  const type = detectFileType(file.name, file.type);
  const mimeType = file.type || (type === 'pdf' ? 'application/pdf' : type === 'video' ? 'video/mp4' : 'application/octet-stream');
  const cleanTitle = file.name.replace(/\.[^/.]+$/, '');

  // Decide the storage strategy BEFORE reading any bytes, so the cheap path
  // never touches the file contents.
  const storeAsBlob = type === 'video' || file.size > INLINE_DATA_URL_MAX_BYTES;
  const needsInlineDataUrl =
    !storeAsBlob || (type === 'image' && options?.runOcr === true) || (type === 'pdf' && options?.runOcr === true);

  let blobKey: string | undefined;
  let dataUrl: string | undefined;

  if (storeAsBlob) {
    const key = mediaBlobKeyFor(options?.docId || `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    if (await putMediaBlob(key, file)) {
      blobKey = key;
    } else {
      // IndexedDB unavailable: fall back to inline base64 so the file is still usable.
      dataUrl = await fileToDataUrl(file);
    }
  } else {
    dataUrl = await fileToDataUrl(file);
  }

  if (needsInlineDataUrl && !dataUrl && blobKey) {
    // OCR was requested on a file we stored as a blob; pull the bytes back just
    // for the extraction step rather than for permanent storage.
    const blob = await getMediaBlob(blobKey);
    if (blob) dataUrl = await fileToDataUrl(blob);
  }

  let content = '';
  let ocrStatus: 'pending' | 'processing' | 'done' | 'failed' = 'done';
  let thumbnailUrl: string | undefined;
  let videoDuration: number | undefined;

  if (type === 'video') {
    try {
      const vidInfo = await generateVideoThumbnail(file);
      thumbnailUrl = vidInfo.thumbnailUrl || undefined;
      videoDuration = Math.round(vidInfo.duration);
      content = `[Video Media: ${file.name}] Duration: ${videoDuration}s. Ready for X/Twitter, LinkedIn, Reddit, YouTube, and other social media upload.`;
      ocrStatus = 'done';
    } catch {
      content = `[Video Media: ${file.name}] Stored video media. Ready for X/Twitter, LinkedIn, Reddit, YouTube, and other social media upload.`;
      ocrStatus = 'done';
    }
  } else if (type === 'pdf') {
    if (options?.runOcr === true) {
      try {
        content = await extractTextFromPdf(file);
        ocrStatus = 'done';
      } catch (err: any) {
        console.warn('[AutoForm AI] PDF text extraction failed:', err);
        content = `[PDF Document: ${file.name}] Raw file stored. Click "Extract info into memory" to process.`;
        ocrStatus = 'failed';
      }
    } else {
      content = `[PDF Document: ${file.name}] Raw PDF file stored. Click "Extract info into memory" to extract readable text.`;
      ocrStatus = 'pending';
    }
  } else if (type === 'image') {
    if (options?.runOcr === true && dataUrl) {
      try {
        content = await extractTextWithVlm(dataUrl, mimeType);
        ocrStatus = 'done';
      } catch (err: any) {
        console.warn('[AutoForm AI] Image VLM OCR failed:', err);
        content = `[Image: ${file.name}] Raw image file stored. Click "Extract info into memory" to process.`;
        ocrStatus = 'failed';
      }
    } else {
      content = `[Image: ${file.name}] Raw image file stored. Click "Extract info into memory" to extract readable text.`;
      ocrStatus = 'pending';
    }
  } else if (type === 'markdown' || type === 'json' || type === 'text') {
    content = await file.text();
    ocrStatus = 'done';
  } else if (/\.docx$/i.test(file.name)) {
    content = `[Word Document: ${file.name}] Raw file stored. Reference it in chat to extract its text.`;
    ocrStatus = 'pending';
  } else {
    content = `[File: ${file.name}] Raw binary file stored. Available for form uploads.`;
    ocrStatus = 'done';
  }

  const fileCategory = detectDocumentCategory(file.name, content);
  const tags: string[] = [type];
  if (fileCategory === 'resume') {
    tags.push('resume', 'profile');
  } else if (fileCategory === 'video') {
    tags.push('video', 'marketing');
  } else if (fileCategory !== 'other' && fileCategory !== 'document') {
    tags.push(fileCategory);
  }

  return {
    title: cleanTitle,
    fileName: file.name,
    filePath: options?.filePath,
    type,
    mimeType,
    content,
    dataUrl,
    blobKey,
    sizeBytes: file.size,
    ocrStatus,
    fileCategory,
    videoDuration,
    thumbnailUrl,
    tags,
  };
}

/**
 * Re-runs or triggers OCR / text extraction for an existing stored UserDocument.
 * Reads raw bytes from the blob store when the file is not kept inline.
 */
export async function extractTextForDocument(doc: UserDocument): Promise<string> {
  const mimeType = doc.mimeType || (doc.type === 'pdf' ? 'application/pdf' : 'image/png');

  const isWord = /\.docx$/i.test(doc.fileName || '');
  const isExtractable =
    isWord || doc.type === 'image' ||
    doc.type === 'pdf' ||
    mimeType.startsWith('image/') ||
    mimeType === 'application/pdf';

  if (!isExtractable) {
    throw new Error(`Text extraction not supported for file type: ${doc.type}`);
  }

  let dataUrl = doc.dataUrl;
  if (!dataUrl && doc.blobKey) {
    const blob = await getMediaBlob(doc.blobKey);
    if (blob) dataUrl = await fileToDataUrl(blob);
  }

  if (!dataUrl) {
    throw new Error(
      'Document does not have stored raw file data. Please re-upload the file in the Memory tab.'
    );
  }

  if (isWord) return extractTextFromDocx(dataUrlToFile(dataUrl, doc.fileName!, doc.mimeType));

  if (doc.type === 'image' || mimeType.startsWith('image/')) {
    return await extractTextWithVlm(dataUrl, mimeType);
  }

  const file = dataUrlToFile(dataUrl, doc.fileName || `${doc.title}.pdf`, 'application/pdf');
  return await extractTextFromPdf(file);
}

export interface ExtractedMemorySection {
  title: string;
  content: string;
  category: 'resume' | 'id_card' | 'photo' | 'video' | 'document' | 'other';
  tags: string[];
}

/**
 * Splits extracted Markdown/OCR text into logical sections (e.g. Personal Info, Experience, Education, Skills)
 * so the user can save them as individual granular memory cards for easier AI retrieval.
 */
export function splitExtractedTextIntoSections(
  rawText: string,
  baseTitle: string
): ExtractedMemorySection[] {
  const trimmed = (rawText || '').trim();
  if (!trimmed) return [];

  // Match Markdown headings: #, ##, ###, #### or bold headers like **Experience**
  const headingRegex = /(?:^|\n)(#{1,4}\s+[^\n]+|\*\*[A-Z][A-Za-z0-9\s,&/-]{2,40}\*\*:?)/g;
  const matches: { index: number; heading: string }[] = [];
  let m: RegExpExecArray | null;

  while ((m = headingRegex.exec(trimmed)) !== null) {
    matches.push({ index: m.index, heading: m[1].replace(/^[#*\s]+|[#*\s:]+$/g, '').trim() });
  }

  // If fewer than 2 distinct headings found, return as a single section
  if (matches.length < 2) {
    return [
      {
        title: baseTitle,
        content: trimmed,
        category: detectDocumentCategory(baseTitle, trimmed),
        tags: ['extracted'],
      },
    ];
  }

  const sections: ExtractedMemorySection[] = [];

  // Check if there is introductory text before the first heading
  if (matches[0].index > 0) {
    const introText = trimmed.slice(0, matches[0].index).trim();
    if (introText.length > 20) {
      sections.push({
        title: `${baseTitle}: Overview`,
        content: introText,
        category: detectDocumentCategory(baseTitle, introText),
        tags: ['overview', 'profile'],
      });
    }
  }

  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const startIndex = cur.index;
    const endIndex = i + 1 < matches.length ? matches[i + 1].index : trimmed.length;
    const sectionBody = trimmed.slice(startIndex, endIndex).trim();

    if (sectionBody.length > 10) {
      const headingClean = cur.heading;
      const sectionCategory = detectDocumentCategory(headingClean, sectionBody);
      sections.push({
        title: `${baseTitle}: ${headingClean}`,
        content: sectionBody,
        category: sectionCategory,
        tags: [headingClean.toLowerCase().replace(/[^a-z0-9]+/g, '-'), 'extracted'],
      });
    }
  }

  return sections.length > 0
    ? sections
    : [
        {
          title: baseTitle,
          content: trimmed,
          category: detectDocumentCategory(baseTitle, trimmed),
          tags: ['extracted'],
        },
      ];
}

/**
 * Backward compatibility wrapper
 */
export async function readFileContent(
  file: File
): Promise<{ content: string; type: 'pdf' | 'markdown' | 'text' | 'json' }> {
  const res = await processUploadedFile(file, { runOcr: true });
  const mappedType: 'pdf' | 'markdown' | 'text' | 'json' =
    res.type === 'pdf' || res.type === 'markdown' || res.type === 'json' ? res.type : 'text';
  return { content: res.content, type: mappedType };
}
