import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage, ToolCallState, AppSettings, UserDocument } from '../types';
import { FormAgentHarness } from '../agent/form-agent';
import { MarkdownRenderer } from './MarkdownRenderer';
import { Button } from './ui/button';
import { Textarea } from './ui/input';
import {
  Send,
  Square,
  FormInput,
  ChevronDown,
  AlertCircle,
  Loader2,
  Trash2,
  FileText,
  Terminal,
  Upload,
  BookOpen,
  Copy,
  Check,
  X,
  Mail,
  Keyboard,
  Globe,
  ShieldAlert,
} from 'lucide-react';
import { captchaManager, CaptchaState } from '../agent/browser-bridge';

interface ChatViewProps {
  activeSessionId?: string;
  messages: ChatMessage[];
  onMessagesChange: (msgs: ChatMessage[]) => void;
  harness: FormAgentHarness | null;
  isBusy: boolean;
  activeTool: ToolCallState | null;
  settings: AppSettings;
  documents: UserDocument[];
  onNavigateToSettings: () => void;
  onNavigateToMemory: () => void;
  onUploadDocument?: (file: File) => Promise<UserDocument>;
  inputDraft?: string;
  onInputDraftChange?: (draft: string) => void;
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
        icon: FormInput,
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
    case 'scratchpad':
      return {
        label: 'Updating Scratchpad',
        desc: 'Recording research data and notes in active session notepad...',
        icon: BookOpen,
      };
    case 'send_web_email':
      return {
        label: 'Sending Direct Email',
        desc: 'Deep-linking to prefilled compose window and dispatching email...',
        icon: Mail,
      };
    case 'press_key_combination':
      return {
        label: 'Pressing Keyboard Shortcut',
        desc: 'Dispatching keyboard combination to browser...',
        icon: Keyboard,
      };
    case 'quick_url_check':
      return {
        label: 'Checking Website URL',
        desc: 'Verifying portfolio / site reachability in background...',
        icon: Globe,
      };
    default:
      return {
        label: `Running Tool: ${toolName}`,
        desc: 'Communicating with active browser tab...',
        icon: Terminal,
      };
  }
}

function formatTimestampWithSeconds(timestamp: number): string {
  const d = new Date(timestamp);
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function formatSingleMessageAsText(msg: ChatMessage): string {
  const time = formatTimestampWithSeconds(msg.timestamp);
  const roleLabel = msg.role === 'user' ? 'User' : 'OpenBUA';
  const lines: string[] = [`[${time}] ${roleLabel}:`];

  if (msg.thinking && msg.thinking.trim()) {
    lines.push(`Thinking:\n${msg.thinking.trim()}`);
  }

  if (msg.toolCalls && msg.toolCalls.length > 0) {
    msg.toolCalls.forEach((tc) => {
      const status = tc.status === 'success' || (tc.status as string) === 'completed' ? 'Completed' : tc.status === 'error' ? 'Failed' : 'Running';
      lines.push(`Tool Call: ${tc.toolName} [${status}]`);
      if (tc.args && Object.keys(tc.args).length > 0) {
        lines.push(`Arguments:\n${JSON.stringify(tc.args, null, 2)}`);
      }
      if (tc.result) {
        const res = typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result, null, 2);
        lines.push(`Result:\n${res}`);
      }
      if (tc.errorMessage) {
        lines.push(`Error:\n${tc.errorMessage}`);
      }
    });
  }

  if (msg.content && msg.content.trim()) {
    lines.push(msg.content.trim());
  }

  return lines.join('\n\n');
}

function formatEntireChatAsText(messages: ChatMessage[]): string {
  return messages.map((m) => formatSingleMessageAsText(m)).join('\n\n---\n\n');
}

