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
  const result: string[] = [];
  let inTsvBlock = false;
  let tsvColCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // If line has multiple tabs and looks like a table row without pipes
    if (line.includes('\t') && !line.trim().startsWith('|')) {
      const parts = line.split('\t').map(p => p.trim());
      if (parts.length >= 2) {
        if (!inTsvBlock) {
          // This is the header of a tab-separated table
          inTsvBlock = true;
          tsvColCount = parts.length;
          result.push(`| ${parts.join(' | ')} |`);
          result.push(`| ${parts.map(() => '---').join(' | ')} |`);
          continue;
        } else {
          // Body row of TSV table
          // Pad or trim columns to match header
          while (parts.length < tsvColCount) parts.push('');
          result.push(`| ${parts.slice(0, tsvColCount).join(' | ')} |`);
          continue;
        }
      }
    } else {
      inTsvBlock = false;
    }

    result.push(line);
  }

  let text = result.join('\n');

  // 2. Ensure empty lines around markdown tables so GFM parser always detects them
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

