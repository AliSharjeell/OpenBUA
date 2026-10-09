import { attachmentReferences } from '../services/attachment-references';
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
  ChevronRight,
  AlertCircle,
  Loader2,
  Trash2,
  FileText,
  Terminal,
  Upload,
  Plus,
  BookOpen,
  Copy,
  Check,
  X,
  Mail,
  Keyboard,
  Globe,
  Wrench,
  Brain,
  PanelsTopLeft,
} from 'lucide-react';
import { captchaManager, CaptchaState } from '../agent/browser-bridge';
import { ThinkingOrb } from 'thinking-orbs';

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
  onPreparePrompt?: (text: string) => Promise<string>;
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
    case 'append_to_preview':
      return {
        label: 'Updating Live Preview',
        desc: 'Appending discovered finding or table row to Live Preview...',
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
    case 'suggest_memory':
      return {
        label: 'Suggesting New Memory',
        desc: 'Proposing discovered fact, preference, or workflow to save...',
        icon: Brain,
      };
    case 'search_web':
      return {
        label: 'Searching the Web',
        desc: 'Running fast background web search for snippets and answers...',
        icon: Globe,
      };
    case 'open_new_tab':
      return {
        label: 'Opening New Tab',
        desc: 'Opening destination in a new browser tab...',
        icon: Globe,
      };
    case 'close_tab':
      return {
        label: 'Closing Tab',
        desc: 'Closing background tab...',
        icon: Terminal,
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

export function formatSingleMessageAsText(msg: ChatMessage): string {
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
      if (tc.result !== undefined && tc.result !== null) {
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

export function formatEntireChatAsText(messages: ChatMessage[]): string {
  return messages.map((m) => formatSingleMessageAsText(m)).join('\n\n---\n\n');
}

function formatThoughtDuration(ms?: number, fallbackLength?: number): string {
  let effectiveMs = ms;
  if (!effectiveMs || effectiveMs <= 0) {
    if (fallbackLength && fallbackLength > 0) {
      effectiveMs = Math.max(1000, Math.round((fallbackLength / 60) * 1000));
    } else {
      effectiveMs = 2000;
    }
  }

  const totalSecs = Math.max(1, Math.round(effectiveMs / 1000));
  if (totalSecs < 60) {
    return `${totalSecs}s`;
  }
  const mins = Math.floor(totalSecs / 60);
  const remainingSecs = totalSecs % 60;
  if (remainingSecs === 0) {
    return `${mins}m`;
  }
  return `${mins}m ${remainingSecs}s`;
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
  onPreparePrompt,
  inputDraft,
  onInputDraftChange,
}: ChatViewProps) {
  const [input, setInput] = useState(inputDraft || '');
  const [parallelEnabled, setParallelEnabled] = useState(false);
  useEffect(() => { setParallelEnabled(false); }, [activeSessionId]);
  const [isPreparingFiles, setIsPreparingFiles] = useState(false);
  const chatScopeRef = useRef(activeSessionId);
  chatScopeRef.current = activeSessionId;
  const [mentionCursor, setMentionCursor] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionsDismissed, setMentionsDismissed] = useState(false);
  const attachments = attachmentReferences(documents);
  const mention = input.slice(0, mentionCursor).match(/@([^\s@]*)$/);
  const mentionOptions = mention && !mentionsDismissed ? attachments.filter(({doc, alias}) =>
    `${alias} ${doc.fileName || doc.title}`.toLowerCase().includes(mention[1].toLowerCase())).slice(0, 8) : [];

  const [expandedThoughtIds, setExpandedThoughtIds] = useState<Record<string, boolean>>({});
  const [expandedToolsIds, setExpandedToolsIds] = useState<Record<string, boolean>>({});

  const toggleThought = (msgId: string) => {
    setExpandedThoughtIds((prev) => {
      const targetMsg = messages.find((m) => m.id === msgId);
      const isCurrentlyStreamingBlock = Boolean(
        targetMsg?.isStreaming && (!targetMsg.content || targetMsg.content.length === 0)
      );
      const currentExpanded = prev[msgId] !== undefined ? prev[msgId] : isCurrentlyStreamingBlock;
      return {
        ...prev,
        [msgId]: !currentExpanded,
      };
    });
  };

  const toggleTools = (msgId: string) => {
    setExpandedToolsIds((prev) => {
      const targetMsg = messages.find((m) => m.id === msgId);
      const isRunningAnyTool = Boolean(targetMsg?.toolCalls?.some((tc) => tc.status === 'running'));
      const isCurrentlyStreamingTools = Boolean(
        isRunningAnyTool || (targetMsg?.isStreaming && (!targetMsg.content || targetMsg.content.length === 0))
      );
      const currentExpanded = prev[msgId] !== undefined ? prev[msgId] : isCurrentlyStreamingTools;
      return {
        ...prev,
        [msgId]: !currentExpanded,
      };
    });
  };

  useEffect(() => {
    setInput(inputDraft || '');
  }, [inputDraft]);

  // Auto-extend textarea height up to 6 lines (136px) as user writes
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const targetHeight = Math.min(Math.max(el.scrollHeight, 32), 136);
    el.style.height = `${targetHeight}px`;
  }, [input, activeSessionId]);

  const handleInputChange = (val: string) => {
    setInput(val);
    onInputDraftChange?.(val);
  };

  const [isUploadingDoc, setIsUploadingDoc] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatFileInputRef = useRef<HTMLInputElement>(null);

  const [isAtBottom, setIsAtBottom] = useState(true);
  const isAtBottomRef = useRef(true);
  const manualScrollTimestampRef = useRef<number>(0);

  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;

    // If programmatic smooth scrolling was recently triggered, ignore intermediate frames
    if (Date.now() < manualScrollTimestampRef.current) {
      setIsAtBottom(true);
      isAtBottomRef.current = true;
      return;
    }

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    // Generous threshold to accommodate subpixel scaling and momentum scrolling
    const atBottom = distanceFromBottom <= 80;
    setIsAtBottom(atBottom);
    isAtBottomRef.current = atBottom;
  };

  const [captchaState, setCaptchaState] = useState<CaptchaState>({
    isActive: false,
    isManualSolving: false,
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

  const handleManualSolvingCaptcha = () => {
    captchaManager.pauseForManualSolving();
  };

  const handleContinueCaptcha = () => {
    captchaManager.resolveActiveGate(true, 'CAPTCHA marked as resolved by user. Resuming automation.');
  };

  const handleSkipCaptcha = () => {
    captchaManager.resolveActiveGate(false, 'CAPTCHA challenge skipped by user. Pivoting to alternate source.');
  };

  const currentKey =
    settings.selectedMode === 'free'
      ? settings.free?.apiKey
      : settings.activeProvider === 'anthropic'
      ? settings.anthropic.apiKey
      : settings.openai.apiKey;
  const hasKey = Boolean(currentKey && currentKey.trim().length > 3);

  const scrollToBottom = (smooth = true) => {
    const el = scrollContainerRef.current;
    if (!el) return;
    isAtBottomRef.current = true;
    setIsAtBottom(true);
    if (smooth) {
      manualScrollTimestampRef.current = Date.now() + 600;
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  };

  // Follow streaming and message updates if user was already at the bottom
  useEffect(() => {
    if (isAtBottomRef.current) {
      const el = scrollContainerRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
      const raf = requestAnimationFrame(() => {
        if (isAtBottomRef.current && el) {
          el.scrollTop = el.scrollHeight;
        }
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [messages, isBusy, activeTool]);

  // Real-time MutationObserver to track micro-mutations and token streaming
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    let rafId: number | null = null;

    const observer = new MutationObserver(() => {
      if (isAtBottomRef.current) {
        if (rafId === null) {
          rafId = requestAnimationFrame(() => {
            if (isAtBottomRef.current && el) {
              el.scrollTop = el.scrollHeight;
            }
            rafId = null;
          });
        }
      }
    });

    observer.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => {
      observer.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

  // When active session changes, reset scroll to bottom
  useEffect(() => {
    scrollToBottom(false);
  }, [activeSessionId]);

  const handleChatFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length || !onUploadDocument) return;
    const uploadScope = activeSessionId;
    const confirmations: ChatMessage[] = [];
    setIsUploadingDoc(true);
    try {
      for (const file of files) {
        try {
          await onUploadDocument(file);
          confirmations.push({id: `doc-${Date.now()}-${confirmations.length}`, role: 'assistant',
            content: `Added **${file.name}** to this tab's Memory. Reference it with @ or click its file card.`, timestamp: Date.now()});
        } catch (error: any) {
          confirmations.push({id: `doc-error-${Date.now()}-${confirmations.length}`, role: 'assistant',
            content: `Could not attach **${file.name}**: ${error?.message || error}`, timestamp: Date.now()});
        }
      }
      if (chatScopeRef.current === uploadScope) onMessagesChange([...messages, ...confirmations]);
    } finally {
      setIsUploadingDoc(false);
      e.target.value = '';
    }
  };

  const handleSend = async (textToSend?: string) => {
    const promptText = (textToSend || input).trim();
    if (!promptText || isBusy || isPreparingFiles || isUploadingDoc || !harness) return;

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

    const promptScope = activeSessionId;
    const newMessages = [...messages, userMsg];
    onMessagesChange(newMessages);
    handleInputChange('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    // Immediately snap to bottom for user message
    manualScrollTimestampRef.current = Date.now() + 600;
    isAtBottomRef.current = true;
    setIsAtBottom(true);
    scrollToBottom(false);

    if (harness) {
      try {
        setIsPreparingFiles(true);
        const prepared = onPreparePrompt ? await onPreparePrompt(promptText) : promptText;
        setIsPreparingFiles(false);
        if (chatScopeRef.current !== promptScope) return;
        harness.setParallelEnabled(parallelEnabled);
        await harness.prompt(prepared);
      } catch (e: any) {
        console.error('[ChatView] Prompt error:', e);
        if (chatScopeRef.current === promptScope) onMessagesChange([...newMessages, {id: `file-error-${Date.now()}`, role: 'assistant', content: `Could not prepare attachments: ${e?.message || e}`, timestamp: Date.now()}]);
      } finally {
        setIsPreparingFiles(false);
      }
    }
  };

  const insertMention = (token: string, replaceQuery = false) => {
    const caret = textareaRef.current?.selectionStart ?? input.length;
    const start = replaceQuery && mention ? caret - mention[0].length : caret;
    const value = `${input.slice(0, start)}${token} ${input.slice(caret)}`;
    handleInputChange(value);
    setMentionsDismissed(true);
    const nextCaret = start + token.length + 1;
    setMentionCursor(nextCaret);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionOptions.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex(index => (index + (e.key === 'ArrowDown' ? 1 : -1) + mentionOptions.length) % mentionOptions.length);
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); setMentionsDismissed(true); return; }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault();
        insertMention(mentionOptions[mentionIndex % mentionOptions.length].token, true);
        return;
      }
    }

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

  // Deduplicate consecutive assistant messages that share identical content or were split during tool execution
  const displayMessages = React.useMemo(() => {
    const result: ChatMessage[] = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const prev = result[result.length - 1];

      // If this message and previous message are consecutive assistant messages within 15 seconds of each other
      // and either have identical content or one is just the tools for the previous one, merge them
      if (
        prev &&
        prev.role === 'assistant' &&
        msg.role === 'assistant' &&
        Math.abs(msg.timestamp - prev.timestamp) < 15000 &&
        (!msg.content || !prev.content || msg.content.trim() === prev.content.trim())
      ) {
        result[result.length - 1] = {
          ...prev,
          content: prev.content || msg.content,
          thinking: prev.thinking || msg.thinking,
          thinkingDurationMs: prev.thinkingDurationMs || msg.thinkingDurationMs,
          toolCalls: [...(prev.toolCalls || []), ...(msg.toolCalls || [])].filter(
            (tc, idx, arr) => arr.findIndex((t) => t.id === tc.id) === idx
          ),
          isStreaming: prev.isStreaming || msg.isStreaming,
        };
      } else {
        result.push(msg);
      }
    }
    return result;
  }, [messages]);

  return (
    <div className="relative flex-1 flex flex-col h-full overflow-hidden bg-zinc-950 text-xs">
      {/* Messages Scroll Area - Full height canvas with top and bottom clearance for floating elements */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-3.5 pt-16 pb-8 space-y-3.5 select-text"
      >
        {displayMessages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-3">
            <div className="flex flex-col items-center">
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

        {displayMessages.map((msg) => (
          <div
            key={msg.id}
            className={`group flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} space-y-1.5 select-text`}
          >
            {/* Thought Collapsible Accordion */}
            {msg.role === 'assistant' && msg.thinking && msg.thinking.trim().length > 0 && (() => {
              const isCurrentlyStreamingThought = Boolean(
                msg.isStreaming && (!msg.content || msg.content.length === 0)
              );
              const isExpanded = expandedThoughtIds[msg.id] ?? isCurrentlyStreamingThought;
              const durationLabel = isCurrentlyStreamingThought
                ? 'Thinking...'
                : `Thought for ${formatThoughtDuration(msg.thinkingDurationMs, msg.thinking.length)}`;

              return (
                <div className="w-full max-w-[92%] flex flex-col items-start py-0.5 select-text font-sans">
                  {/* Clickable Header: "Thought for ___mins/secs" with Chevron */}
                  <button
                    type="button"
                    onClick={() => toggleThought(msg.id)}
                    className="flex items-center gap-1.5 py-1 px-1.5 rounded-lg text-[11px] font-sans text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60 transition-colors cursor-pointer select-none group/thought"
                    title={isExpanded ? 'Click to collapse thoughts' : 'Click to expand thoughts'}
                  >
                    <span className="font-medium tracking-tight text-zinc-400 group-hover/thought:text-zinc-200">
                      {durationLabel}
                    </span>
                    <ChevronRight
                      className={`w-3 h-3 text-zinc-500 group-hover/thought:text-zinc-300 transition-transform duration-200 shrink-0 ${
                        isExpanded ? 'rotate-90' : 'rotate-0'
                      }`}
                    />
                  </button>

                  {/* Expandable Reasoning Body */}
                  {isExpanded && (
                    <div className="w-full pl-2 pr-1 pt-1 pb-1 animate-in fade-in duration-150">
                      <div className="border-l-2 border-zinc-800 pl-2.5 py-0.5 text-[11px] text-zinc-400 italic font-normal whitespace-pre-wrap select-text leading-relaxed font-sans">
                        {msg.thinking}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Tools Used Collapsible Accordion */}
            {msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0 && (() => {
              const isRunningAnyTool = msg.toolCalls.some((tc) => tc.status === 'running');
              const isCurrentlyStreamingTools = Boolean(
                isRunningAnyTool || (msg.isStreaming && (!msg.content || msg.content.length === 0))
              );
              const isExpanded = expandedToolsIds[msg.id] ?? isCurrentlyStreamingTools;
              const toolCount = msg.toolCalls.length;
              const toolsLabel = isRunningAnyTool
                ? `Using tools (${toolCount})...`
                : `Tools used (${toolCount})`;

              return (
                <div className="w-full max-w-[92%] flex flex-col items-start py-0.5 select-text font-sans">
                  {/* Clickable Header: "Tools used (X)" with Chevron */}
                  <button
                    type="button"
                    onClick={() => toggleTools(msg.id)}
                    className="flex items-center gap-1.5 py-1 px-1.5 rounded-lg text-[11px] font-sans text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60 transition-colors cursor-pointer select-none group/tools"
                    title={isExpanded ? 'Click to collapse tools' : 'Click to expand tools'}
                  >
                    <Wrench className="w-3 h-3 text-zinc-500 group-hover/tools:text-zinc-300 shrink-0" />
                    <span className="font-medium tracking-tight text-zinc-400 group-hover/tools:text-zinc-200">
                      {toolsLabel}
                    </span>
                    {isRunningAnyTool && (
                      <Loader2 className="w-3 h-3 animate-spin text-zinc-400 shrink-0 ml-0.5" />
                    )}
                    <ChevronRight
                      className={`w-3 h-3 text-zinc-500 group-hover/tools:text-zinc-300 transition-transform duration-200 shrink-0 ${
                        isExpanded ? 'rotate-90' : 'rotate-0'
                      }`}
                    />
                  </button>

                  {/* Expandable Tool Calls List */}
                  {isExpanded && (
                    <div className="w-full pl-2 pr-1 pt-1 pb-1 animate-in fade-in duration-150">
                      <div className="border-l-2 border-zinc-800/60 pl-2.5 py-0.5 space-y-1 select-text font-sans">
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
                    </div>
                  )}
                </div>
              );
            })()}

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

        {/* Dynamic bottom spacer to ensure message content is never occluded by floating input, thinking pill, or captcha */}
        {displayMessages.length > 0 && (
          <div
            className={`shrink-0 transition-all duration-200 pointer-events-none ${
              captchaState.isActive
                ? 'h-48'
                : isBusy
                ? 'h-36'
                : 'h-24'
            }`}
            aria-hidden="true"
          />
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Bottom Blur Feather Overlay (Light subtle blur) */}
      <div
        className="pointer-events-none absolute bottom-0 left-0 right-0 h-16 z-10"
        style={{
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
          maskImage: 'linear-gradient(to top, black 0%, black 25%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to top, black 0%, black 25%, transparent 100%)',
        }}
      />

      {/* Floating Input Box (Positioned absolute over viewport, zero solid strip) */}
      <div className="absolute bottom-3 left-3 right-3 z-20 pointer-events-none space-y-2">
        {/* Human-in-the-Loop (HITL) Minimal CAPTCHA Popup */}
        {captchaState.isActive && (
          <div className="pointer-events-auto rounded-2xl border border-zinc-800 bg-zinc-900/95 backdrop-blur-md p-3 shadow-2xl space-y-2.5 animate-in fade-in slide-in-from-bottom-2 duration-200">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] font-medium text-white tracking-tight pl-0.5">
                Captcha Detected
              </span>

              {captchaState.isManualSolving ? (
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={handleContinueCaptcha}
                    className="px-3.5 py-1.5 rounded-full text-[11px] font-medium bg-[#007AFF] hover:bg-[#0071E3] text-white transition-all active:scale-95 shadow-sm"
                  >
                    Continue
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={handleManualSolvingCaptcha}
                    className="px-3 py-1.5 rounded-full text-[11px] font-medium bg-[#007AFF] hover:bg-[#0071E3] text-white transition-all active:scale-95 shadow-sm"
                  >
                    Solving it manually
                  </button>
                  <button
                    type="button"
                    onClick={handleSkipCaptcha}
                    className="px-2.5 py-1.5 rounded-full text-[11px] font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700/60 transition-all active:scale-95"
                  >
                    Skip / Pivot
                  </button>
                </div>
              )}
            </div>

            {/* Countdown Progress Bar (hidden during manual solving) */}
            {!captchaState.isManualSolving && (
              <div className="w-full bg-zinc-800 rounded-full h-1 overflow-hidden">
                <div
                  className="bg-zinc-400 h-full transition-all duration-1000 ease-linear rounded-full"
                  style={{ width: `${Math.max(0, (captchaState.remainingSeconds / 10) * 100)}%` }}
                />
              </div>
            )}
          </div>
        )}

        {/* Floating Controls Area above Input Box (Scroll-to-bottom button & Thinking pill) */}
        <div className="flex flex-col items-center gap-1.5 pointer-events-none">
          {/* Circle White Scroll-to-Bottom Button */}
          {!isAtBottom && (
            <button
              type="button"
              onClick={() => scrollToBottom(true)}
              className="pointer-events-auto w-7 h-7 rounded-full bg-white text-zinc-950 hover:bg-zinc-100 shadow-xl shadow-black/70 flex items-center justify-center transition-all cursor-pointer active:scale-95 animate-in fade-in zoom-in-75 duration-200"
              title="Scroll to bottom"
            >
              <ChevronDown className="w-4 h-4 stroke-[2.5]" />
            </button>
          )}

          {/* Floating Agent's Thinking Pill above input box */}
          {isBusy && (
            <div className="flex justify-center pointer-events-auto">
              <div className="inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-zinc-900/95 border border-zinc-800/90 shadow-xl shadow-black/70 animate-in fade-in slide-in-from-bottom-1 duration-200">
                <ThinkingOrb state="solving" size={20} />
                <span className="text-xs font-medium tracking-wide select-none agent-thinking-glow font-sans">
                  Agent&apos;s Thinking
                </span>
              </div>
            </div>
          )}
        </div>

        {isPreparingFiles && (
          <div className="pointer-events-auto flex items-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-900 p-2 text-xs text-zinc-300" role="status">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading attachments into Memory?
          </div>
        )}
        {mentionOptions.length > 0 && (
          <div className="pointer-events-auto max-h-52 overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-900 p-1 shadow-xl" role="listbox" aria-label="Reference an attachment" id="attachment-mentions">
            {mentionOptions.map(({doc, alias, token}, index) => (
              <button key={doc.id} type="button" role="option" aria-selected={index === mentionIndex % mentionOptions.length}
                onMouseDown={event => event.preventDefault()} onClick={() => insertMention(token, true)}
                className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs ${index === mentionIndex % mentionOptions.length ? 'bg-zinc-700 text-white' : 'text-zinc-300 hover:bg-zinc-800'}`}>
                <span className="text-blue-400">@{alias}</span><span className="truncate">{doc.fileName || doc.title}</span>
              </button>
            ))}
          </div>
        )}
        {attachments.length > 0 && (
          <div className="pointer-events-auto flex w-full min-w-0 max-w-full shrink-0 flex-nowrap gap-2 overflow-x-auto overflow-y-hidden rounded-2xl border border-zinc-800/90 bg-zinc-900/95 p-2 shadow-xl" aria-label="Attached files" tabIndex={0}
            onWheel={event => { if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) event.currentTarget.scrollLeft += event.deltaY; }}>
            {attachments.map(({doc, alias, token}) => (
              <button key={doc.id} type="button" onClick={() => insertMention(token)} disabled={isBusy || isPreparingFiles}
                title={`Reference ${doc.fileName || doc.title} using @${alias}`}
                className="flex shrink-0 items-center gap-2 rounded-xl border border-zinc-700/70 bg-zinc-800/60 p-2 text-left hover:bg-zinc-700 disabled:opacity-50 max-w-52">
                {(doc.thumbnailUrl || (doc.type === 'image' && doc.dataUrl)) ? (
                  <img src={doc.thumbnailUrl || doc.dataUrl} alt="" className="h-8 w-8 rounded-lg object-cover" />
                ) : <FileText className="h-5 w-5 shrink-0 text-zinc-400" />}
                <span className="min-w-0"><span className="block truncate text-[11px] text-zinc-200">{doc.fileName || doc.title}</span>
                  <span className="flex items-center gap-1.5 text-[10px]"><span className="text-blue-400">@{alias}</span><span className="text-zinc-500">{doc.isGlobal ? 'Global' : 'This tab'}</span></span></span>
              </button>
            ))}
          </div>
        )}

        {/* Rounder, Sleek Low-Height Floating Input Box with Drop Shadow */}
        <div className="pointer-events-auto relative flex items-end bg-zinc-900/95 rounded-[24px] border border-zinc-800/90 focus-within:border-zinc-700 transition-colors p-1 pl-1.5 pr-1 shadow-2xl shadow-black/70">
          {/* Start of Bar: Plus Button for Memory Document Upload */}
          <input
            ref={chatFileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleChatFileUpload}
            disabled={isBusy || isUploadingDoc || isPreparingFiles}
          />
          <button
            type="button"
            onClick={() => chatFileInputRef.current?.click()}
            title="Attach files, images or videos"
            disabled={isBusy || isUploadingDoc || isPreparingFiles}
            className="w-7 h-7 self-center flex items-center justify-center text-white hover:text-white/80 transition-colors bg-transparent border-0 rounded-full disabled:opacity-40 shrink-0 cursor-pointer"
          >
            {isUploadingDoc ? (
              <Loader2 className="w-4 h-4 animate-spin text-white" />
            ) : (
              <Plus className="w-4 h-4 text-white" />
            )}
          </button>

          <Textarea
            ref={textareaRef}
            rows={1}
            placeholder={harness ? 'Ask OpenBUA ? @ to reference files' : 'Loading saved data…'}
            value={input}
            onChange={(e) => {
              handleInputChange(e.target.value);
              setMentionCursor(e.target.selectionStart);
              setMentionIndex(0);
              setMentionsDismissed(false);
              // Auto-expand textarea height as text lines increase (up to 6 lines, 136px)
              if (textareaRef.current) {
                textareaRef.current.style.height = 'auto';
                textareaRef.current.style.height = `${Math.min(Math.max(textareaRef.current.scrollHeight, 32), 136)}px`;
              }
            }}
            onSelect={event => setMentionCursor(event.currentTarget.selectionStart)}
            aria-controls={mentionOptions.length ? 'attachment-mentions' : undefined}
            aria-expanded={mentionOptions.length > 0}
            onKeyDown={handleKeyDown}
            className="border-0 bg-transparent min-h-[32px] max-h-[136px] resize-none py-1.5 px-1.5 text-xs focus-visible:ring-0 focus:outline-none overflow-y-auto leading-relaxed font-sans flex-1"
            disabled={isBusy || isPreparingFiles || !hasKey || !harness}
          />

          <button
            type="button"
            aria-label="Parallel subagent Chrome windows"
            aria-pressed={parallelEnabled}
            title="Parallel subagent Chrome windows: let OpenBUA split independent tasks across up to 3 separate Chrome windows and collect their results. Off by default. Each worker uses your selected model and API key."
            disabled={isBusy || isPreparingFiles || !harness}
            onClick={() => setParallelEnabled(value => !value)}
            className={`self-center shrink-0 h-7 w-7 rounded-full flex items-center justify-center transition-colors disabled:opacity-40 ${parallelEnabled ? 'bg-blue-500/20 text-blue-500' : 'text-muted-foreground hover:bg-muted'}`}
          >
            <PanelsTopLeft className="w-4 h-4" />
          </button>
          {/* End of Bar: Send / Stop Button */}
          <div className="self-center flex items-center shrink-0">
            {isBusy ? (
              <Button
                variant="destructive"
                size="icon"
                className="h-7 w-7 rounded-full shadow-sm flex items-center justify-center cursor-pointer"
                onClick={handleStop}
                title="Stop generation"
              >
                <Square className="w-3 h-3 fill-current" />
              </Button>
            ) : (
              <Button
                size="icon"
                className="h-7 w-7 rounded-full bg-[#007AFF] text-white hover:bg-[#0071e3] disabled:opacity-40 disabled:hover:bg-[#007AFF] shadow-sm transition-colors cursor-pointer flex items-center justify-center"
                onClick={() => handleSend()}
                disabled={!input.trim() || isPreparingFiles || isUploadingDoc || !hasKey || !harness}
                title={harness ? 'Send (Enter)' : 'Loading saved data…'}
              >
                <Send className="w-3.5 h-3.5 text-white" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
