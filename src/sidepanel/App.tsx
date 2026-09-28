import React, { useState, useEffect, useRef } from 'react';
import {
  AppSettings,
  UserDocument,
  ChatMessage,
  ToolCallState,
} from '../types';
import {
  loadSettings,
  saveSettings,
  loadDocuments,
  loadChatHistory,
  saveChatHistory,
  DEFAULT_SETTINGS,
} from '../services/storage';
import { FormAgentHarness } from '../agent/form-agent';
import { ChatView } from '../components/ChatView';
import { VaultView } from '../components/VaultView';
import { InspectorView } from '../components/InspectorView';
import { SettingsView } from '../components/SettingsView';
import { Badge } from '../components/ui/card';
import {
  MessageSquare,
  FileText,
  Scan,
  Settings,
  Sparkles,
  Zap,
} from 'lucide-react';

export function App() {
  const [activeTab, setActiveTab] = useState<'chat' | 'vault' | 'inspector' | 'settings'>('chat');
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [documents, setDocuments] = useState<UserDocument[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [initialized, setInitialized] = useState(false);

  const harnessRef = useRef<FormAgentHarness | null>(null);

  // Load initial settings, documents, and chat history
  useEffect(() => {
    async function init() {
      const loadedSettings = await loadSettings();
      const loadedDocs = await loadDocuments();
      const loadedChat = await loadChatHistory();

      setSettings(loadedSettings);
      setDocuments(loadedDocs);
      setMessages(loadedChat);

      // Create Agent Harness
      const harness = new FormAgentHarness(loadedSettings, loadedDocs, {
        onStatusChange: (busy) => setIsBusy(busy),
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
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === 'assistant') {
              const updated = [...prev];
              updated[updated.length - 1] = {
                ...last,
                content: assistantText || last.content,
                toolCalls: toolCalls.length > 0 ? toolCalls : last.toolCalls,
                isStreaming: false,
              };
              saveChatHistory(updated);
              return updated;
            }
            return prev;
          });
        },
        onError: (err) => {
          setMessages((prev) => {
            const errorMsg: ChatMessage = {
              id: `err-${Date.now()}`,
              role: 'assistant',
              content: `⚠️ Error: ${err}`,
              timestamp: Date.now(),
              isStreaming: false,
            };
            const updated = [...prev, errorMsg];
            saveChatHistory(updated);
            return updated;
          });
        },
      });

      harnessRef.current = harness;
      setInitialized(true);
    }

    init();
  }, []);

  // Update harness configuration when settings or documents change
  const handleSettingsSaved = (updated: AppSettings) => {
    setSettings(updated);
    if (harnessRef.current) {
      harnessRef.current.updateConfig(updated, documents);
    }
  };

  const handleDocumentsChange = (updatedDocs: UserDocument[]) => {
    setDocuments(updatedDocs);
    if (harnessRef.current) {
      harnessRef.current.updateConfig(settings, updatedDocs);
    }
  };

  const handleMessagesChange = (updatedMsgs: ChatMessage[]) => {
    setMessages(updatedMsgs);
    saveChatHistory(updatedMsgs);
  };

  const handleInspectorFillRequested = (promptText?: string) => {
    setActiveTab('chat');
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

  const activeProviderModel =
    settings.activeProvider === 'anthropic' ? settings.anthropic.model : settings.openai.model;

  const currentKey =
    settings.activeProvider === 'anthropic' ? settings.anthropic.apiKey : settings.openai.apiKey;
  const hasKey = Boolean(currentKey && currentKey.trim().length > 3);

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
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 ml-0.5 animate-pulse" />
        </div>

        <div className="flex items-center gap-1.5">
          <Badge
            variant="zinc"
            className="text-[10px] font-mono py-0 px-1.5 h-5 border-zinc-800 text-zinc-400 max-w-[120px] truncate"
            title={`Active Model: ${activeProviderModel}`}
          >
            {activeProviderModel}
          </Badge>
          {!hasKey && (
            <Badge variant="warning" className="text-[9px] py-0 px-1.5 h-5">
              BYOK Required
            </Badge>
          )}
        </div>
      </header>

      {/* Main Tab Bar */}
      <nav className="h-9 px-2 border-b border-zinc-900 bg-zinc-950/60 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1 w-full">
          <button
            className={`flex-1 flex items-center justify-center gap-1.5 py-1 px-2 rounded-md text-[11px] font-medium transition-colors ${
              activeTab === 'chat'
                ? 'bg-zinc-900 text-zinc-100 border border-zinc-800/80 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/40'
            }`}
            onClick={() => setActiveTab('chat')}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Chat</span>
          </button>

          <button
            className={`flex-1 flex items-center justify-center gap-1.5 py-1 px-2 rounded-md text-[11px] font-medium transition-colors ${
              activeTab === 'vault'
                ? 'bg-zinc-900 text-zinc-100 border border-zinc-800/80 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/40'
            }`}
            onClick={() => setActiveTab('vault')}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Vault</span>
            <span className="ml-0.5 text-[9px] px-1 py-0.2 bg-zinc-800 rounded-full text-zinc-300">
              {documents.filter((d) => d.isActiveForContext).length}
            </span>
          </button>

          <button
            className={`flex-1 flex items-center justify-center gap-1.5 py-1 px-2 rounded-md text-[11px] font-medium transition-colors ${
              activeTab === 'inspector'
                ? 'bg-zinc-900 text-zinc-100 border border-zinc-800/80 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/40'
            }`}
            onClick={() => setActiveTab('inspector')}
          >
            <Scan className="w-3.5 h-3.5" />
            <span>DOM</span>
          </button>

          <button
            className={`flex-1 flex items-center justify-center gap-1.5 py-1 px-2 rounded-md text-[11px] font-medium transition-colors ${
              activeTab === 'settings'
                ? 'bg-zinc-900 text-zinc-100 border border-zinc-800/80 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/40'
            }`}
            onClick={() => setActiveTab('settings')}
          >
            <Settings className="w-3.5 h-3.5" />
            <span>BYOK</span>
          </button>
        </div>
      </nav>

      {/* Main View Area */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        {activeTab === 'chat' && (
          <ChatView
            messages={messages}
            onMessagesChange={handleMessagesChange}
            harness={harnessRef.current}
            isBusy={isBusy}
            settings={settings}
            documents={documents}
            onNavigateToSettings={() => setActiveTab('settings')}
            onNavigateToVault={() => setActiveTab('vault')}
          />
        )}

        {activeTab === 'vault' && (
          <VaultView documents={documents} onDocumentsChange={handleDocumentsChange} />
        )}

        {activeTab === 'inspector' && (
          <InspectorView onFillRequested={handleInspectorFillRequested} />
        )}

        {activeTab === 'settings' && (
          <SettingsView settings={settings} onSettingsSaved={handleSettingsSaved} />
        )}
      </main>
    </div>
  );
}
