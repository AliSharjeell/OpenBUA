import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage, ToolCallState, AppSettings, UserDocument } from '../types';
import { FormAgentHarness } from '../agent/form-agent';
import { Button } from './ui/button';
import { Textarea } from './ui/input';
import { Badge } from './ui/card';
import {
  Send,
  Square,
  Sparkles,
  Scan,
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Trash2,
  Camera,
  ArrowRight,
  FileText,
  Terminal,
  ExternalLink,
} from 'lucide-react';

interface ChatViewProps {
  messages: ChatMessage[];
  onMessagesChange: (msgs: ChatMessage[]) => void;
  harness: FormAgentHarness | null;
  isBusy: boolean;
  activeTool: ToolCallState | null;
  settings: AppSettings;
  documents: UserDocument[];
  onNavigateToSettings: () => void;
  onNavigateToVault: () => void;
}

function getToolMeta(toolName: string) {
  switch (toolName) {
    case 'get_active_tab_form':
      return {
        label: 'Inspecting Page Form Elements',
        desc: 'Scanning active browser tab DOM for input fields, selects, and buttons...',
        icon: Scan,
      };
    case 'fill_form_fields':
      return {
        label: 'Auto-Filling Form Inputs',
        desc: 'Setting input values matched from your stored documents...',
        icon: Sparkles,
      };
    case 'click_element':
      return {
        label: 'Clicking Button / Advancing',
        desc: 'Clicking button to advance to next step or submit form...',
        icon: ArrowRight,
      };
    case 'get_user_documents':
      return {
        label: 'Searching Document Vault',
        desc: 'Retrieving user profile and stored document data...',
        icon: FileText,
      };
    case 'capture_tab_screenshot':
      return {
        label: 'Capturing Screenshot',
        desc: 'Taking visual snapshot of the webpage for verification...',
        icon: Camera,
      };
    case 'scroll_page':
      return {
        label: 'Scrolling Page',
        desc: 'Adjusting viewport to reveal additional fields...',
        icon: ChevronDown,
      };
    default:
      return {
        label: `Running Tool: ${toolName}`,
        desc: 'Communicating with active browser tab...',
        icon: Terminal,
      };
  }
}

