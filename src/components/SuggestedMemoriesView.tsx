import React, { useState } from 'react';
import { SuggestedMemory } from '../types';
import { Brain, Globe, Layers, Trash2 } from 'lucide-react';

export interface SuggestedMemoriesViewProps {
  suggestions: SuggestedMemory[];
  currentTabTitle?: string;
  onApproveAsTab: (suggestion: SuggestedMemory) => Promise<void>;
  onApproveAsGlobal: (suggestion: SuggestedMemory) => Promise<void>;
  onDiscard: (id: string) => Promise<void>;
  onClearAll?: () => Promise<void>;
}

export function SuggestedMemoriesView({
  suggestions,
  currentTabTitle = 'Current Chat',
  onApproveAsTab,
  onApproveAsGlobal,
  onDiscard,
  onClearAll,
}: SuggestedMemoriesViewProps) {
  const [processingId, setProcessingId] = useState<string | null>(null);

  const handleApproveTab = async (sug: SuggestedMemory) => {
    setProcessingId(sug.id);
    try {
      await onApproveAsTab(sug);
    } finally {
      setProcessingId(null);
    }
  };

  const handleApproveGlobal = async (sug: SuggestedMemory) => {
    setProcessingId(sug.id);
    try {
      await onApproveAsGlobal(sug);
    } finally {
      setProcessingId(null);
    }
  };

  const handleDiscard = async (id: string) => {
    setProcessingId(id);
    try {
      await onDiscard(id);
    } finally {
      setProcessingId(null);
    }
  };


  return (
    <div className="flex-1 overflow-y-auto px-4 pt-16 pb-8 bg-zinc-950 text-zinc-100 flex flex-col font-sans select-text">

      {/* Content List */}
      <div className="flex-1 space-y-3">
        {suggestions.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-500 shadow-inner">
              <Brain className="w-6 h-6 text-zinc-500" />
            </div>
            <div className="max-w-[260px] space-y-1">
              <h4 className="text-xs font-semibold text-zinc-200">No Pending Suggestions</h4>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                When OpenBUA detects personal details, preferences, or repeatable task steps while working, they will appear here.
              </p>
            </div>
          </div>
        ) : (
          suggestions.map((sug) => {
            const isBusy = processingId === sug.id;
            return (
              <div
                key={sug.id}
                className="relative bg-zinc-900/70 border border-zinc-800/90 rounded-2xl p-3.5 space-y-2.5 transition-all shadow-sm hover:border-zinc-700/80"
                style={{ fontFamily: "'Inter', sans-serif" }}
              >
                {/* Trash icon — top right */}
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => handleDiscard(sug.id)}
                  title="Discard suggestion"
                  className="absolute top-3 right-3 p-1 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-zinc-800/80 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>

                {/* Title & Content */}
                <div className="pr-7">
                  <h4 className="text-xs font-semibold text-white tracking-tight">
                    {sug.title}
                  </h4>
                  <div className="mt-1.5 p-2 rounded-xl bg-zinc-950/80 border border-zinc-800/60 text-xs text-zinc-300 select-text whitespace-pre-wrap leading-relaxed break-words max-h-40 overflow-y-auto" style={{ fontFamily: "'Inter', sans-serif" }}>
                    {sug.content}
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center justify-end pt-1 gap-1.5">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleApproveTab(sug)}
                    title={`Save to this tab (${currentTabTitle})`}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-medium bg-zinc-800 hover:bg-zinc-700 border border-zinc-700/80 text-zinc-200 transition-all cursor-pointer active:scale-95 disabled:opacity-50 shadow-xs"
                  >
                    <Layers className="w-3 h-3 text-zinc-400" />
                    <span>Tab Memory</span>
                  </button>

                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleApproveGlobal(sug)}
                    title="Save to Global Memories (shared across all chats)"
                    className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[11px] font-medium text-white transition-all cursor-pointer active:scale-95 disabled:opacity-50 shadow-xs"
                    style={{ backgroundColor: '#007AFF' }}
                  >
                    <Globe className="w-3 h-3 text-white" />
                    <span>Global</span>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
