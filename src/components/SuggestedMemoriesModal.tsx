import React, { useState } from 'react';
import { SuggestedMemory } from '../types';
import { Brain, Globe, Layers, Trash2, X, Check, Sparkles, AlertCircle } from 'lucide-react';

interface SuggestedMemoriesModalProps {
  isOpen: boolean;
  onClose: () => void;
  suggestions: SuggestedMemory[];
  currentTabTitle?: string;
  onApproveAsTab: (suggestion: SuggestedMemory) => Promise<void>;
  onApproveAsGlobal: (suggestion: SuggestedMemory) => Promise<void>;
  onDiscard: (id: string) => Promise<void>;
  onClearAll?: () => Promise<void>;
}

export function SuggestedMemoriesModal({
  isOpen,
  onClose,
  suggestions,
  currentTabTitle = 'Current Chat',
  onApproveAsTab,
  onApproveAsGlobal,
  onDiscard,
  onClearAll,
}: SuggestedMemoriesModalProps) {
  const [processingId, setProcessingId] = useState<string | null>(null);

  if (!isOpen) return null;

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

  const getCategoryBadge = (category?: string) => {
    switch (category) {
      case 'profile':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            Profile Info
          </span>
        );
      case 'preference':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-500/15 text-purple-400 border border-purple-500/30">
            Preference
          </span>
        );
      case 'workflow':
      case 'task':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-sky-500/15 text-sky-400 border border-sky-500/30">
            Workflow / Task
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-zinc-800 text-zinc-300 border border-zinc-700/60">
            Fact
          </span>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 animate-in fade-in duration-200">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-xs cursor-pointer"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal Dialog */}
      <div className="relative w-full max-w-[390px] max-h-[85vh] bg-zinc-950 border border-zinc-800 rounded-3xl shadow-2xl flex flex-col overflow-hidden text-zinc-100 z-10">
        {/* Header */}
        <div className="p-4 pb-3 border-b border-zinc-800/80 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-200">
              <Brain className="w-4 h-4 text-zinc-200" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="text-sm font-semibold text-white">Suggested Memories</h3>
                {suggestions.length > 0 && (
                  <span
                    className="px-1.5 py-0.2 rounded-full text-[10px] font-bold text-white"
                    style={{ backgroundColor: '#007AFF' }}
                  >
                    {suggestions.length}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-zinc-400">
                Discovered facts and workflows you can save or discard
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            className="w-8 h-8 rounded-full bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content List */}
        <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
          {suggestions.length === 0 ? (
            <div className="py-12 px-4 flex flex-col items-center justify-center text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-zinc-900/80 border border-zinc-800 flex items-center justify-center text-zinc-500 shadow-inner">
                <Brain className="w-6 h-6 text-zinc-500" />
              </div>
              <div className="max-w-[260px] space-y-1">
                <h4 className="text-xs font-semibold text-zinc-200">No Pending Suggestions</h4>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  When OpenBUA notices facts about you (like contact info, preferences, or tasks) while working, it will suggest them here.
                </p>
              </div>
            </div>
          ) : (
            suggestions.map((sug) => {
              const isBusy = processingId === sug.id;
              return (
                <div
                  key={sug.id}
                  className="bg-zinc-900/70 border border-zinc-800/90 rounded-2xl p-3.5 space-y-2.5 transition-all shadow-sm hover:border-zinc-700/80"
                >
                  {/* Category & Date */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      {getCategoryBadge(sug.category)}
                      <span className="text-[10px] text-zinc-500">
                        {new Date(sug.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    {sug.reason && (
                      <span className="text-[10px] text-zinc-400 truncate max-w-[150px]" title={sug.reason}>
                        💡 {sug.reason}
                      </span>
                    )}
                  </div>

                  {/* Title & Content */}
                  <div>
                    <h4 className="text-xs font-semibold text-white tracking-tight">
                      {sug.title}
                    </h4>
                    <div className="mt-1.5 p-2 rounded-xl bg-zinc-950/80 border border-zinc-800/60 text-xs text-zinc-300 font-mono select-text whitespace-pre-wrap leading-relaxed break-words max-h-32 overflow-y-auto">
                      {sug.content}
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center justify-between pt-1 gap-1.5">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleDiscard(sug.id)}
                      title="Discard suggestion"
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-medium text-zinc-400 hover:text-red-400 hover:bg-zinc-800/80 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Discard</span>
                    </button>

                    <div className="flex items-center gap-1.5">
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
                </div>
              );
            })
          )}
        </div>

        {/* Footer (Clear All if items exist) */}
        {suggestions.length > 1 && onClearAll && (
          <div className="p-2.5 border-t border-zinc-900 bg-zinc-950/95 flex justify-end shrink-0">
            <button
              type="button"
              onClick={onClearAll}
              className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer px-2 py-1"
            >
              Clear all suggestions
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
