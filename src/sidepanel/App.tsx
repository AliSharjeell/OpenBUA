import React, { useState, useEffect, useRef } from 'react';
import {
  AppSettings,
  UserDocument,
  ChatMessage,
  ToolCallState,
  ChatSession,
} from '../types';
import {
  loadSettings,
  loadGlobalMemories,
  loadTabMemories,
  saveTabMemory,
  loadChatHistoryForTab,
  saveChatHistoryForTab,
  loadChatSessions,
  saveChatSessions,
  createNewChatSession,
  deleteChatSession,
  renameChatSession,
  setActiveSessionIdState,
  DEFAULT_SETTINGS,
} from '../services/storage';
import { readFileContent } from '../services/pdf-parser';
import { FormAgentHarness } from '../agent/form-agent';
import { ChatView } from '../components/ChatView';
import { MemoryView } from '../components/MemoryView';
import { SettingsView } from '../components/SettingsView';
import {
  MessageSquare,
  Layers,
  Settings,
  Plus,
  X,
  Pencil,
  Trash2,
  Check,
} from 'lucide-react';

function TwoLineMenu({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="4" y1="8.5" x2="20" y2="8.5" />
      <line x1="4" y1="15.5" x2="20" y2="15.5" />
    </svg>
  );
}

export function App() {
  const [activeNavTab, setActiveNavTab] = useState<'chat' | 'memory' | 'settings'>('chat');
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [globalMemories, setGlobalMemories] = useState<UserDocument[]>([]);
  const [tabMemories, setTabMemories] = useState<UserDocument[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('session_default');
  const [inputDrafts, setInputDrafts] = useState<Record<string, string>>({});
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>('');
  const [isBusy, setIsBusy] = useState(false);
  const [activeTool, setActiveTool] = useState<ToolCallState | null>(null);
  const [initialized, setInitialized] = useState(false);

  const handleInputDraftChange = (draft: string) => {
    setInputDrafts((prev) => ({
      ...prev,
      [activeSessionId]: draft,
    }));
  };

  const harnessRef = useRef<FormAgentHarness | null>(null);
  const currentTabKeyRef = useRef<string>('session_default');

  // Keep currentTabKeyRef synchronized with activeSessionId
  useEffect(() => {
    currentTabKeyRef.current = activeSessionId;
  }, [activeSessionId]);

  // Initial load of settings, sessions, memories, and harness
  useEffect(() => {
    async function init() {
      const loadedSettings = await loadSettings();
      const loadedGlobal = await loadGlobalMemories();
      const loadedSessions = await loadChatSessions();
      
      const firstSessionId = loadedSessions[0]?.id || 'session_default';
      currentTabKeyRef.current = firstSessionId;
      setActiveSessionIdState(firstSessionId);

      const [loadedTabMems, loadedChat] = await Promise.all([
        loadTabMemories(firstSessionId),
        loadChatHistoryForTab(firstSessionId),
      ]);

      setSettings(loadedSettings);
      setGlobalMemories(loadedGlobal);
      setSessions(loadedSessions);
      setActiveSessionId(firstSessionId);
      setTabMemories(loadedTabMems);
      setMessages(loadedChat);

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
          if (!busy) setActiveTool(null);
        },
        onMessageDelta: (deltaText) => {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === 'assistant' && last.isStreaming) {
              const updated = [...prev];
              updated[updated.length - 1] = {
                ...last,
                content: deltaText,
              };
              return updated;
            } else {
              return [
                ...prev,
                {
                  id: `asst-${Date.now()}`,
                  role: 'assistant',
                  content: deltaText,
                  timestamp: Date.now(),
                  isStreaming: true,
                  toolCalls: [],
                },
              ];
            }
          });
        },
        onThinkingDelta: (thinkingText) => {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === 'assistant' && last.isStreaming) {
              const updated = [...prev];
              updated[updated.length - 1] = {
                ...last,
                thinking: thinkingText,
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
            if (last && last.role === 'assistant') {
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
            const last = prev[prev.length - 1];
            if (last && last.role === 'assistant') {
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
              };
              return updated;
            }
            return prev;
          });
        },
        onTurnComplete: (assistantText, toolCalls, thinkingText) => {
          setActiveTool(null);
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            let updated: ChatMessage[];
            if (last && last.role === 'assistant') {
              updated = [...prev];
              updated[updated.length - 1] = {
                ...last,
                content: assistantText || last.content,
                toolCalls: toolCalls.length > 0 ? toolCalls : last.toolCalls,
                thinking: thinkingText || last.thinking,
                isStreaming: false,
              };
            } else if (assistantText || toolCalls.length > 0 || thinkingText) {
              const newAsst: ChatMessage = {
                id: `asst-${Date.now()}`,
                role: 'assistant',
                content: assistantText,
                thinking: thinkingText,
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
        onError: (err) => {
          setActiveTool(null);
          setMessages((prev) => {
            const errorMsg: ChatMessage = {
              id: `err-${Date.now()}`,
              role: 'assistant',
              content: `⚠️ Error: ${err}`,
              timestamp: Date.now(),
              isStreaming: false,
            };
            const updated = [...prev, errorMsg];
            saveChatHistoryForTab(currentTabKeyRef.current, updated);
            if (harnessRef.current) {
              harnessRef.current.setConversationHistory(updated);
            }
            return updated;
          });
        },
      },
      loadedChat,
      firstSessionId);

      harnessRef.current = harness;
      setInitialized(true);
    }

    init();
  }, []);

  // When active session changes, load its scoped chat history and tab memories
  const handleSelectSession = async (sessionId: string) => {
    if (sessionId === activeSessionId) return;
    setActiveSessionId(sessionId);
    currentTabKeyRef.current = sessionId;
    setActiveSessionIdState(sessionId);
    const [tMems, msgs] = await Promise.all([
      loadTabMemories(sessionId),
      loadChatHistoryForTab(sessionId),
    ]);
    setTabMemories(tMems);
    setMessages(msgs);
    if (harnessRef.current) {
      harnessRef.current.setSessionId(sessionId);
      harnessRef.current.setConversationHistory(msgs);
    }
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
    settings.activeProvider === 'anthropic'
      ? settings.anthropic.apiKey
      : settings.openai.apiKey;
  const hasKey = Boolean(currentKey && currentKey.trim().length > 3);

  const activeDocuments = [
    ...globalMemories.filter((m) => m.isActiveForContext),
    ...tabMemories.filter((m) => m.isActiveForContext),
  ];

  return (
    <div className="flex flex-col h-screen w-full bg-zinc-950 text-zinc-100 antialiased font-sans select-none overflow-hidden">
      {/* Top Application Header (Floating, transparent background) */}
      <header className="h-12 px-3 pt-2 bg-transparent flex items-center justify-between shrink-0 relative z-20">
        {/* Left: Circle 2-Line Hamburger Button */}
        <div className="flex items-center">
          <button
            type="button"
            onClick={() => setIsSidebarOpen(true)}
            title="Open Menu"
            className="w-8.5 h-8.5 rounded-full bg-zinc-900/90 hover:bg-zinc-850 border border-zinc-800/80 text-zinc-200 hover:text-white flex items-center justify-center transition-all shadow-md shadow-black/40 cursor-pointer active:scale-95"
          >
            <TwoLineMenu className="w-4.5 h-4.5" />
          </button>
        </div>

        {/* Center: Chat / Memory Toggle */}
        <div className="flex items-center p-1 bg-zinc-900/90 backdrop-blur-md border border-zinc-800/90 rounded-full shadow-lg shadow-black/50">
          <button
            type="button"
            onClick={() => setActiveNavTab('chat')}
            className={`px-3.5 py-1 rounded-full text-xs font-medium transition-all cursor-pointer ${
              activeNavTab === 'chat'
                ? 'bg-zinc-100 text-zinc-950 font-semibold shadow-xs'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Chat
          </button>
          <button
            type="button"
            onClick={() => setActiveNavTab('memory')}
            className={`px-3.5 py-1 rounded-full text-xs font-medium transition-all cursor-pointer ${
              activeNavTab === 'memory'
                ? 'bg-zinc-100 text-zinc-950 font-semibold shadow-xs'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Memory
          </button>
        </div>

        {/* Right: Key setup or spacer */}
        <div className="flex items-center justify-end min-w-[28px]">
          {!hasKey && (
            <button
              onClick={() => setActiveNavTab('settings')}
              className="text-[10px] font-medium py-0.5 px-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-full transition-colors"
            >
              Setup Key
            </button>
          )}
        </div>
      </header>

      {/* Sidebar Drawer (takes up 80% of screen) */}
      {isSidebarOpen && (
        <div className="fixed inset-0 z-50 flex">
          {/* Backdrop Overlay */}
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity"
            onClick={() => {
              setIsSidebarOpen(false);
              setEditingSessionId(null);
            }}
          />

          {/* Drawer Container (80% width) */}
          <div className="relative w-[80%] max-w-[320px] h-full bg-zinc-950 border-r border-zinc-900 flex flex-col z-50 shadow-2xl animate-in slide-in-from-left duration-200">
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
                  setActiveNavTab('chat');
                  setIsSidebarOpen(false);
                }}
                className="flex items-center gap-2.5 w-full px-2 py-2 rounded-xl text-xs font-bold text-white hover:bg-zinc-900/60 transition-colors cursor-pointer"
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
                        setActiveNavTab('chat');
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
                  setActiveNavTab('settings');
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
        </div>
      )}

      {/* Main View Area */}
      <main className="flex-1 flex flex-col overflow-hidden relative select-text">
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
            onNavigateToSettings={() => setActiveNavTab('settings')}
            onNavigateToMemory={() => setActiveNavTab('memory')}
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
          />
        )}
      </main>
    </div>
  );
}