export function ChatView({
  activeSessionId = 'session_default',
  messages,
  onMessagesChange,
  harness,
  isBusy,
  activeTool,
  settings,
  documents,
  onNavigateToSettings,
  onNavigateToMemory,
  onUploadDocument,
  inputDraft,
  onInputDraftChange,
}: ChatViewProps) {
  const [input, setInput] = useState(inputDraft || '');

  useEffect(() => {
    setInput(inputDraft || '');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [inputDraft, activeSessionId]);

  const handleInputChange = (val: string) => {
    setInput(val);
    onInputDraftChange?.(val);
  };

  const [isUploadingDoc, setIsUploadingDoc] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatFileInputRef = useRef<HTMLInputElement>(null);

  const [captchaState, setCaptchaState] = useState<CaptchaState>({
    isActive: false,
    type: '',
    url: '',
    remainingSeconds: 0,
  });

  useEffect(() => {
    const unsubscribe = captchaManager.subscribe((state) => {
      setCaptchaState(state);
    });
    return () => unsubscribe();
  }, []);

  const handleSolveCaptcha = () => {
    captchaManager.resolveActiveGate(true, 'CAPTCHA marked as solved by user. Resuming automation.');
  };

  const handleSkipCaptcha = () => {
    captchaManager.resolveActiveGate(false, 'CAPTCHA skipped by user. ABORT this domain immediately and pivot to an alternate source/query.');
  };

  const currentKey =
    settings.activeProvider === 'anthropic' ? settings.anthropic.apiKey : settings.openai.apiKey;
  const hasKey = Boolean(currentKey && currentKey.trim().length > 3);

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
    handleInputChange('');
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

  const handleCopyMessage = (msg: ChatMessage) => {
    const text = formatSingleMessageAsText(msg);
    navigator.clipboard.writeText(text);
    setCopiedMessageId(msg.id);
    setTimeout(() => setCopiedMessageId(null), 2000);
  };

  return (
    <div className="relative flex-1 flex flex-col h-full overflow-hidden bg-zinc-950 text-xs">
      {/* Messages Scroll Area - Full height canvas with top and bottom clearance for floating elements */}
      <div className="flex-1 overflow-y-auto px-3.5 pt-16 pb-20 space-y-3.5 select-text">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-3">
            <div>
              <h3 className="font-semibold text-zinc-100 text-sm tracking-tight">OpenBUA</h3>
              <p className="text-[11px] text-zinc-400 mt-1 max-w-[260px] leading-relaxed">
                Autonomous browser use agent using your active browser to research, interact, and fill forms.
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
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`group flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} space-y-1.5 select-text`}
          >
            {/* Thinking / Reasoning Section (Outside Message Bubble, lighter text color) */}
            {msg.role === 'assistant' && msg.thinking && msg.thinking.trim().length > 0 && (
              <div className="max-w-[92%] px-1 text-[11px] text-zinc-400 font-sans leading-relaxed flex items-start gap-1.5 py-0.5 select-text">
                <span className="text-[11px] font-sans text-zinc-500 shrink-0 font-medium select-none mt-0.5 min-w-[50px]">
                  Thinking:
                </span>
                <div className="text-zinc-400 italic font-normal select-text whitespace-pre-wrap font-sans">
                  {msg.thinking}
                </div>
              </div>
            )}

            {/* Tool Calls (rendered outside the message bubble directly in stream background) */}
            {msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0 && (
              <div className="w-full max-w-[92%] space-y-1 py-0.5 pl-[60px] pr-1 select-text font-sans">
                {msg.toolCalls.map((tc) => {
                  const meta = getToolMeta(tc.toolName);
                  const Icon = meta.icon;
                  return (
                    <div
                      key={tc.id}
                      className="flex items-center gap-1.5 py-0.5 text-[11px] text-zinc-400 font-sans select-text leading-normal"
                    >
                      <Icon className="w-3.5 h-3.5 text-zinc-400 shrink-0 select-none" />
                      <span className="text-zinc-400 select-text cursor-text font-normal font-sans">
                        {tc.toolName}
                      </span>
                      {tc.status === 'running' && (
                        <Loader2 className="w-3 h-3 animate-spin text-zinc-400 shrink-0 ml-0.5" />
                      )}
                      {tc.status === 'error' && (
                        <span className="flex items-center gap-1 text-[10px] text-red-400 font-medium select-text font-sans ml-1">
                          <AlertCircle className="w-3 h-3 text-red-400 shrink-0" />
                          <span>{tc.errorMessage ? tc.errorMessage : 'Failed'}</span>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Message Bubble (rendered if content exists, or if user message, or if still streaming) */}
            {(msg.content || (msg.isStreaming && !msg.thinking && (!msg.toolCalls || msg.toolCalls.length === 0)) || msg.role === 'user') && (
              <div
                className={`max-w-[88%] rounded-2xl p-3 text-xs select-text font-sans ${
                  msg.role === 'user'
                    ? 'bg-[#007AFF] text-white rounded-br-sm shadow-sm'
                    : 'bg-zinc-900/90 border border-zinc-800 text-zinc-200 rounded-bl-sm shadow-sm'
                }`}
              >
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

            <div className="flex items-center gap-1.5 px-1 select-text">
              <span className="text-[9px] text-zinc-500 font-sans select-text">
                {formatTimestampWithSeconds(msg.timestamp)}
              </span>
              <button
                type="button"
                onClick={() => handleCopyMessage(msg)}
                title="Copy message transcript"
                className="opacity-0 group-hover:opacity-100 hover:text-zinc-300 text-zinc-600 transition-opacity p-0.5 rounded cursor-pointer"
              >
                {copiedMessageId === msg.id ? (
                  <Check className="w-2.5 h-2.5 text-emerald-400" />
                ) : (
                  <Copy className="w-2.5 h-2.5" />
                )}
              </button>
            </div>
          </div>
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* Floating Input Box (Positioned absolute over viewport, zero solid strip) */}
      <div className="absolute bottom-3 left-3 right-3 z-20 pointer-events-none space-y-2">
        {/* Human-in-the-Loop (HITL) CAPTCHA Intercept Gate Banner */}
        {captchaState.isActive && (
          <div className="pointer-events-auto rounded-xl border border-amber-500/60 bg-zinc-900/95 backdrop-blur-md p-3 shadow-2xl shadow-black/80 space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-6 h-6 rounded-lg bg-amber-900/80 border border-amber-600/70 flex items-center justify-center shrink-0 text-amber-200">
                  <ShieldAlert className="w-3.5 h-3.5 animate-pulse" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[11px] font-semibold text-amber-100">
                      CAPTCHA / Bot Challenge Detected
                    </span>
                    <span className="font-sans text-[9px] px-1.5 py-0.2 bg-amber-900/60 border border-amber-700/60 rounded-full text-amber-300 uppercase font-medium">
                      {captchaState.type}
                    </span>
                  </div>
                  <p className="text-[10.5px] text-amber-200/80 truncate">
                    Solve in your browser tab, or let OpenBUA auto-pivot in {captchaState.remainingSeconds}s.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={handleSolveCaptcha}
                  className="px-2.5 py-1 rounded-full text-[10.5px] font-medium bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1 transition-all active:scale-95 shadow-sm"
                  title="Confirm CAPTCHA is solved"
                >
                  <Check className="w-3 h-3" />
                  <span>I Solved It</span>
                </button>
                <button
                  type="button"
                  onClick={handleSkipCaptcha}
                  className="px-2 py-1 rounded-full text-[10.5px] font-medium bg-zinc-850 hover:bg-zinc-800 text-zinc-300 border border-zinc-700/80 flex items-center gap-1 transition-all active:scale-95"
                  title="Skip and activate automated workaround"
                >
                  <X className="w-3 h-3" />
                  <span>Skip / Pivot</span>
                </button>
              </div>
            </div>

            {/* Countdown Progress Bar */}
            <div className="w-full bg-amber-950 rounded-full h-1.5 overflow-hidden border border-amber-900/60">
              <div
                className="bg-amber-400 h-full transition-all duration-1000 ease-linear rounded-full"
                style={{ width: `${Math.max(0, (captchaState.remainingSeconds / 10) * 100)}%` }}
              />
            </div>
          </div>
        )}

        {/* Rounder, Sleek Low-Height Floating Input Box with Drop Shadow */}
        <div className="pointer-events-auto relative flex items-end bg-zinc-900/95 backdrop-blur-md rounded-[24px] border border-zinc-800/90 focus-within:border-zinc-700 transition-colors p-0.5 pl-3 shadow-2xl shadow-black/70">
          <Textarea
            ref={textareaRef}
            rows={1}
            placeholder="Ask OpenBUA"
            value={input}
            onChange={(e) => {
              handleInputChange(e.target.value);
              // Auto-expand textarea height as text lines increase (up to 140px)
              if (textareaRef.current) {
                textareaRef.current.style.height = 'auto';
                textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 140)}px`;
              }
            }}
            onKeyDown={handleKeyDown}
            className="border-0 bg-transparent min-h-[32px] max-h-36 resize-none py-1.5 px-1.5 text-xs focus-visible:ring-0 focus:outline-none overflow-y-auto leading-relaxed font-sans"
            disabled={isBusy || !hasKey}
          />

          <div className="p-0.5 flex items-center gap-1 shrink-0">
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
              className="p-1 text-zinc-400 hover:text-zinc-200 transition-colors bg-transparent border-0 rounded-full disabled:opacity-40 shrink-0"
            >
              {isUploadingDoc ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-400" />
              ) : (
                <Upload className="w-3.5 h-3.5" />
              )}
            </button>

            {isBusy ? (
              <Button
                variant="destructive"
                size="icon"
                className="h-7 w-7 rounded-full shadow-sm"
                onClick={handleStop}
                title="Stop generation"
              >
                <Square className="w-3 h-3 fill-current" />
              </Button>
            ) : (
              <Button
                size="icon"
                className="h-7 w-7 rounded-full bg-[#007AFF] text-white hover:bg-[#0071e3] disabled:opacity-40 disabled:hover:bg-[#007AFF] shadow-sm transition-colors"
                onClick={() => handleSend()}
                disabled={!input.trim() || !hasKey}
                title="Send (Enter)"
              >
                <Send className="w-3 h-3 text-white" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
