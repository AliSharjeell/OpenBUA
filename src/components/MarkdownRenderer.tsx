import React, { useMemo } from 'react';
import { marked } from 'marked';

// Configure marked for clean GFM rendering
const renderer = new marked.Renderer();
renderer.link = function ({ href, title, text }) {
  const titleAttr = title ? ` title="${title}"` : '';
  return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
};

marked.setOptions({
  gfm: true,
  breaks: true,
  renderer,
});

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

function repairMarkdownTables(raw: string): string {
  if (!raw) return '';

  // 1. Convert tab-separated rows into proper Markdown tables if header has tabs
  const lines = raw.split('\n');
  const normalizedLines: string[] = [];
  let inTsvBlock = false;
  let tsvColCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // If line has multiple tabs and looks like a table row without pipes
    if (line.includes('\t') && !trimmed.startsWith('|')) {
      const parts = line.split('\t').map((p) => p.trim());
      if (parts.length >= 2) {
        if (!inTsvBlock) {
          // This is the header of a tab-separated table
          inTsvBlock = true;
          tsvColCount = parts.length;
          normalizedLines.push(`| ${parts.join(' | ')} |`);
          normalizedLines.push(`| ${parts.map(() => '---').join(' | ')} |`);
          continue;
        } else {
          // Body row of TSV table
          while (parts.length < tsvColCount) parts.push('');
          normalizedLines.push(`| ${parts.slice(0, tsvColCount).join(' | ')} |`);
          continue;
        }
      }
    } else {
      if (trimmed.length > 0 && !trimmed.startsWith('|')) {
        inTsvBlock = false;
      }
    }

    normalizedLines.push(line);
  }

  // 2. Stitch together broken table rows that have empty lines between them
  // e.g. "| 1 | ... |\n\n| 2 | ... |" -> "| 1 | ... |\n| 2 | ... |"
  const repairedLines: string[] = [];
  for (let i = 0; i < normalizedLines.length; i++) {
    const curr = normalizedLines[i];
    const currTrimmed = curr.trim();

    // Check if curr is an empty line between two pipe-delimited table rows
    if (currTrimmed === '' && repairedLines.length > 0) {
      const prevTrimmed = repairedLines[repairedLines.length - 1].trim();
      let nextRowIdx = i + 1;
      while (nextRowIdx < normalizedLines.length && normalizedLines[nextRowIdx].trim() === '') {
        nextRowIdx++;
      }
      if (nextRowIdx < normalizedLines.length) {
        const nextTrimmed = normalizedLines[nextRowIdx].trim();
        const prevIsTableRow = prevTrimmed.startsWith('|') && prevTrimmed.endsWith('|');
        const nextIsTableRow = nextTrimmed.startsWith('|') && nextTrimmed.endsWith('|');
        if (prevIsTableRow && nextIsTableRow) {
          // Skip the blank line to keep table rows contiguous
          continue;
        }
      }
    }

    repairedLines.push(curr);
  }

  let text = repairedLines.join('\n');

  // 3. Ensure empty lines around markdown tables so GFM parser always detects them
  // Even if immediately following bold text or list headers
  text = text.replace(/([^\n])\n(\|[^\n]+\|\n\|[\s\-:|]+\|)/g, '$1\n\n$2');

  return text;
}

export function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
  const html = useMemo(() => {
    if (!content) return '';
    try {
      const prepared = repairMarkdownTables(content);
      return marked.parse(prepared) as string;
    } catch (e) {
      console.warn('[MarkdownRenderer] Parse error:', e);
      return content;
    }
  }, [content]);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest('a');
    if (!target) return;
    const href = target.getAttribute('href');
    if (!href || href.startsWith('#')) return;

    e.preventDefault();
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url: href });
    } else {
      window.open(href, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div
      className={`markdown-body text-xs text-zinc-200 select-text leading-relaxed ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={handleClick}
    />
  );
}

