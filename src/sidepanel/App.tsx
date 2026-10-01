import React, { useState, useEffect, useRef } from 'react';
import {
  AppSettings,
  UserDocument,
  ChatMessage,
  ToolCallState,
  ChatSession,
  ModelMode,
  SuggestedMemory,
} from '../types';
import {
  loadSettings,
  loadGlobalMemories,
  loadTabMemories,
  saveTabMemory,
  saveGlobalMemory,
  loadChatHistoryForTab,
  saveChatHistoryForTab,
  loadChatSessions,
  saveChatSessions,
  createNewChatSession,
  deleteChatSession,
  renameChatSession,
  setActiveSessionIdState,
  saveLastActiveState,
  loadLastActiveState,
  getScratchpad,
  clearScratchpad,
  loadSuggestedMemories,
  deleteSuggestedMemory,
  clearSuggestedMemories,
  DEFAULT_SETTINGS,
} from '../services/storage';
import { readFileContent } from '../services/pdf-parser';
import { FormAgentHarness } from '../agent/form-agent';
import { ChatView, formatEntireChatAsText } from '../components/ChatView';
import { MemoryView } from '../components/MemoryView';
import { SettingsView } from '../components/SettingsView';
import { PreviewView } from '../components/PreviewView';
import { SuggestedMemoriesView } from '../components/SuggestedMemoriesView';
import {
  MessageSquare,
  Layers,
  Settings,
  Plus,
  X,
  Pencil,
  Trash2,
  Check,
  Copy,
  ArrowLeft,
  Eye,
  Brain,
} from 'lucide-react';

function TwoLineMenu({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="3" y1="8" x2="21" y2="8" />
      <line x1="3" y1="16" x2="21" y2="16" />
    </svg>
  );
}

