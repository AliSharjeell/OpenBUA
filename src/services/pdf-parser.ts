// Client-side PDF, image, and text document parser for extracting resume/profile text and raw file data
import * as pdfjsLib from 'pdfjs-dist';
import { DocumentFileType, UserDocument } from '../types';
import { loadSettings } from './storage';

// Configure pdfjs worker to use CDN or inline fallback
try {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
} catch (e) {
  console.warn('[AutoForm AI] Could not set pdfjs workerSrc:', e);
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
): 'resume' | 'id_card' | 'photo' | 'document' | 'other' {
  const lowerName = fileName.toLowerCase();
  const lowerContent = (content || '').toLowerCase();

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
  customPrompt?: string
): Promise<string> {
  const settings = await loadSettings();
  const promptText =
    customPrompt ||
    'Extract all readable text, contact information, personal details, work experience, education, skills, and data from this document or image verbatim in structured, clean Markdown formatting. Do not hallucinate or omit any text.';

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

    // If OCR failed or was unavailable, return the sparse text if any
    return pageTexts.join('\n\n');
  } catch (error: any) {
    console.error('[AutoForm AI] Error parsing PDF with pdfjs:', error);
    // Fallback: try reading raw strings from array buffer
    try {
      const buffer = await file.arrayBuffer();
      const decoder = new TextDecoder('utf-8', { fatal: false });
      const raw = decoder.decode(buffer);
      const matches = raw.match(/\(([^()]{2,})\)/g);
      if (matches && matches.length > 10) {
        return matches.map((m) => m.slice(1, -1)).join(' ');
      }
    } catch {
      // Ignore fallback failure
    }
    throw new Error(`Failed to extract text from PDF: ${error?.message || error}`);
  }
}

export interface ParsedFileResult {
  title: string;
  fileName: string;
  type: DocumentFileType;
  mimeType: string;
  content: string;
  dataUrl: string;
  sizeBytes: number;
  ocrStatus: 'pending' | 'processing' | 'done' | 'failed';
  fileCategory: 'resume' | 'id_card' | 'photo' | 'document' | 'other';
  tags: string[];
}

/**
 * Process any uploaded file (PDF, image, markdown, json, text, or binary).
 * Generates raw base64 dataUrl, extracts content (via pdfjs or VLM OCR for images),
 * and detects category (resume, id_card, photo, document).
 */
export async function processUploadedFile(
  file: File,
  options?: { runOcr?: boolean }
): Promise<ParsedFileResult> {
  const dataUrl = await fileToDataUrl(file);
  const type = detectFileType(file.name, file.type);
  const mimeType = file.type || (type === 'pdf' ? 'application/pdf' : 'application/octet-stream');
  const cleanTitle = file.name.replace(/\.[^/.]+$/, '');

  let content = '';
  let ocrStatus: 'pending' | 'processing' | 'done' | 'failed' = 'done';

  if (type === 'pdf') {
    try {
      content = await extractTextFromPdf(file);
      ocrStatus = 'done';
    } catch (err: any) {
      console.warn('[AutoForm AI] PDF text extraction failed:', err);
      content = `[PDF Document: ${file.name}] Raw file stored. Click Extract Text to re-run OCR.`;
      ocrStatus = 'failed';
    }
  } else if (type === 'image') {
    if (options?.runOcr !== false) {
      try {
        content = await extractTextWithVlm(dataUrl, mimeType);
        ocrStatus = 'done';
      } catch (err: any) {
        console.warn('[AutoForm AI] Image VLM OCR failed:', err);
        content = `[Image: ${file.name}] Raw image file stored. Click Extract Text (OCR) to extract readable text.`;
        ocrStatus = 'failed';
      }
    } else {
      content = `[Image: ${file.name}] Raw image file stored. Click Extract Text (OCR) to extract readable text.`;
      ocrStatus = 'pending';
    }
  } else if (type === 'markdown' || type === 'json' || type === 'text') {
    content = await file.text();
    ocrStatus = 'done';
  } else {
    content = `[File: ${file.name}] Raw binary file stored. Available for form uploads.`;
    ocrStatus = 'done';
  }

  const fileCategory = detectDocumentCategory(file.name, content);
  const tags = [type];
  if (fileCategory === 'resume') {
    tags.push('resume', 'profile');
  } else if (fileCategory !== 'other' && fileCategory !== 'document') {
    tags.push(fileCategory);
  }

  return {
    title: cleanTitle,
    fileName: file.name,
    type,
    mimeType,
    content,
    dataUrl,
    sizeBytes: file.size,
    ocrStatus,
    fileCategory,
    tags,
  };
}

/**
 * Re-runs or triggers OCR / text extraction for an existing stored UserDocument
 */
export async function extractTextForDocument(doc: UserDocument): Promise<string> {
  if (!doc.dataUrl) {
    throw new Error('Document does not have stored raw file data (dataUrl).');
  }

  const mimeType = doc.mimeType || (doc.type === 'pdf' ? 'application/pdf' : 'image/png');

  if (doc.type === 'image' || mimeType.startsWith('image/')) {
    return await extractTextWithVlm(doc.dataUrl, mimeType);
  }

  if (doc.type === 'pdf' || mimeType === 'application/pdf') {
    const file = dataUrlToFile(doc.dataUrl, doc.fileName || `${doc.title}.pdf`, 'application/pdf');
    return await extractTextFromPdf(file);
  }

  throw new Error(`Text extraction not supported for file type: ${doc.type}`);
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
