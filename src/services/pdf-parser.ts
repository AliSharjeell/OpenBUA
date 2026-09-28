// Client-side PDF and text document parser for extracting resume/profile text
import * as pdfjsLib from 'pdfjs-dist';

// Configure pdfjs worker to use CDN or inline fallback
try {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
} catch (e) {
  console.warn('[AutoForm AI] Could not set pdfjs workerSrc:', e);
}

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

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const strings = textContent.items
        .map((item: any) => ('str' in item ? item.str : ''))
        .filter(Boolean);
      
      const pageMerged = strings.join(' ').replace(/\s+/g, ' ').trim();
      pageTexts.push(`### Page ${pageNum}\n${pageMerged}`);
    }

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
        return matches.map(m => m.slice(1, -1)).join(' ');
      }
    } catch {
      // Ignore fallback failure
    }
    throw new Error(`Failed to extract text from PDF: ${error?.message || error}`);
  }
}

export async function readFileContent(file: File): Promise<{ content: string; type: 'pdf' | 'markdown' | 'text' | 'json' }> {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';

  if (extension === 'pdf') {
    const content = await extractTextFromPdf(file);
    return { content, type: 'pdf' };
  }

  const text = await file.text();

  if (extension === 'md' || extension === 'markdown') {
    return { content: text, type: 'markdown' };
  } else if (extension === 'json') {
    return { content: text, type: 'json' };
  } else {
    return { content: text, type: 'text' };
  }
}
