import React, { useMemo } from 'react';
import { marked } from 'marked';

// Configure marked for clean GFM rendering
marked.setOptions({
  gfm: true,
  breaks: true,
});

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
  const html = useMemo(() => {
    if (!content) return '';
    try {
      return marked.parse(content) as string;
    } catch (e) {
      console.warn('[MarkdownRenderer] Parse error:', e);
      return content;
    }
  }, [content]);

  return (
    <div
      className={`markdown-body text-xs text-zinc-200 select-text leading-relaxed ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
