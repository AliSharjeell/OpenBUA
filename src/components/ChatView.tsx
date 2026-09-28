import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage, ToolCallState, AppSettings, UserDocument } from '../types';
import { FormAgentHarness } from '../agent/form-agent';
import { MarkdownRenderer } from './MarkdownRenderer';
import { Button } from './ui/button';
import { Textarea } from './ui/input';
import {
  Send,
  Square,
  Sparkles,
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Trash2,
  FileText,
  Terminal,
  Upload,
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
  onNavigateToMemory: () => void;
  onNavigateToVault?: () => void;
  onUploadDocument?: (file: File) => Promise<UserDocument>;
}

function getToolMeta(toolName: string) {
  switch (toolName) {
    case 'get_active_tab_form':
      return {
        label: 'Inspecting Page Form Elements',
        desc: 'Scanning active browser tab DOM for input fields, selects, and buttons...',
        icon: Terminal,
      };
    case 'fill_form_fields':
      return {
        label: 'Auto-Filling Form Inputs',
        desc: 'Setting input values matched from your stored memories...',
        icon: Sparkles,
      };
    case 'click_element':
      return {
        label: 'Clicking Button / Advancing',
        desc: 'Clicking button to advance to next step or submit form...',
        icon: Terminal,
      };
    case 'get_user_documents':
      return {
        label: 'Searching Stored Memory',
        desc: 'Retrieving user profile and stored memory data...',
        icon: FileText,
      };
    case 'capture_tab_screenshot':
      return {
        label: 'Capturing Screenshot',
        desc: 'Taking visual snapshot of the webpage for verification...',
        icon: Terminal,
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
  onNavigateToMemory,
  onNavigateToVault,
  onUploadDocument,
}: ChatViewProps) {
  const [input, setInput] = useState('');
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});
  const [isUploadingDoc, setIsUploadingDoc] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatFileInputRef = useRef<HTMLInputElement>(null);

  const activeDocsCount = documents.filter((d) => d.isActiveForContext).length;
  const currentKey =
    settings.activeProvider === 'anthropic' ? settings.anthropic.apiKey : settings.openai.apiKey;
  const hasKey = Boolean(currentKey && currentKey.trim().length > 3);

  const handleOpenMemory = onNavigateToMemory || onNavigateToVault;

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isBusy, activeTool]);

  const handleChatFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onUploadDocument) return;
    setIsUploadingDoc(true);
    try {
      await onUploadDocument(file);
      const confirmMsg: ChatMessage = {
        id: `doc-${Date.now()}`,
        role: 'assistant',
        content: `📄 Added document **${file.name}** to your active memory for this tab. You can now ask me to use these details to fill forms.`,
        timestamp: Date.now(),
      };
      onMessagesChange([...messages, confirmMsg]);
    } catch (err: any) {
      console.error('Failed to upload file from chat:', err);
      const errMsg: ChatMessage = {
        id: `doc-err-${Date.now()}`,
        role: 'assistant',
        content: `⚠️ Failed to upload file: ${err?.message || err}`,
        timestamp: Date.now(),
      };
      onMessagesChange([...messages, errMsg]);
    } finally {
      setIsUploadingDoc(false);
      e.target.value = '';
    }
  };

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
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

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
      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3.5">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-3">
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
                <Button size="sm" variant="outline" className="h-6 text-[10px] ml-auto rounded-full" onClick={onNavigateToSettings}>
                  Settings
                </Button>
              </div>
            )}

            {activeDocsCount === 0 && (
              <div className="p-2.5 bg-zinc-900 border border-zinc-800 rounded-md text-zinc-400 text-[11px] flex items-center gap-2">
                <FileText className="w-4 h-4 shrink-0" />
                <span>No active memories stored.</span>
                <Button size="sm" variant="outline" className="h-6 text-[10px] ml-auto rounded-full" onClick={handleOpenMemory}>
                  Add Memory
                </Button>
              </div>
            )}

            <div className="pt-2 flex flex-col gap-1.5 w-full max-w-[280px]">
              <button
                className="p-2 text-left rounded-xl bg-zinc-900/80 hover:bg-zinc-850 border border-zinc-800/80 text-[11px] text-zinc-300 hover:text-zinc-100 transition-colors flex items-center justify-between"
                onClick={() =>
                  handleSend('Scan this webpage form, match with my profile, and fill all inputs.')
                }
              >
                <span>Fill active form automatically</span>
                <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
              </button>
              <button
                className="p-2 text-left rounded-xl bg-zinc-900/80 hover:bg-zinc-850 border border-zinc-800/80 text-[11px] text-zinc-300 hover:text-zinc-100 transition-colors flex items-center justify-between"
                onClick={() => handleSend('What form fields are present on this page?')}
              >
                <span>List all form fields and types</span>
                <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
              </button>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} space-y-1.5`}
          >
            {/* Thinking / Reasoning Section (Outside Message Bubble, lighter text color) */}
            {msg.role === 'assistant' && msg.thinking && msg.thinking.trim().length > 0 && (
              <div className="max-w-[92%] px-1 text-[11px] text-zinc-400 font-sans leading-relaxed flex items-start gap-1.5 py-0.5">
                <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-500 shrink-0 font-medium select-none mt-0.5">
                  Thinking:
                </span>
                <div className="text-zinc-400 italic font-normal select-text whitespace-pre-wrap">
                  {msg.thinking}
                </div>
              </div>
            )}

            {/* Message Bubble (rendered if content or tool calls exist, or if still streaming) */}
            {(msg.content || (msg.toolCalls && msg.toolCalls.length > 0) || (msg.isStreaming && !msg.thinking)) && (
              <div
                className={`max-w-[88%] rounded-2xl p-3 text-xs ${
                  msg.role === 'user'
                    ? 'bg-zinc-800 text-zinc-100 rounded-br-sm shadow-sm'
                    : 'bg-zinc-900/90 border border-zinc-800 text-zinc-200 rounded-bl-sm shadow-sm'
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
                          className={`rounded-xl border overflow-hidden text-[11px] transition-all ${
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
                                  <pre className="text-zinc-300 bg-zinc-900/60 p-1.5 rounded-lg border border-zinc-850 whitespace-pre-wrap">
                                    {JSON.stringify(tc.args, null, 2)}
                                  </pre>
                                </div>
                              )}
                              {tc.result && (
                                <div>
                                  <span className="text-zinc-500 block font-medium mb-0.5 font-sans">
                                    Output / Result:
                                  </span>
                                  <pre className="text-zinc-300 bg-zinc-900/60 p-1.5 rounded-lg border border-zinc-850 whitespace-pre-wrap">
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
                                  <pre className="text-red-300 bg-red-950/40 p-1.5 rounded-lg border border-red-900/40 whitespace-pre-wrap">
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

                {/* Message Content: Formatted Markdown for Assistant, text for User */}
                {msg.content && (
                  <div>
                    {msg.role === 'assistant' ? (
                      <MarkdownRenderer content={msg.content} />
                    ) : (
                      <div className="whitespace-pre-wrap leading-relaxed select-text font-sans">
                        {msg.content}
                      </div>
                    )}
                  </div>
                )}

                {/* Live Streaming Indicator */}
                {msg.isStreaming && !msg.content && (
                  <span className="inline-block w-1.5 h-3.5 bg-zinc-300 ml-1 animate-pulse" />
                )}
              </div>
            )}

            <span className="text-[9px] text-zinc-600 px-1">
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
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/95 p-2 px-3 shadow-lg flex items-center justify-between gap-3 animate-in fade-in duration-200">
            {activeTool ? (
              (() => {
                const meta = getToolMeta(activeTool.toolName);
                const Icon = meta.icon;
                return (
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-6 h-6 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0 text-zinc-100">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-300" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-semibold text-zinc-100 truncate">
                          {meta.label}
                        </span>
                        <span className="font-mono text-[9px] px-1 py-0.2 bg-zinc-950 border border-zinc-800 rounded-md text-zinc-400">
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
              className="h-6 px-2 text-[10px] shrink-0 rounded-full"
              onClick={handleStop}
              title="Stop generation"
            >
              <Square className="w-2.5 h-2.5 mr-1 fill-current" />
              Stop
            </Button>
          </div>
        )}

        {/* Round "Fill Form" Action Button directly above input box */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-zinc-900 hover:bg-zinc-850 text-zinc-200 border border-zinc-800 text-[11px] font-medium transition-all shadow-sm active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
            onClick={() =>
              handleSend(
                'Inspect this current page form, cross-reference my active stored documents, and fill all matching fields.'
              )
            }
            disabled={isBusy}
          >
            <span>Fill Form</span>
          </button>
        </div>

        {/* Rounder Input Box */}
        <div className="relative flex items-end bg-zinc-900/90 rounded-2xl border border-zinc-800 focus-within:border-zinc-700 transition-colors p-1 pl-2">
          <Textarea
            ref={textareaRef}
            rows={1}
            placeholder="Ask AutoForm"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              // Auto-expand textarea height as text lines increase (up to 160px)
              if (textareaRef.current) {
                textareaRef.current.style.height = 'auto';
                textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
              }
            }}
            onKeyDown={handleKeyDown}
            className="border-0 bg-transparent min-h-[38px] max-h-40 resize-none py-2 px-2 text-xs focus-visible:ring-0 focus:outline-none overflow-y-auto leading-relaxed"
            disabled={isBusy || !hasKey}
          />

          <div className="p-1 flex items-center gap-1 shrink-0">
            <input
              ref={chatFileInputRef}
              type="file"
              accept=".pdf,.md,.markdown,.txt,.json"
              className="hidden"
              onChange={handleChatFileUpload}
              disabled={isBusy || isUploadingDoc}
            />
            <button
              type="button"
              onClick={() => chatFileInputRef.current?.click()}
              title="Upload MD or PDF to memory"
              disabled={isBusy || isUploadingDoc}
              className="p-1.5 text-zinc-400 hover:text-zinc-200 transition-colors bg-transparent border-0 rounded-full disabled:opacity-40 shrink-0"
            >
              {isUploadingDoc ? (
                <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
            </button>

            {isBusy ? (
              <Button
                variant="destructive"
                size="icon"
                className="h-8 w-8 rounded-full shadow-sm"
                onClick={handleStop}
                title="Stop generation"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
              </Button>
            ) : (
              <Button
                size="icon"
                className="h-8 w-8 rounded-full bg-zinc-100 text-zinc-950 hover:bg-zinc-200 shadow-sm"
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
            <span
              className="hover:text-zinc-300 cursor-pointer"
              onClick={handleOpenMemory}
              title="Active stored memory"
            >
              {activeDocsCount} memories active
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
