import React, { useState, useEffect, useRef } from 'react';
import {
  AppSettings,
  UserDocument,
  ChatMessage,
  ToolCallState,
  BrowserTabInfo,
} from '../types';
import {
  loadSettings,
  loadGlobalMemories,
  loadTabMemories,
  loadChatHistoryForTab,
  saveChatHistoryForTab,
  getTabKey,
  DEFAULT_SETTINGS,
} from '../services/storage';
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
  Zap,
  Globe,
} from 'lucide-react';

export function App() {
  const [activeNavTab, setActiveNavTab] = useState<'chat' | 'memory' | 'inspector' | 'settings'>('chat');
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [globalMemories, setGlobalMemories] = useState<UserDocument[]>([]);
  const [tabMemories, setTabMemories] = useState<UserDocument[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [openTabs, setOpenTabs] = useState<BrowserTabInfo[]>([]);
  const [activeBrowserTab, setActiveBrowserTab] = useState<BrowserTabInfo | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [activeTool, setActiveTool] = useState<ToolCallState | null>(null);
  const [initialized, setInitialized] = useState(false);

  const harnessRef = useRef<FormAgentHarness | null>(null);
  const currentTabKeyRef = useRef<string>('default_tab');

  // Keep currentTabKeyRef updated
  useEffect(() => {
    currentTabKeyRef.current = getTabKey(activeBrowserTab);
  }, [activeBrowserTab]);

  // Query and observe open browser tabs
  useEffect(() => {
    async function refreshTabs() {
      if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
        try {
          const tabs = await chrome.tabs.query({ currentWindow: true });
          const mapped: BrowserTabInfo[] = tabs
            .filter((t) => typeof t.id === 'number')
            .map((t) => ({
              id: t.id!,
              title: t.title || 'Untitled Tab',
              url: t.url || '',
              favIconUrl: t.favIconUrl,
              active: Boolean(t.active),
            }));
          setOpenTabs(mapped);

          const active = mapped.find((t) => t.active);
          if (active) {
            setActiveBrowserTab((prev) => {
              if (!prev || prev.id !== active.id || prev.url !== active.url) {
                return active;
              }
              return prev;
            });
          } else if (mapped.length > 0) {
            setActiveBrowserTab((prev) => prev || mapped[0]);
          }
        } catch (err) {
          console.error('Failed to query browser tabs:', err);
        }
      } else {
        // Fallback for local development preview
        const mockTabs: BrowserTabInfo[] = [
          {
            id: 1,
            title: 'Job Application - Greenhouse',
            url: 'https://boards.greenhouse.io/demo/jobs/1',
            active: true,
          },
          {
            id: 2,
            title: 'Customer Onboarding Form',
            url: 'https://form.example.com/onboarding',
            active: false,
          },
        ];
        setOpenTabs(mockTabs);
        setActiveBrowserTab((prev) => prev || mockTabs[0]);
      }
    }

    refreshTabs();

    if (typeof chrome !== 'undefined' && chrome.tabs) {
      const handleActivated = () => refreshTabs();
      const handleUpdated = (
        tabId: number,
        changeInfo: chrome.tabs.TabChangeInfo
      ) => {
        if (changeInfo.status === 'complete' || changeInfo.title || changeInfo.url) {
          refreshTabs();
        }
      };
      const handleRemoved = () => refreshTabs();
      const handleCreated = () => refreshTabs();

      chrome.tabs.onActivated.addListener(handleActivated);
      chrome.tabs.onUpdated.addListener(handleUpdated);
      chrome.tabs.onRemoved.addListener(handleRemoved);
      chrome.tabs.onCreated.addListener(handleCreated);

      return () => {
        chrome.tabs.onActivated.removeListener(handleActivated);
        chrome.tabs.onUpdated.removeListener(handleUpdated);
        chrome.tabs.onRemoved.removeListener(handleRemoved);
        chrome.tabs.onCreated.removeListener(handleCreated);
      };
    }
  }, []);

  // Initial load of settings and global memories, and instantiate harness
  useEffect(() => {
    async function init() {
      const loadedSettings = await loadSettings();
      const loadedGlobal = await loadGlobalMemories();
      const initialTabKey = currentTabKeyRef.current;
      const [loadedTabMems, loadedChat] = await Promise.all([
        loadTabMemories(initialTabKey),
        loadChatHistoryForTab(initialTabKey),
      ]);

      setSettings(loadedSettings);
      setGlobalMemories(loadedGlobal);
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
        onTurnComplete: (assistantText, toolCalls) => {
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
                isStreaming: false,
              };
            } else if (assistantText || toolCalls.length > 0) {
              const newAsst: ChatMessage = {
                id: `asst-${Date.now()}`,
                role: 'assistant',
                content: assistantText,
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

  // When active browser tab changes, load its scoped chat history and tab memories
  useEffect(() => {
    if (!initialized || !activeBrowserTab) return;
    const tabKey = getTabKey(activeBrowserTab);
    currentTabKeyRef.current = tabKey;

    let isMounted = true;
    Promise.all([
      loadTabMemories(tabKey),
      loadChatHistoryForTab(tabKey),
    ]).then(([tMems, msgs]) => {
      if (!isMounted) return;
      setTabMemories(tMems);
      setMessages(msgs);
    });

    return () => {
      isMounted = false;
    };
  }, [activeBrowserTab?.id, activeBrowserTab?.url, initialized]);

  // Keep harness synchronized with active memories and current settings
  useEffect(() => {
    if (!harnessRef.current) return;
    const activeDocs = [
      ...globalMemories.filter((m) => m.isActiveForContext),
      ...tabMemories.filter((m) => m.isActiveForContext),
    ];
    harnessRef.current.updateConfig(settings, activeDocs);
  }, [settings, globalMemories, tabMemories]);

  const handleSelectBrowserTab = (tab: BrowserTabInfo) => {
    setActiveBrowserTab(tab);
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.update) {
      chrome.tabs.update(tab.id, { active: true }, () => {});
    }
  };

  const handleSettingsSaved = (updated: AppSettings) => {
    setSettings(updated);
  };

  const handleGlobalMemoriesChange = (updated: UserDocument[]) => {
    setGlobalMemories(updated);
  };

  const handleTabMemoriesChange = (updated: UserDocument[]) => {
    setTabMemories(updated);
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
          <div className="w-5 h-5 rounded-md bg-zinc-100 text-zinc-950 flex items-center justify-center font-bold text-xs shadow-sm">
            <Zap className="w-3.5 h-3.5 fill-current" />
          </div>
          <span className="font-semibold text-xs tracking-tight text-zinc-100">
            AutoForm <span className="text-zinc-400 font-normal">AI</span>
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

      {/* Open Browser Tabs Switcher Bar */}
      {openTabs.length > 0 && (
        <div className="h-9 px-2 bg-zinc-950/90 border-b border-zinc-900 flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0">
          <div className="flex items-center gap-1 text-[10px] text-zinc-500 shrink-0 mr-0.5 font-medium">
            <Globe className="w-3 h-3 text-zinc-500" />
            <span>Tabs:</span>
          </div>
          {openTabs.map((tab) => {
            const isActive = activeBrowserTab?.id === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleSelectBrowserTab(tab)}
                title={`${tab.title}\n${tab.url}`}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] max-w-[130px] shrink-0 transition-all border ${
                  isActive
                    ? 'bg-zinc-850 text-zinc-100 border-zinc-700 font-medium shadow-xs'
                    : 'bg-zinc-900/40 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/80 border-zinc-850/60'
                }`}
              >
                {tab.favIconUrl ? (
                  <img
                    src={tab.favIconUrl}
                    alt=""
                    className="w-3 h-3 rounded-xs shrink-0 object-contain"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <Globe
                    className={`w-3 h-3 shrink-0 ${
                      isActive ? 'text-zinc-300' : 'text-zinc-500'
                    }`}
                  />
                )}
                <span className="truncate">{tab.title || 'Untitled'}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Main Tab Bar */}
      <nav className="h-9 px-2 border-b border-zinc-900 bg-zinc-950/60 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1 w-full">
          <button
            className={`flex-1 flex items-center justify-center gap-1.5 py-1 px-2 rounded-md text-[11px] font-medium transition-colors ${
              activeNavTab === 'chat'
                ? 'bg-zinc-900 text-zinc-100 border border-zinc-800/80 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/40'
            }`}
            onClick={() => setActiveNavTab('chat')}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Chat</span>
          </button>

          <button
            className={`flex-1 flex items-center justify-center gap-1.5 py-1 px-2 rounded-md text-[11px] font-medium transition-colors ${
              activeNavTab === 'memory'
                ? 'bg-zinc-900 text-zinc-100 border border-zinc-800/80 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/40'
            }`}
            onClick={() => setActiveNavTab('memory')}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Memory</span>
            <span className="ml-0.5 text-[9px] px-1 py-0.2 bg-zinc-800 rounded-full text-zinc-300">
              {activeDocuments.length}
            </span>
          </button>

          <button
            className={`flex-1 flex items-center justify-center gap-1.5 py-1 px-2 rounded-md text-[11px] font-medium transition-colors ${
              activeNavTab === 'inspector'
                ? 'bg-zinc-900 text-zinc-100 border border-zinc-800/80 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/40'
            }`}
            onClick={() => setActiveNavTab('inspector')}
          >
            <Scan className="w-3.5 h-3.5" />
            <span>DOM</span>
          </button>

          <button
            className={`flex-1 flex items-center justify-center gap-1.5 py-1 px-2 rounded-md text-[11px] font-medium transition-colors ${
              activeNavTab === 'settings'
                ? 'bg-zinc-900 text-zinc-100 border border-zinc-800/80 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/40'
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
          />
        )}

        {activeNavTab === 'memory' && (
          <MemoryView
            currentTabKey={currentTabKeyRef.current}
            currentTabTitle={activeBrowserTab?.title}
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
