import React, { useState, useEffect } from 'react';
import { PageFormSummary, FormElementDescriptor } from '../types';
import { inspectActiveTabForm, clickActiveTabElement } from '../agent/browser-bridge';
import { Button } from './ui/button';
import { Badge, Card, CardContent } from './ui/card';
import {
  Scan,
  RefreshCw,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  ChevronRight,
  MousePointer,
  HelpCircle,
} from 'lucide-react';

interface InspectorViewProps {
  onFillRequested: (promptText?: string) => void;
}

export function InspectorView({ onFillRequested }: InspectorViewProps) {
  const [summary, setSummary] = useState<PageFormSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<string | null>(null);

  const scanPage = async () => {
    setLoading(true);
    setError(null);
    setActionStatus(null);
    try {
      const data = await inspectActiveTabForm();
      setSummary(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to scan active tab form elements');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    scanPage();
  }, []);

  const handleClickButton = async (btn: { refId: string; text: string }) => {
    setActionStatus(`Clicking "${btn.text}"...`);
    try {
      const res = await clickActiveTabElement({ refId: btn.refId });
      setActionStatus(res.message);
      // Re-scan after short delay
      setTimeout(scanPage, 800);
    } catch (e: any) {
      setActionStatus(`Failed to click: ${e?.message || e}`);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-1.5">
            <Scan className="w-4 h-4 text-zinc-300" />
            Live DOM Inspector
          </h2>
          <p className="text-[11px] text-zinc-400">
            Real-time inspection of current tab's interactive form elements
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={scanPage} disabled={loading} className="gap-1.5">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Scanning...' : 'Rescan'}
        </Button>
      </div>

      {error && (
        <div className="p-3 bg-red-950/40 border border-red-900/60 rounded-md text-red-300 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {actionStatus && (
        <div className="p-2.5 bg-zinc-900 border border-zinc-700/60 rounded-md text-zinc-300 text-[11px]">
          {actionStatus}
        </div>
      )}

      {summary && (
        <>
          {/* Page Details Card */}
          <div className="p-3 rounded-lg border border-zinc-800 bg-zinc-900/50 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-medium text-zinc-100 text-xs">{summary.title || 'Untitled Page'}</h3>
                <p className="text-[10px] text-zinc-400 truncate max-w-[260px]">{summary.url}</p>
              </div>
              <Badge variant="zinc">
                {summary.fields.filter((f) => f.isVisible).length} Visible Fields
              </Badge>
            </div>

            {summary.stepIndicators.length > 0 && (
              <div className="pt-2 border-t border-zinc-800/60">
                <span className="text-[10px] font-medium text-zinc-400 block mb-1">
                  Multi-Step Progress:
                </span>
                <div className="flex flex-wrap gap-1">
                  {summary.stepIndicators.map((step, i) => (
                    <Badge key={i} variant="secondary" className="text-[9px]">
                      {step}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Quick Fill Action */}
          <div className="flex gap-2">
            <Button
              className="flex-1 gap-1.5 bg-zinc-100 text-zinc-900 hover:bg-zinc-200"
              onClick={() => onFillRequested('Please scan the current webpage and fill all matching form fields using my stored documents.')}
            >
              <Sparkles className="w-3.5 h-3.5 text-zinc-900" />
              Fill Form with AI
            </Button>
          </div>

          {/* Action Buttons Detected */}
          {summary.buttons.length > 0 && (
            <div className="space-y-1.5">
              <h4 className="text-[11px] font-medium text-zinc-400">Page Navigation & Submit Buttons:</h4>
              <div className="flex flex-wrap gap-1.5">
                {summary.buttons.map((btn) => (
                  <Button
                    key={btn.refId}
                    size="sm"
                    variant={btn.isSubmit ? 'destructive' : btn.isNext ? 'secondary' : 'outline'}
                    className="h-6 text-[10px] gap-1"
                    onClick={() => handleClickButton(btn)}
                  >
                    <MousePointer className="w-2.5 h-2.5" />
                    {btn.text}
                    {btn.isNext && ' (Next)'}
                    {btn.isSubmit && ' (Submit)'}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Field List */}
          <div className="space-y-2">
            <h4 className="text-[11px] font-medium text-zinc-400">
              Detected Form Elements ({summary.fields.length}):
            </h4>

            {summary.fields.length === 0 ? (
              <div className="text-center py-6 text-zinc-500 border border-dashed border-zinc-800 rounded">
                No interactive form fields detected on this tab.
              </div>
            ) : (
              summary.fields.map((field) => (
                <div
                  key={field.refId}
                  className={`p-2.5 rounded-md border text-xs ${
                    field.isVisible
                      ? 'border-zinc-800 bg-zinc-900/60'
                      : 'border-zinc-900 bg-zinc-950/40 opacity-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-1">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-zinc-200">
                          {field.label || field.placeholder || field.name || field.id || 'Unnamed Field'}
                        </span>
                        {field.required && (
                          <span className="text-red-400 text-[10px] font-bold" title="Required">
                            *
                          </span>
                        )}
                        <Badge variant="zinc" className="text-[9px]">
                          {field.type}
                        </Badge>
                      </div>
                      <div className="text-[10px] text-zinc-500 font-mono">
                        id: {field.id || 'none'} | name: {field.name || 'none'} | ref: {field.refId}
                      </div>
                    </div>

                    {field.value && (
                      <Badge variant="success" className="text-[9px] shrink-0">
                        Filled
                      </Badge>
                    )}
                  </div>

                  {field.placeholder && (
                    <div className="text-[10px] text-zinc-400 mt-1">
                      Placeholder: "{field.placeholder}"
                    </div>
                  )}

                  {field.options && field.options.length > 0 && (
                    <div className="text-[10px] text-zinc-500 mt-1">
                      Options: {field.options.map((o) => o.label).slice(0, 4).join(', ')}
                      {field.options.length > 4 ? ` (+${field.options.length - 4} more)` : ''}
                    </div>
                  )}

                  {field.value && (
                    <div className="mt-1 p-1 bg-zinc-950 rounded text-[10px] font-mono text-zinc-300 truncate">
                      Value: {field.value}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