export function ChatView({
  messages,
  onMessagesChange,
  harness,
  isBusy,
  activeTool,
  settings,
  documents,
  onNavigateToSettings,
  onNavigateToVault,
}: ChatViewProps) {
  const [input, setInput] = useState('');
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activeDocsCount = documents.filter((d) => d.isActiveForContext).length;
  const currentKey =
    settings.activeProvider === 'anthropic' ? settings.anthropic.apiKey : settings.openai.apiKey;
  const hasKey = Boolean(currentKey && currentKey.trim().length > 3);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isBusy, activeTool]);

  const handleSend = async (textToSend?: string) => {
    const promptText = (textToSend || input).trim();
    if (!promptText || isBusy) return;

    if (!hasKey) {
      onNavigateToSettings();
      return;
    }

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: promptText,
      timestamp: Date.now(),
    };

    const newMessages = [...messages, userMsg];
    onMessagesChange(newMessages);
    setInput('');

    if (harness) {
      try {
        await harness.prompt(promptText);
      } catch (e: any) {
        console.error('[ChatView] Prompt error:', e);
        const errorMsg: ChatMessage = {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: `⚠️ ${e?.message || String(e)}`,
          timestamp: Date.now(),
          isStreaming: false,
        };
        onMessagesChange([...newMessages, errorMsg]);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleStop = () => {
    if (harness) harness.abort();
  };

  const handleClear = () => {
    if (harness) harness.reset();
    onMessagesChange([]);
  };

  const toggleToolExpand = (toolId: string) => {
    setExpandedTools((prev) => ({ ...prev, [toolId]: !prev[toolId] }));
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-zinc-950 text-xs">
      {/* Quick Action Chips */}
      <div className="p-2 border-b border-zinc-900 bg-zinc-950/80 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-[10px] gap-1 shrink-0 bg-zinc-900/60 border-zinc-800 text-zinc-200 hover:bg-zinc-800"
          onClick={() =>
            handleSend(
              'Inspect this current page form, cross-reference my active stored documents, and fill all matching fields.'
            )
          }
          disabled={isBusy}
        >
          <Sparkles className="w-2.5 h-2.5 text-zinc-100" />
          Fill Form
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-[10px] gap-1 shrink-0 bg-zinc-900/60 border-zinc-800 text-zinc-300 hover:bg-zinc-800"
          onClick={() => handleSend('Inspect and list all fields and action buttons on this tab.')}
          disabled={isBusy}
        >
          <Scan className="w-2.5 h-2.5" />
          Inspect Fields
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-[10px] gap-1 shrink-0 bg-zinc-900/60 border-zinc-800 text-zinc-300 hover:bg-zinc-800"
          onClick={() =>
            handleSend(
              'Proceed to the next page or step of this form, inspect the new fields, and fill them.'
            )
          }
          disabled={isBusy}
        >
          <ArrowRight className="w-2.5 h-2.5" />
          Next Step
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-[10px] gap-1 shrink-0 bg-zinc-900/60 border-zinc-800 text-zinc-300 hover:bg-zinc-800"
          onClick={() => handleSend('Take a screenshot of the current page and check its visual state.')}
          disabled={isBusy}
        >
          <Camera className="w-2.5 h-2.5" />
          Screenshot
        </Button>
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3.5">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-3">
            <div className="w-10 h-10 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-200">
              <Sparkles className="w-5 h-5 text-zinc-200" />
            </div>
            <div>
              <h3 className="font-semibold text-zinc-200 text-xs">AutoForm AI Ready</h3>
              <p className="text-[11px] text-zinc-400 mt-1 max-w-[260px]">
                Autonomous client-side form filler powered by pi-agent-core & pi-ai.
              </p>
            </div>

            {!hasKey && (
              <div className="p-2.5 bg-amber-950/40 border border-amber-900/60 rounded-md text-amber-300 text-[11px] flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>Add your API Key in Settings to get started.</span>
                <Button size="sm" variant="outline" className="h-6 text-[10px] ml-auto" onClick={onNavigateToSettings}>
                  Settings
                </Button>
              </div>
            )}

            {activeDocsCount === 0 && (
              <div className="p-2.5 bg-zinc-900 border border-zinc-800 rounded-md text-zinc-400 text-[11px] flex items-center gap-2">
                <FileText className="w-4 h-4 shrink-0" />
                <span>No active documents in Vault.</span>
                <Button size="sm" variant="outline" className="h-6 text-[10px] ml-auto" onClick={onNavigateToVault}>
                  Add Data
                </Button>
              </div>
            )}

            <div className="pt-2 flex flex-col gap-1.5 w-full max-w-[280px]">
              <button
                className="p-2 text-left rounded-md bg-zinc-900/80 hover:bg-zinc-850 border border-zinc-800/80 text-[11px] text-zinc-300 hover:text-zinc-100 transition-colors flex items-center justify-between"
                onClick={() =>
                  handleSend('Scan this webpage form, match with my profile, and fill all inputs.')
                }
              >
                <span>⚡ Fill active form automatically</span>
                <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
              </button>
              <button
                className="p-2 text-left rounded-md bg-zinc-900/80 hover:bg-zinc-850 border border-zinc-800/80 text-[11px] text-zinc-300 hover:text-zinc-100 transition-colors flex items-center justify-between"
                onClick={() => handleSend('What form fields are present on this page?')}
              >
                <span>📋 List all form fields and types</span>
                <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
              </button>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
          >
            {/* Message Bubble */}
            <div
              className={`max-w-[88%] rounded-lg p-2.5 text-xs ${
                msg.role === 'user'
                  ? 'bg-zinc-800 text-zinc-100 rounded-br-none shadow-sm'
                  : 'bg-zinc-900/90 border border-zinc-800 text-zinc-200 rounded-bl-none shadow-sm'
              }`}
            >
              {/* Tool Calls inside assistant message */}
              {msg.toolCalls && msg.toolCalls.length > 0 && (
                <div className="space-y-1.5 mb-2.5">
                  {msg.toolCalls.map((tc) => {
                    const isExpanded = expandedTools[tc.id];
                    const meta = getToolMeta(tc.toolName);
                    const Icon = meta.icon;
                    return (
                      <div
                        key={tc.id}
                        className={`rounded-md border overflow-hidden text-[11px] transition-all ${
                          tc.status === 'running'
                            ? 'border-zinc-700 bg-zinc-900/90 shadow-sm'
                            : tc.status === 'error'
                            ? 'border-red-900/60 bg-red-950/20'
                            : 'border-zinc-800/90 bg-zinc-950/80'
                        }`}
                      >
                        <button
                          type="button"
                          className="w-full p-2 px-2.5 flex items-center justify-between hover:bg-zinc-900/60 transition-colors text-left"
                          onClick={() => toggleToolExpand(tc.id)}
                        >
                          <div className="flex items-center gap-2 font-mono text-[10px] text-zinc-300 min-w-0 pr-2">
                            <Icon className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                            <span className="font-semibold text-zinc-200">{tc.toolName}</span>
                            <span className="font-sans text-[10px] text-zinc-400 truncate">
                              • {meta.label}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {tc.status === 'running' ? (
                              <span className="flex items-center gap-1 text-[10px] text-amber-300 font-medium">
                                <Loader2 className="w-3 h-3 animate-spin text-amber-400" />
                                <span>Running</span>
                              </span>
                            ) : tc.status === 'error' ? (
                              <span className="flex items-center gap-1 text-[10px] text-red-400 font-medium">
                                <AlertCircle className="w-3 h-3 text-red-400" />
                                <span>Failed</span>
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-medium">
                                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                <span>Completed</span>
                              </span>
                            )}
                            {isExpanded ? (
                              <ChevronDown className="w-3 h-3 text-zinc-500 ml-0.5" />
                            ) : (
                              <ChevronRight className="w-3 h-3 text-zinc-500 ml-0.5" />
                            )}
                          </div>
                        </button>

                        {isExpanded && (
                          <div className="p-2.5 border-t border-zinc-900 bg-zinc-950 font-mono text-[10px] text-zinc-400 space-y-2 overflow-x-auto max-h-56 overflow-y-auto">
                            {tc.args && Object.keys(tc.args).length > 0 && (
                              <div>
                                <span className="text-zinc-500 block font-medium mb-0.5 font-sans">
                                  Arguments:
                                </span>
                                <pre className="text-zinc-300 bg-zinc-900/60 p-1.5 rounded border border-zinc-850 whitespace-pre-wrap">
                                  {JSON.stringify(tc.args, null, 2)}
                                </pre>
                              </div>
                            )}
                            {tc.result && (
                              <div>
                                <span className="text-zinc-500 block font-medium mb-0.5 font-sans">
                                  Output / Result:
                                </span>
                                <pre className="text-zinc-300 bg-zinc-900/60 p-1.5 rounded border border-zinc-850 whitespace-pre-wrap">
                                  {typeof tc.result === 'string'
                                    ? tc.result
                                    : JSON.stringify(tc.result, null, 2)}
                                </pre>
                              </div>
                            )}
                            {tc.errorMessage && (
                              <div>
                                <span className="text-red-400 block font-medium mb-0.5 font-sans">
                                  Error:
                                </span>
                                <pre className="text-red-300 bg-red-950/40 p-1.5 rounded border border-red-900/40 whitespace-pre-wrap">
                                  {tc.errorMessage}
                                </pre>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Message Text Content */}
              {msg.content && (
                <div className="whitespace-pre-wrap leading-relaxed select-text font-sans">
                  {msg.content}
                </div>
              )}

              {/* Live Streaming Indicator */}
              {msg.isStreaming && (
                <span className="inline-block w-1.5 h-3.5 bg-zinc-300 ml-1 animate-pulse" />
              )}
            </div>

            <span className="text-[9px] text-zinc-600 mt-1 px-1">
              {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Box Footer */}
      <div className="p-2.5 border-t border-zinc-900 bg-zinc-950 space-y-2">
        {/* Live Active Tool Execution Banner */}
        {isBusy && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/95 p-2 px-3 shadow-lg flex items-center justify-between gap-3 animate-in fade-in duration-200">
            {activeTool ? (
              (() => {
                const meta = getToolMeta(activeTool.toolName);
                const Icon = meta.icon;
                return (
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-6 h-6 rounded-md bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0 text-zinc-100">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-300" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-semibold text-zinc-100 truncate">
                          {meta.label}
                        </span>
                        <span className="font-mono text-[9px] px-1 py-0.2 bg-zinc-950 border border-zinc-800 rounded text-zinc-400">
                          {activeTool.toolName}
                        </span>
                      </div>
                      <p className="text-[10px] text-zinc-400 truncate">
                        {meta.desc}
                      </p>
                    </div>
                  </div>
                );
              })()
            ) : (
              <div className="flex items-center gap-2.5 min-w-0">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-400 shrink-0" />
                <span className="text-[11px] text-zinc-300 font-medium truncate">
                  AutoForm AI is reasoning & planning next action...
                </span>
              </div>
            )}

            <Button
              variant="destructive"
              size="sm"
              className="h-6 px-2 text-[10px] shrink-0"
              onClick={handleStop}
              title="Stop generation"
            >
              <Square className="w-2.5 h-2.5 mr-1 fill-current" />
              Stop
            </Button>
          </div>
        )}

        <div className="relative flex items-end bg-zinc-900 rounded-lg border border-zinc-800 focus-within:border-zinc-700 transition-colors">
          <Textarea
            ref={textareaRef}
            rows={1}
            placeholder={
              hasKey
                ? 'Ask AutoForm AI to inspect, fill, or advance form...'
                : 'Configure API Key in Settings to chat...'
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="border-0 bg-transparent min-h-[38px] max-h-24 resize-none py-2.5 px-3 text-xs focus-visible:ring-0"
            disabled={isBusy || !hasKey}
          />

          <div className="p-1 flex items-center gap-1 shrink-0">
            {isBusy ? (
              <Button
                variant="destructive"
                size="icon"
                className="h-7 w-7 rounded-md"
                onClick={handleStop}
                title="Stop generation"
              >
                <Square className="w-3 h-3 fill-current" />
              </Button>
            ) : (
              <Button
                size="icon"
                className="h-7 w-7 rounded-md bg-zinc-100 text-zinc-950 hover:bg-zinc-200"
                onClick={() => handleSend()}
                disabled={!input.trim() || !hasKey}
                title="Send (Enter)"
              >
                <Send className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </div>

        {/* Footer Status Bar */}
        <div className="flex items-center justify-between text-[10px] text-zinc-500 px-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-zinc-400">
              {settings.activeProvider === 'anthropic' ? settings.anthropic.model : settings.openai.model}
            </span>
            <span>•</span>
            <span
              className="hover:text-zinc-300 cursor-pointer"
              onClick={onNavigateToVault}
              title="Active knowledge documents"
            >
              {activeDocsCount} docs active
            </span>
          </div>

          {messages.length > 0 && (
            <button
              className="hover:text-zinc-300 flex items-center gap-1 transition-colors"
              onClick={handleClear}
              title="Clear chat transcript"
            >
              <Trash2 className="w-2.5 h-2.5" />
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
