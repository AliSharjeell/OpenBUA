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
  DEFAULT_SETTINGS,
} from '../services/storage';
import { readFileContent } from '../services/pdf-parser';
import { FormAgentHarness } from '../agent/form-agent';
import { ChatView } from '../components/ChatView';
import { MemoryView } from '../components/MemoryView';
import { InspectorView } from '../components/InspectorView';
import { SettingsView } from '../components/SettingsView';
import {
  MessageSquare,
  Layers,
  Scan,
  Settings,
  Plus,
  X,
} from 'lucide-react';

export function App() {
  const [activeNavTab, setActiveNavTab] = useState<'chat' | 'memory' | 'inspector' | 'settings'>('chat');
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [globalMemories, setGlobalMemories] = useState<UserDocument[]>([]);
  const [tabMemories, setTabMemories] = useState<UserDocument[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('session_default');
  const [isBusy, setIsBusy] = useState(false);
  const [activeTool, setActiveTool] = useState<ToolCallState | null>(null);
  const [initialized, setInitialized] = useState(false);

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

      // Create Agent Harness
      const harness = new FormAgentHarness(loadedSettings, activeDocs, {
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
            return updated;
          });
        },
      });

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
    const [tMems, msgs] = await Promise.all([
      loadTabMemories(sessionId),
      loadChatHistoryForTab(sessionId),
    ]);
    setTabMemories(tMems);
    setMessages(msgs);
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
    if (activeSessionId === sessionId) {
      const nextSession = updated[0];
      if (nextSession) {
        await handleSelectSession(nextSession.id);
      }
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
  };

  const handleInspectorFillRequested = (promptText?: string) => {
    setActiveNavTab('chat');
    if (promptText && harnessRef.current) {
      const userMsg: ChatMessage = {
        id: `msg-${Date.now()}`,
        role: 'user',
        content: promptText,
        timestamp: Date.now(),
      };
      const updated = [...messages, userMsg];
      handleMessagesChange(updated);
      harnessRef.current.prompt(promptText);
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
      {/* Top Application Header */}
      <header className="h-11 px-3 border-b border-zinc-900 bg-zinc-950 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-xs tracking-tight text-zinc-100">
            openBUA
          </span>
        </div>

        <div className="flex items-center gap-1.5">
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

      {/* Chat Tabs Switcher Bar */}
      <div className="h-9 px-2 bg-zinc-950/90 border-b border-zinc-900 flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0">
        <div className="flex items-center gap-1 text-[10px] text-zinc-500 shrink-0 mr-0.5 font-medium">
          <MessageSquare className="w-3 h-3 text-zinc-500" />
          <span>Chats:</span>
        </div>
        {sessions.map((sess) => {
          const isActive = activeSessionId === sess.id;
          return (
            <div
              key={sess.id}
              onClick={() => handleSelectSession(sess.id)}
              className={`group flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] max-w-[130px] shrink-0 transition-all border outline-none cursor-pointer ${
                isActive
                  ? 'bg-zinc-100 text-zinc-950 font-semibold shadow-sm border-zinc-100'
                  : 'bg-zinc-900/40 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/80 border-zinc-850/60'
              }`}
            >
              <span className="truncate">{sess.title}</span>
              {sessions.length > 1 && (
                <button
                  type="button"
                  title="Close tab"
                  onClick={(e) => handleDeleteSession(e, sess.id)}
                  className={`p-0.5 rounded-full hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors ${
                    isActive ? 'text-zinc-950 hover:bg-zinc-300' : 'text-zinc-500 hover:text-zinc-200'
                  }`}
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              )}
            </div>
          );
        })}
        <button
          type="button"
          onClick={handleCreateSession}
          title="New Chat Tab"
          className="flex items-center justify-center w-6 h-6 rounded-full bg-zinc-900/80 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 border border-zinc-800 transition-colors shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Main Tab Bar */}
      <nav className="h-9 px-2 border-b border-zinc-900 bg-zinc-950/60 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1.5 w-full">
          <button
            className={`flex-1 flex items-center justify-center gap-1.5 py-1 px-2.5 rounded-full text-[11px] font-medium transition-colors ${
              activeNavTab === 'chat'
                ? 'bg-zinc-900 text-zinc-100 border border-zinc-800 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/40 border border-transparent'
            }`}
            onClick={() => setActiveNavTab('chat')}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Chat</span>
          </button>

          <button
            className={`flex-1 flex items-center justify-center gap-1.5 py-1 px-2.5 rounded-full text-[11px] font-medium transition-colors ${
              activeNavTab === 'memory'
                ? 'bg-zinc-900 text-zinc-100 border border-zinc-800 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/40 border border-transparent'
            }`}
            onClick={() => setActiveNavTab('memory')}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Memory</span>
            <span className="ml-0.5 text-[9px] px-1.5 py-0.2 bg-zinc-800 rounded-full text-zinc-300">
              {activeDocuments.length}
            </span>
          </button>

          <button
            className={`flex-1 flex items-center justify-center gap-1.5 py-1 px-2.5 rounded-full text-[11px] font-medium transition-colors ${
              activeNavTab === 'inspector'
                ? 'bg-zinc-900 text-zinc-100 border border-zinc-800 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/40 border border-transparent'
            }`}
            onClick={() => setActiveNavTab('inspector')}
          >
            <Scan className="w-3.5 h-3.5" />
            <span>DOM</span>
          </button>

          <button
            className={`flex-1 flex items-center justify-center gap-1.5 py-1 px-2.5 rounded-full text-[11px] font-medium transition-colors ${
              activeNavTab === 'settings'
                ? 'bg-zinc-900 text-zinc-100 border border-zinc-800 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/40 border border-transparent'
            }`}
            onClick={() => setActiveNavTab('settings')}
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Settings</span>
          </button>
        </div>
      </nav>

      {/* Main View Area */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        {activeNavTab === 'chat' && (
          <ChatView
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

        {activeNavTab === 'inspector' && (
          <InspectorView onFillRequested={handleInspectorFillRequested} />
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
