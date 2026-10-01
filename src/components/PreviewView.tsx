import React, { useState } from 'react';
import { MarkdownRenderer } from './MarkdownRenderer';
import { Copy, Check, Trash2, Eye, Loader2 } from 'lucide-react';

interface PreviewViewProps {
  content: string;
  isBusy?: boolean;
  onClear?: () => void;
}

export function PreviewView({ content, isBusy = false, onClear }: PreviewViewProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('Failed to copy preview markdown:', e);
    }
  };

  const hasContent = Boolean(content && content.trim().length > 0);
  const charCount = content ? content.length : 0;
  const lineCount = content ? content.split('\n').filter(Boolean).length : 0;

  return (
    <div className="flex-1 overflow-y-auto px-4 pt-16 pb-8 bg-zinc-950 text-zinc-100 flex flex-col font-sans select-text">
      {/* Top Meta & Action Bar */}
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-zinc-800/80">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-zinc-200 tracking-tight">Live Research Preview</span>
          {isBusy && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#007AFF]/15 text-[#007AFF] border border-[#007AFF]/30 animate-pulse">
              <Loader2 className="w-2.5 h-2.5 animate-spin" />
              Live Updating
            </span>
          )}
        </div>

        {hasContent && (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-zinc-500 font-mono mr-1">
              {lineCount} {lineCount === 1 ? 'line' : 'lines'} • {charCount} chars
            </span>
            <button
              type="button"
              onClick={handleCopy}
              title="Copy Markdown"
              className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white transition-all cursor-pointer active:scale-95 shadow-xs"
            >
              {copied ? (
                <>
                  <Check className="w-3 h-3 text-emerald-400" />
                  <span className="text-emerald-400 font-medium">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  <span>Copy</span>
                </>
              )}
            </button>
            {onClear && (
              <button
                type="button"
                onClick={onClear}
                title="Clear Preview"
                className="p-1 rounded-full text-zinc-500 hover:text-red-400 hover:bg-zinc-900 transition-colors cursor-pointer"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Main Preview Markdown Body */}
      {hasContent ? (
        <div className="flex-1 bg-zinc-900/40 border border-zinc-800/70 rounded-2xl p-4 shadow-sm select-text overflow-x-auto">
          <MarkdownRenderer content={content} />
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-8 space-y-3 my-auto">
          <div className="w-12 h-12 rounded-2xl bg-zinc-900/80 border border-zinc-800 flex items-center justify-center text-zinc-400 shadow-inner">
            <Eye className="w-6 h-6 text-zinc-400" />
          </div>
          <div className="max-w-[280px] space-y-1">
            <h4 className="text-sm font-semibold text-zinc-200">No Preview Data Yet</h4>
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              When OpenBUA finds events, emails, leads, or search items, it will live-stream findings into this preview in real time as it discovers them.
            </p>
          </div>
          {isBusy && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-900 border border-zinc-800 text-[11px] text-zinc-300 shadow-xs">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#007AFF]" />
              <span>Agent is currently working...</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