export function App() {
  const [activeNavTab, setActiveNavTab] = useState<'chat' | 'memory' | 'settings' | 'preview' | 'suggestions'>('chat');
  const [settingsTab, setSettingsTab] = useState<ModelMode>(DEFAULT_SETTINGS.selectedMode || 'free');
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [globalMemories, setGlobalMemories] = useState<UserDocument[]>([]);
  const [tabMemories, setTabMemories] = useState<UserDocument[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('session_default');
  const [inputDrafts, setInputDrafts] = useState<Record<string, string>>({});
  const [previewMarkdown, setPreviewMarkdown] = useState<string>('');
  const [unseenPreviews, setUnseenPreviews] = useState<Record<string, boolean>>({});
  const hasUnseenPreview = Boolean(unseenPreviews[activeSessionId]);
  const [suggestedMemories, setSuggestedMemories] = useState<SuggestedMemory[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>('');
  const [isBusy, setIsBusy] = useState(false);
  const [activeTool, setActiveTool] = useState<ToolCallState | null>(null);
  const [copiedSessionId, setCopiedSessionId] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  const handleInputDraftChange = (draft: string) => {
    setInputDrafts((prev) => ({
      ...prev,
      [activeSessionId]: draft,
    }));
  };

  const harnessRef = useRef<FormAgentHarness | null>(null);
  const currentTabKeyRef = useRef<string>('session_default');
  const activeNavTabRef = useRef<'chat' | 'memory' | 'settings' | 'preview' | 'suggestions'>('chat');
  const thinkingStartTimeRef = useRef<number | null>(null);
  const thinkingDurationMsRef = useRef<number | null>(null);

  // Keep activeNavTabRef and currentTabKeyRef synchronized
  useEffect(() => {
    activeNavTabRef.current = activeNavTab;
    if (activeNavTab === 'preview') {
      setUnseenPreviews((prev) => ({ ...prev, [activeSessionId]: false }));
    }
  }, [activeNavTab, activeSessionId]);

  useEffect(() => {
    currentTabKeyRef.current = activeSessionId;
  }, [activeSessionId]);

  // Listen for real-time scratchpad / live preview document updates from agent
  useEffect(() => {
    const handleScratchpadUpdate = (e: Event) => {
      const customEvt = e as CustomEvent<{ content: string; sessionId?: string }>;
      if (customEvt.detail) {
        const { content, sessionId } = customEvt.detail;
        const targetSid = sessionId || currentTabKeyRef.current;
        if (targetSid === currentTabKeyRef.current) {
          setPreviewMarkdown(content || '');
        }
        if (content && content.trim().length > 0) {
          if (targetSid !== currentTabKeyRef.current || activeNavTabRef.current !== 'preview') {
            setUnseenPreviews((prev) => ({ ...prev, [targetSid]: true }));
          }
        }
      }
    };
    window.addEventListener('openbua_scratchpad_updated', handleScratchpadUpdate);
    return () => {
      window.removeEventListener('openbua_scratchpad_updated', handleScratchpadUpdate);
    };
  }, []);

  // Listen for real-time suggested memories updates from agent
  useEffect(() => {
    const handleSuggestedMemoriesUpdate = async () => {
      const sugs = await loadSuggestedMemories(currentTabKeyRef.current);
      setSuggestedMemories(sugs);
    };
    window.addEventListener('openbua_suggested_memories_updated', handleSuggestedMemoriesUpdate);
    return () => {
      window.removeEventListener('openbua_suggested_memories_updated', handleSuggestedMemoriesUpdate);
    };
  }, []);

  // Close sidebar drawer smoothly on Escape key
  useEffect(() => {
    if (!isSidebarOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsSidebarOpen(false);
        setEditingSessionId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSidebarOpen]);

  // Initial load of settings, sessions, memories, and harness
  useEffect(() => {
    async function init() {
      const loadedSettings = await loadSettings();
      const loadedGlobal = await loadGlobalMemories();
      const loadedSessions = await loadChatSessions();
      const lastActive = await loadLastActiveState();
      
      const targetSessionId = (lastActive.sessionId && loadedSessions.some((s) => s.id === lastActive.sessionId))
        ? lastActive.sessionId
        : (loadedSessions[0]?.id || 'session_default');

      currentTabKeyRef.current = targetSessionId;
      setActiveSessionIdState(targetSessionId);

      const [loadedTabMems, loadedChat, loadedScratch, loadedSugs] = await Promise.all([
        loadTabMemories(targetSessionId),
        loadChatHistoryForTab(targetSessionId),
        getScratchpad(targetSessionId),
        loadSuggestedMemories(targetSessionId),
      ]);

      setSettings(loadedSettings);
      setSettingsTab(loadedSettings.selectedMode || 'free');
      setGlobalMemories(loadedGlobal);
      setSessions(loadedSessions);
      setActiveNavTab(lastActive.navTab || 'chat');
      setActiveSessionId(targetSessionId);
      setTabMemories(loadedTabMems);
      setMessages(loadedChat);
      setPreviewMarkdown(loadedScratch || '');
      setSuggestedMemories(loadedSugs);

      const activeDocs = [
        ...loadedGlobal.filter((m) => m.isActiveForContext),
        ...loadedTabMems.filter((m) => m.isActiveForContext),
      ];

      // Create Agent Harness with loaded chat history
      const harness = new FormAgentHarness(
        loadedSettings,
        activeDocs,
        {
        onStatusChange: (busy) => {
          setIsBusy(busy);
          if (busy) {
            if (!thinkingStartTimeRef.current) {
              thinkingStartTimeRef.current = Date.now();
            }
            thinkingDurationMsRef.current = null;
          } else {
            setActiveTool(null);
            thinkingStartTimeRef.current = null;
            thinkingDurationMsRef.current = null;
            setMessages((prev) => {
              const hasStreaming = prev.some((m) => m.isStreaming);
              if (!hasStreaming) return prev;
              const updated = prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m));
              saveChatHistoryForTab(currentTabKeyRef.current, updated);
              return updated;
            });
          }
        },
        onMessageDelta: (deltaText) => {
          if (thinkingStartTimeRef.current && thinkingDurationMsRef.current === null) {
            thinkingDurationMsRef.current = Math.max(1000, Date.now() - thinkingStartTimeRef.current);
          }
          const duration = thinkingDurationMsRef.current ?? undefined;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === 'assistant' && last.isStreaming) {
              const updated = [...prev];
              updated[updated.length - 1] = {
                ...last,
                content: deltaText,
                thinkingDurationMs: duration ?? last.thinkingDurationMs,
                isStreaming: true,
              };
              return updated;
            } else {
              return [
                ...prev,
                {
                  id: `asst-${Date.now()}`,
                  role: 'assistant',
                  content: deltaText,
                  thinkingDurationMs: duration,
                  timestamp: Date.now(),
                  isStreaming: true,
                  toolCalls: [],
                },
              ];
            }
          });
        },
        onThinkingDelta: (thinkingText) => {
          if (!thinkingStartTimeRef.current) {
            thinkingStartTimeRef.current = Date.now();
          }
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (
              last &&
              last.role === 'assistant' &&
              last.isStreaming &&
              (!last.content || last.content.trim().length === 0)
            ) {
              const updated = [...prev];
              updated[updated.length - 1] = {
                ...last,
                thinking: thinkingText,
                isStreaming: true,
              };
              return updated;
            } else {
              return [
                ...prev,
                {
                  id: `asst-${Date.now()}`,
                  role: 'assistant',
                  content: '',
                  thinking: thinkingText,
                  timestamp: Date.now(),
                  isStreaming: true,
                  toolCalls: [],
                },
              ];
            }
          });
        },
        onToolCallStart: (toolCall) => {
          setActiveTool(toolCall);
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (
              last &&
              last.role === 'assistant' &&
              last.isStreaming &&
              (!last.content || last.content.trim().length === 0)
            ) {
              const calls = last.toolCalls || [];
              const index = calls.findIndex((c) => c.id === toolCall.id);
              const updatedCalls = [...calls];
              if (index >= 0) {
                updatedCalls[index] = toolCall;
              } else {
                updatedCalls.push(toolCall);
              }
              const updated = [...prev];
              updated[updated.length - 1] = {
                ...last,
                toolCalls: updatedCalls,
                isStreaming: true,
              };
              return updated;
            } else if (last && last.role === 'assistant' && last.isStreaming && last.content && !last.thinking) {
              const calls = last.toolCalls || [];
              const updated = [...prev];
              updated[updated.length - 1] = {
                ...last,
                thinking: last.content,
                content: '',
                toolCalls: [...calls, toolCall],
                isStreaming: true,
              };
              return updated;
            } else {
              return [
                ...prev,
                {
                  id: `asst-${Date.now()}`,
                  role: 'assistant',
                  content: '',
                  timestamp: Date.now(),
                  isStreaming: true,
                  toolCalls: [toolCall],
                },
              ];
            }
          });
        },
        onToolCallEnd: (toolCall) => {
          setActiveTool((curr) => (curr?.id === toolCall.id ? null : curr));
          setMessages((prev) => {
            const updated = [...prev];
            for (let i = updated.length - 1; i >= 0; i--) {
              const m = updated[i];
              if (m.role === 'assistant' && m.toolCalls) {
                const idx = m.toolCalls.findIndex((c) => c.id === toolCall.id);
                if (idx >= 0) {
                  const calls = [...m.toolCalls];
                  calls[idx] = toolCall;
                  updated[i] = { ...m, toolCalls: calls };
                  return updated;
                }
              }
            }
            return prev;
          });
        },
        onTurnComplete: (assistantText, toolCalls, thinkingText) => {
          setActiveTool(null);
          if (thinkingStartTimeRef.current && thinkingDurationMsRef.current === null) {
            thinkingDurationMsRef.current = Math.max(1000, Date.now() - thinkingStartTimeRef.current);
          }
          const duration = thinkingDurationMsRef.current ?? undefined;
          thinkingStartTimeRef.current = null;
          thinkingDurationMsRef.current = null;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            let updated: ChatMessage[];
            if (last && last.role === 'assistant' && last.isStreaming) {
              updated = [...prev];
              updated[updated.length - 1] = {
                ...last,
                content: assistantText !== undefined ? assistantText : last.content,
                toolCalls: toolCalls.length > 0 ? toolCalls : (last.toolCalls || []),
                thinking: thinkingText || last.thinking,
                thinkingDurationMs: duration ?? last.thinkingDurationMs,
                isStreaming: false,
              };
            } else if (assistantText || toolCalls.length > 0 || thinkingText) {
              const newAsst: ChatMessage = {
                id: `asst-${Date.now()}`,
                role: 'assistant',
                content: assistantText,
                thinking: thinkingText,
                thinkingDurationMs: duration,
                toolCalls,
                timestamp: Date.now(),
                isStreaming: false,
              };
              updated = [...prev, newAsst];
            } else {
              updated = prev;
            }
            saveChatHistoryForTab(currentTabKeyRef.current, updated);
            return updated;
          });
        },
        onError: (err: any) => {
          setActiveTool(null);
          const errStr = typeof err === 'string' ? err : err?.message || String(err);
          const isInterrupted =
            errStr.toLowerCase().includes('cancel') ||
            errStr.toLowerCase().includes('abort') ||
            errStr.toLowerCase().includes('interrupt');
          const displayContent = isInterrupted
            ? 'Agent interrupted. Type continue to resume.'
            : `Error: ${errStr.replace(/^⚠️\s*/, '')}`;

          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (
              last &&
              last.role === 'assistant' &&
              (last.content === displayContent || last.content.includes(displayContent))
            ) {
              return prev;
            }
            let updated = [...prev];
            if (last && last.role === 'assistant' && last.isStreaming) {
              if (!last.content || !last.content.trim()) {
                updated[updated.length - 1] = {
                  ...last,
                  content: displayContent,
                  isStreaming: false,
                };
                saveChatHistoryForTab(currentTabKeyRef.current, updated);
                if (harnessRef.current) {
                  harnessRef.current.setConversationHistory(updated);
                }
                return updated;
              } else {
                updated[updated.length - 1] = {
                  ...last,
                  isStreaming: false,
                };
              }
            }

            const errorMsg: ChatMessage = {
              id: `err-${Date.now()}`,
              role: 'assistant',
              content: displayContent,
              timestamp: Date.now(),
              isStreaming: false,
            };
            updated = [...updated, errorMsg];
            saveChatHistoryForTab(currentTabKeyRef.current, updated);
            if (harnessRef.current) {
              harnessRef.current.setConversationHistory(updated);
            }
            return updated;
          });
        },
      },
      loadedChat,
      targetSessionId);

      harnessRef.current = harness;
      setInitialized(true);

      // Non-blocking socket pre-warm on launch to eliminate cold-start TLS/DNS handshake delay & Failed to fetch
      try {
        const activeCfg =
          loadedSettings.selectedMode === 'free'
            ? loadedSettings.free
            : loadedSettings.activeProvider === 'anthropic'
            ? loadedSettings.anthropic
            : loadedSettings.openai;
        if (activeCfg?.baseUrl && activeCfg.apiKey?.trim()) {
          const urlObj = new URL(activeCfg.baseUrl);
          fetch(`${urlObj.origin}/`, { method: 'HEAD', mode: 'no-cors' }).catch(() => {});
        }
      } catch {
        // Ignore URL parse error
      }
    }

    init();
  }, []);

  const handleSelectNavTab = (tab: 'chat' | 'memory' | 'settings' | 'preview' | 'suggestions') => {
    if (tab === 'preview') {
      setUnseenPreviews((prev) => ({ ...prev, [activeSessionId]: false }));
    }
    setActiveNavTab(tab);
    saveLastActiveState(tab, currentTabKeyRef.current);
  };

  const handleTogglePreview = () => {
    if (activeNavTab === 'preview') {
      handleSelectNavTab('chat');
    } else {
      setUnseenPreviews((prev) => ({ ...prev, [activeSessionId]: false }));
      handleSelectNavTab('preview');
    }
  };

  // When active session changes, load its scoped chat history and tab memories
  const handleSelectSession = async (sessionId: string) => {
    if (sessionId === activeSessionId) return;
    setActiveSessionId(sessionId);
    currentTabKeyRef.current = sessionId;
    setActiveSessionIdState(sessionId);
    saveLastActiveState(activeNavTab, sessionId);
    const [tMems, msgs, loadedScratch, loadedSugs] = await Promise.all([
      loadTabMemories(sessionId),
      loadChatHistoryForTab(sessionId),
      getScratchpad(sessionId),
      loadSuggestedMemories(sessionId),
    ]);
    setTabMemories(tMems);
    setMessages(msgs);
    setPreviewMarkdown(loadedScratch || '');
    setSuggestedMemories(loadedSugs);
    if (activeNavTabRef.current === 'preview') {
      setUnseenPreviews((prev) => ({ ...prev, [sessionId]: false }));
    }
    if (harnessRef.current) {
      harnessRef.current.setSessionId(sessionId);
      harnessRef.current.setConversationHistory(msgs);
    }
  };

  const handleApproveAsTabMemory = async (sug: SuggestedMemory) => {
    const newDoc: UserDocument = {
      id: `mem-${Date.now()}`,
      title: sug.title,
      type: 'markdown',
      content: sug.content,
      summary: `${sug.title} (${sug.content.slice(0, 80)}...)`,
      createdAt: Date.now(),
      sizeBytes: new Blob([sug.content]).size,
      tags: [sug.category || 'fact', 'suggested'],
      isActiveForContext: true,
      isGlobal: false,
      tabUrlPattern: activeSessionId,
    };
    await saveTabMemory(activeSessionId, newDoc);
    const updatedSugs = await deleteSuggestedMemory(sug.id);
    const updatedTabMems = [newDoc, ...tabMemories];
    setTabMemories(updatedTabMems);
    setSuggestedMemories(updatedSugs.filter((s) => !s.sessionId || s.sessionId === activeSessionId));
    if (harnessRef.current) {
      const activeDocs = [
        ...globalMemories.filter((m) => m.isActiveForContext),
        ...updatedTabMems.filter((m) => m.isActiveForContext),
      ];
      harnessRef.current.updateConfig(settings, activeDocs);
    }
  };

  const handleApproveAsGlobalMemory = async (sug: SuggestedMemory) => {
    const newDoc: UserDocument = {
      id: `mem-${Date.now()}`,
      title: sug.title,
      type: 'markdown',
      content: sug.content,
      summary: `${sug.title} (${sug.content.slice(0, 80)}...)`,
      createdAt: Date.now(),
      sizeBytes: new Blob([sug.content]).size,
      tags: [sug.category || 'fact', 'suggested'],
      isActiveForContext: true,
      isGlobal: true,
    };
    await saveGlobalMemory(newDoc);
    const updatedSugs = await deleteSuggestedMemory(sug.id);
    const updatedGlobal = [newDoc, ...globalMemories];
    setGlobalMemories(updatedGlobal);
    setSuggestedMemories(updatedSugs.filter((s) => !s.sessionId || s.sessionId === activeSessionId));
    if (harnessRef.current) {
      const activeDocs = [
        ...updatedGlobal.filter((m) => m.isActiveForContext),
        ...tabMemories.filter((m) => m.isActiveForContext),
      ];
      harnessRef.current.updateConfig(settings, activeDocs);
    }
  };

  const handleDiscardSuggestion = async (id: string) => {
    const updatedSugs = await deleteSuggestedMemory(id);
    setSuggestedMemories(updatedSugs.filter((s) => !s.sessionId || s.sessionId === activeSessionId));
  };

  const handleClearAllSuggestions = async () => {
    await clearSuggestedMemories(activeSessionId);
    setSuggestedMemories([]);
  };

  const handleCreateSession = async () => {
    const newSession = await createNewChatSession();
    const updated = await loadChatSessions();
    setSessions(updated);
    await handleSelectSession(newSession.id);
  };

  const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    const updated = await deleteChatSession(sessionId);
    setSessions(updated);
    setInputDrafts((prev) => {
      const copy = { ...prev };
      delete copy[sessionId];
      return copy;
    });
    if (activeSessionId === sessionId) {
      const nextSession = updated[0];
      if (nextSession) {
        await handleSelectSession(nextSession.id);
      }
    }
  };

  const handleStartRename = (e: React.MouseEvent, sess: ChatSession) => {
    e.stopPropagation();
    setEditingSessionId(sess.id);
    setEditingTitle(sess.title);
  };

  const handleSaveRename = async (sessionId: string) => {
    const trimmed = editingTitle.trim();
    if (!trimmed) {
      setEditingSessionId(null);
      return;
    }
    const updated = await renameChatSession(sessionId, trimmed);
    setSessions(updated);
    setEditingSessionId(null);
  };

  const handleCancelRename = () => {
    setEditingSessionId(null);
  };

  const handleCopySessionChat = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    try {
      let msgsToCopy: ChatMessage[] = [];
      if (sessionId === activeSessionId) {
        msgsToCopy = messages;
      } else {
        msgsToCopy = await loadChatHistoryForTab(sessionId);
      }
      const fullTranscript = formatEntireChatAsText(msgsToCopy);
      await navigator.clipboard.writeText(fullTranscript);
      setCopiedSessionId(sessionId);
      setTimeout(() => {
        setCopiedSessionId((curr) => (curr === sessionId ? null : curr));
      }, 2000);
    } catch (err) {
      console.error('Failed to copy chat transcript:', err);
    }
  };

  // Keep harness synchronized with active memories and current settings
  useEffect(() => {
    if (!harnessRef.current) return;
    const activeDocs = [
      ...globalMemories.filter((m) => m.isActiveForContext),
      ...tabMemories.filter((m) => m.isActiveForContext),
    ];
    harnessRef.current.updateConfig(settings, activeDocs);
  }, [settings, globalMemories, tabMemories]);



  const handleSettingsSaved = (updated: AppSettings) => {
    setSettings(updated);
    setSettingsTab(updated.selectedMode || 'free');
    if (harnessRef.current) {
      harnessRef.current.updateConfig(updated, activeDocuments);
    }
  };

  const handleGlobalMemoriesChange = (updated: UserDocument[]) => {
    setGlobalMemories(updated);
  };

  const handleTabMemoriesChange = (updated: UserDocument[]) => {
    setTabMemories(updated);
  };

  const handleChatDocumentUpload = async (file: File): Promise<UserDocument> => {
    const parsed = await readFileContent(file);
    const tabKey = currentTabKeyRef.current;
    const cleanTitle = file.name.replace(/\.[^/.]+$/, '');
    const newDoc: UserDocument = {
      id: `mem-${Date.now()}`,
      title: cleanTitle,
      type: parsed.type,
      content: parsed.content,
      summary: `${file.name} uploaded from chat`,
      createdAt: Date.now(),
      sizeBytes: file.size,
      tags: ['chat-upload'],
      isActiveForContext: true,
      isGlobal: false,
      tabUrlPattern: tabKey,
    };
    await saveTabMemory(tabKey, newDoc);
    setTabMemories((prev) => [newDoc, ...prev]);
    return newDoc;
  };

  const handleMessagesChange = (updatedMsgs: ChatMessage[]) => {
    setMessages(updatedMsgs);
    saveChatHistoryForTab(currentTabKeyRef.current, updatedMsgs);
    if (harnessRef.current) {
      harnessRef.current.setConversationHistory(updatedMsgs);
    }
  };

  const currentKey =
    settings.selectedMode === 'free'
      ? settings.free?.apiKey
      : settings.activeProvider === 'anthropic'
      ? settings.anthropic.apiKey
      : settings.openai.apiKey;
  const hasKey = Boolean(currentKey && currentKey.trim().length > 3);

  const activeDocuments = [
    ...globalMemories.filter((m) => m.isActiveForContext),
    ...tabMemories.filter((m) => m.isActiveForContext),
  ];

  return (
    <div className="relative h-screen w-full bg-zinc-950 text-zinc-100 antialiased font-sans select-none overflow-hidden">
      {/* Top Blur Feather Overlay (Light subtle blur) */}
      <div
        className="pointer-events-none absolute top-0 left-0 right-0 h-16 z-20"
        style={{
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
          maskImage: 'linear-gradient(to bottom, black 0%, black 25%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black 25%, transparent 100%)',
        }}
      />

      {/* Floating Top Header (Positioned absolute over viewport, zero solid strip) */}
      <header className="absolute top-2.5 left-0 right-0 z-30 px-3 flex items-center justify-between pointer-events-none">
        {/* Left: Circle Back Button (in Settings / Suggestions) OR 2-Line Hamburger Button (in Chat/Memory/Preview) */}
        <div className="flex items-center pointer-events-auto">
          {activeNavTab === 'settings' || activeNavTab === 'suggestions' ? (
            <button
              type="button"
              onClick={() => handleSelectNavTab('chat')}
              title="Back to Chat"
              className="w-9 h-9 rounded-full bg-zinc-900/95 hover:bg-zinc-800 border border-zinc-800/90 text-white flex items-center justify-center transition-all shadow-xl shadow-black/60 cursor-pointer active:scale-95"
            >
              <ArrowLeft className="w-4 h-4 text-white" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setIsSidebarOpen(true)}
              title="Open Menu"
              className="w-9 h-9 rounded-full bg-zinc-900/95 hover:bg-zinc-800 border border-zinc-800/90 text-white flex items-center justify-center transition-all shadow-xl shadow-black/60 cursor-pointer active:scale-95"
            >
              <TwoLineMenu className="w-4 h-4 text-white" />
            </button>
          )}
        </div>

        {/* Center: Chat / Memory / Preview Floating Toggle OR Free / BYOK Toggle in Settings OR Suggested memory Pill */}
        {activeNavTab === 'settings' ? (
          <div className="flex items-center p-0.5 bg-zinc-900/95 border border-zinc-800/90 rounded-full shadow-xl shadow-black/60 pointer-events-auto">
            <button
              type="button"
              onClick={() => setSettingsTab('free')}
              className={`h-7 px-3.5 rounded-full text-xs font-medium transition-all cursor-pointer flex items-center justify-center ${
                settingsTab === 'free'
                  ? 'bg-zinc-100 text-zinc-950 font-semibold shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Free
            </button>
            <button
              type="button"
              onClick={() => setSettingsTab('byok')}
              className={`h-7 px-3.5 rounded-full text-xs font-medium transition-all cursor-pointer flex items-center justify-center ${
                settingsTab === 'byok'
                  ? 'bg-zinc-100 text-zinc-950 font-semibold shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              BYOK
            </button>
          </div>
        ) : activeNavTab === 'suggestions' ? (
          <div className="flex items-center gap-1.5 h-8 px-4 bg-zinc-900/95 border border-zinc-800/90 rounded-full shadow-xl shadow-black/60 pointer-events-auto">
            <span className="text-xs font-semibold text-zinc-100 tracking-tight">Suggested memory</span>
            {suggestedMemories.length > 0 && (
              <span
                className="px-1.5 py-0.5 rounded-full text-[10px] font-bold text-white leading-none"
                style={{ backgroundColor: '#007AFF' }}
              >
                {suggestedMemories.length}
              </span>
            )}
          </div>
        ) : (
          <div className="flex items-center p-0.5 bg-zinc-900/95 border border-zinc-800/90 rounded-full shadow-xl shadow-black/60 pointer-events-auto">
            <button
              type="button"
              onClick={() => handleSelectNavTab('chat')}
              className={`h-7 px-3 rounded-full text-xs font-medium transition-all cursor-pointer flex items-center justify-center ${
                activeNavTab === 'chat'
                  ? 'bg-zinc-100 text-zinc-950 font-semibold shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Chat
            </button>
            <button
              type="button"
              onClick={() => handleSelectNavTab('memory')}
              className={`h-7 px-3 rounded-full text-xs font-medium transition-all cursor-pointer flex items-center justify-center ${
                activeNavTab === 'memory'
                  ? 'bg-zinc-100 text-zinc-950 font-semibold shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Memory
            </button>
            <button
              type="button"
              onClick={() => handleSelectNavTab('preview')}
              className={`relative h-7 px-3 rounded-full text-xs font-medium transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                activeNavTab === 'preview'
                  ? 'bg-zinc-100 text-zinc-950 font-semibold shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <span>Preview</span>
              {hasUnseenPreview && activeNavTab !== 'preview' && (
                <span
                  className="w-1.5 h-1.5 rounded-full animate-pulse shrink-0"
                  style={{ backgroundColor: '#007AFF' }}
                />
              )}
            </button>
          </div>
        )}

        {/* Right: Circle Suggested Memories Button with Notification Dot (hidden on suggestions page, replaced by spacer to keep pill centered) */}
        {activeNavTab === 'suggestions' ? (
          <div className="w-9 h-9 shrink-0" aria-hidden="true" />
        ) : (
        <div className="flex items-center pointer-events-auto">
          <button
            type="button"
            onClick={() => handleSelectNavTab(activeNavTab === 'suggestions' ? 'chat' : 'suggestions')}
            title={`Suggested Memories${suggestedMemories.length > 0 ? ` (${suggestedMemories.length} pending)` : ''}`}
            className={`relative w-9 h-9 rounded-full bg-zinc-900/95 hover:bg-zinc-800 border transition-all shadow-xl shadow-black/60 cursor-pointer active:scale-95 flex items-center justify-center ${
              activeNavTab === 'suggestions'
                ? 'border-zinc-700 bg-zinc-800 text-white'
                : 'border-zinc-800/90 text-zinc-300 hover:text-white'
            }`}
          >
            <Brain className="w-4 h-4 text-white" />
            {suggestedMemories.length > 0 && activeNavTab !== 'suggestions' && (
              <span
                className="absolute top-1 right-1 w-2.5 h-2.5 rounded-full ring-2 ring-zinc-950 animate-pulse"
                style={{ backgroundColor: '#007AFF' }}
              />
            )}
          </button>
        </div>
        )}
      </header>

      {/* Backdrop Overlay (blurs background behind sidebar without dimming/lowering opacity) */}
      <div
        className={`fixed inset-0 z-40 cursor-pointer transition-all duration-300 ease-in-out ${
          isSidebarOpen
            ? 'backdrop-blur-sm bg-transparent pointer-events-auto'
            : 'backdrop-blur-none bg-transparent pointer-events-none'
        }`}
        onClick={() => {
          setIsSidebarOpen(false);
          setEditingSessionId(null);
        }}
        aria-hidden="true"
      />

      {/* Sidebar Drawer (takes up 65% of screen, pure slide in/out at 100% opacity) */}
      <div
        className={`fixed top-0 bottom-0 left-0 z-50 w-[65%] max-w-[280px] bg-zinc-950 border-r border-zinc-900 flex flex-col shadow-2xl transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          isSidebarOpen ? 'translate-x-0 pointer-events-auto' : '-translate-x-full pointer-events-none'
        }`}
        aria-hidden={!isSidebarOpen}
      >
          {/* Drawer Header (without dividing line, without cross icon) */}
          <div className="p-4 pb-2 flex items-center">
            <span className="font-bold text-sm tracking-tight text-white">
              OpenBUA
            </span>
          </div>

          {/* New Chat Create Button (no bg, bold white text) */}
          <div className="px-3 py-1">
            <button
              type="button"
              onClick={async () => {
                await handleCreateSession();
                handleSelectNavTab('chat');
                setIsSidebarOpen(false);
              }}
              className="flex items-center gap-2.5 w-full px-2 py-2 rounded-xl text-xs font-medium text-white hover:bg-zinc-900/60 transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4 text-white" />
              <span>New Chat</span>
            </button>
          </div>

          {/* Recent Chats (Scrollable) */}
          <div className="flex-1 overflow-y-auto px-2 py-1 space-y-1">
            <div className="px-2 py-1.5 text-xs font-bold text-white">
              Recent
            </div>

            {sessions.map((sess) => {
              const isActive = activeSessionId === sess.id;
              const isEditing = editingSessionId === sess.id;

              return (
                <div
                  key={sess.id}
                  onClick={() => {
                    if (!isEditing) {
                      handleSelectSession(sess.id);
                      handleSelectNavTab('chat');
                      setIsSidebarOpen(false);
                    }
                  }}
                  className={`group flex items-center justify-between px-2.5 py-2 rounded-xl text-xs transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-zinc-900 text-white font-medium'
                      : 'text-white/80 hover:text-white hover:bg-zinc-900/50'
                  }`}
                >
                  {isEditing ? (
                    <div
                      className="flex items-center gap-1.5 w-full"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="text"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveRename(sess.id);
                          if (e.key === 'Escape') handleCancelRename();
                        }}
                        autoFocus
                        className="flex-1 bg-zinc-950 border border-zinc-700 rounded-md px-2 py-0.5 text-xs text-white focus:outline-none focus:border-zinc-500"
                      />
                      <button
                        type="button"
                        onClick={() => handleSaveRename(sess.id)}
                        title="Save title"
                        className="p-1 hover:text-emerald-400 text-zinc-400 cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={handleCancelRename}
                        title="Cancel"
                        className="p-1 hover:text-zinc-200 text-zinc-500 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 truncate min-w-0 pr-1">
                        <MessageSquare className="w-3.5 h-3.5 shrink-0 text-white" />
                        <span className="truncate text-white">{sess.title}</span>
                      </div>

                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button
                          type="button"
                          onClick={(e) => handleCopySessionChat(e, sess.id)}
                          title="Copy entire chat"
                          className="p-1 rounded text-white/70 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
                        >
                          {copiedSessionId === sess.id ? (
                            <Check className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => handleStartRename(e, sess)}
                          title="Rename tab"
                          className="p-1 rounded text-white/70 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        {sessions.length > 1 && (
                          <button
                            type="button"
                            onClick={(e) => handleDeleteSession(e, sess.id)}
                            title="Delete tab"
                            className="p-1 rounded text-white/70 hover:text-red-400 hover:bg-zinc-800 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {/* Sticky Settings Button at the bottom */}
          <div className="p-3 border-t border-zinc-900/50 bg-zinc-950/95 sticky bottom-0 shrink-0">
            <button
              type="button"
              onClick={() => {
                handleSelectNavTab('settings');
                setIsSidebarOpen(false);
              }}
              className={`flex items-center gap-2.5 w-full px-3 py-2 rounded-xl text-xs font-medium transition-colors cursor-pointer ${
                activeNavTab === 'settings'
                  ? 'bg-zinc-900 text-white'
                  : 'text-white hover:bg-zinc-900/60'
              }`}
            >
              <Settings className="w-4 h-4 text-white" />
              <span className="text-white">Settings</span>
            </button>
          </div>
        </div>

      {/* Main View Area */}
      <main className="h-full w-full flex flex-col overflow-hidden relative select-text">
        {activeNavTab === 'chat' && (
          <ChatView
            activeSessionId={activeSessionId}
            messages={messages}
            onMessagesChange={handleMessagesChange}
            harness={harnessRef.current}
            isBusy={isBusy}
            activeTool={activeTool}
            settings={settings}
            documents={activeDocuments}
            onNavigateToSettings={() => handleSelectNavTab('settings')}
            onNavigateToMemory={() => handleSelectNavTab('memory')}
            onUploadDocument={handleChatDocumentUpload}
            inputDraft={inputDrafts[activeSessionId] || ''}
            onInputDraftChange={handleInputDraftChange}
          />
        )}

        {activeNavTab === 'memory' && (
          <MemoryView
            currentTabKey={currentTabKeyRef.current}
            currentTabTitle={sessions.find((s) => s.id === activeSessionId)?.title || 'Current Chat'}
            globalMemories={globalMemories}
            tabMemories={tabMemories}
            onGlobalMemoriesChange={handleGlobalMemoriesChange}
            onTabMemoriesChange={handleTabMemoriesChange}
          />
        )}

        {activeNavTab === 'settings' && (
          <SettingsView
            settings={settings}
            onSettingsSaved={handleSettingsSaved}
            activeTab={settingsTab}
            onTabChange={setSettingsTab}
          />
        )}

        {activeNavTab === 'preview' && (
          <PreviewView
            content={previewMarkdown}
            isBusy={isBusy}
            onClear={async () => {
              await clearScratchpad(activeSessionId);
              setPreviewMarkdown('');
            }}
          />
        )}

        {activeNavTab === 'suggestions' && (
          <SuggestedMemoriesView
            suggestions={suggestedMemories}
            currentTabTitle={sessions.find((s) => s.id === activeSessionId)?.title || 'Current Chat'}
            onApproveAsTab={handleApproveAsTabMemory}
            onApproveAsGlobal={handleApproveAsGlobalMemory}
            onDiscard={handleDiscardSuggestion}
            onClearAll={handleClearAllSuggestions}
          />
        )}
      </main>
    </div>
  );
}
