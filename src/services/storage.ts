// Local storage service using chrome.storage.local with browser fallback for dev/testing

import { AppSettings, UserDocument, ChatMessage, ChatSession } from '../types';

const SETTINGS_KEY = 'autoform_settings';
const GLOBAL_MEMORY_KEY = 'autoform_global_memory';
const CHAT_HISTORY_PREFIX = 'autoform_chat_';
const TAB_MEMORY_PREFIX = 'autoform_tab_mem_';

export const DEFAULT_SETTINGS: AppSettings = {
  activeProvider: 'openai',
  selectedMode: 'free',
  free: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    apiKey: '',
    model: 'gemini-3.8-flash',
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-6-astra',
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com/v1',
    apiKey: '',
    model: 'claude-sonnet-5-5',
  },
  autoConfirmSubmit: true,
  systemInstruction: 'You are OpenBUA, an autonomous browser use assistant that helps users navigate, research, interact, and fill forms accurately using their active browser and stored documents.',
};

export const DEFAULT_GLOBAL_MEMORIES: UserDocument[] = [
  {
    id: 'mem-default-profile',
    title: 'Personal & Professional Profile (About Me)',
    type: 'markdown',
    content: `# Personal & Professional Information

## Contact Information
- Full Name: Alex Mercer
- First Name: Alex
- Last Name: Mercer
- Email: alex.mercer.work@example.com
- Phone: +1 (555) 234-5678
- Date of Birth: 1994-08-15
- Gender: Male

## Address
- Street: 742 Evergreen Terrace
- Apartment / Suite: Apt 4B
- City: Seattle
- State: Washington (WA)
- Postal Code / Zip: 98101
- Country: United States

## Professional Details
- Current Title: Senior Software Engineer
- Company: HyperScale Systems
- Years of Experience: 6
- Primary Skills: TypeScript, React, Node.js, Python, Cloud Architecture, GraphQL
- LinkedIn: https://linkedin.com/in/alex-mercer-dev
- GitHub: https://github.com/alexmercer
- Website / Portfolio: https://alexmercer.dev

## Education
- Degree: Bachelor of Science in Computer Science
- University: University of Washington
- Graduation Year: 2017
- GPA: 3.8 / 4.0
`,
    summary: 'Alex Mercer - Senior Software Engineer, Seattle WA. Full personal and professional profile.',
    createdAt: Date.now(),
    sizeBytes: 950,
    tags: ['profile', 'contact', 'resume', 'about-me'],
    isActiveForContext: true,
    isGlobal: true,
  },
];

// Helper to get tab key for scoped storage
// Scoped by Chrome tab ID so navigating to a new site/page within the SAME tab maintains chat history forever!
export function getTabKey(tab?: { id?: number; url?: string; title?: string } | null): string {
  if (!tab) return 'default_tab';
  if (typeof tab.id === 'number' && tab.id > 0) {
    return `tab_${tab.id}`;
  }
  if (tab.url) {
    try {
      const u = new URL(tab.url);
      if (u.protocol === 'file:') {
        const filePart = u.pathname.split('/').pop() || 'local_file';
        return `file_${filePart}`;
      }
      return `${u.hostname}${u.pathname}`;
    } catch {
      return tab.url.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
    }
  }
  return 'default_tab';
}

// Chrome storage wrapper with window.localStorage fallback
export async function getStorageItem<T>(key: string, defaultValue: T): Promise<T> {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (result) => {
        if (chrome.runtime.lastError || result[key] === undefined) {
          resolve(defaultValue);
        } else {
          resolve(result[key]);
        }
      });
    });
  } else {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : defaultValue;
    } catch {
      return defaultValue;
    }
  }
}

export async function setStorageItem<T>(key: string, value: T): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, () => resolve());
    });
  } else {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error('Failed to save to localStorage:', e);
    }
  }
}

// Settings
export async function loadSettings(): Promise<AppSettings> {
  const settings = await getStorageItem<AppSettings>(SETTINGS_KEY, DEFAULT_SETTINGS);
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    selectedMode: settings?.selectedMode || 'free',
    free: { ...DEFAULT_SETTINGS.free, ...(settings?.free || {}) },
    openai: { ...DEFAULT_SETTINGS.openai, ...(settings?.openai || {}) },
    anthropic: { ...DEFAULT_SETTINGS.anthropic, ...(settings?.anthropic || {}) },
  };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await setStorageItem(SETTINGS_KEY, settings);
}

// ========================================================
// Global Memories (Consistent across all tabs)
// ========================================================
export async function loadGlobalMemories(): Promise<UserDocument[]> {
  return await getStorageItem<UserDocument[]>(GLOBAL_MEMORY_KEY, DEFAULT_GLOBAL_MEMORIES);
}

export async function saveGlobalMemory(doc: UserDocument): Promise<void> {
  const memories = await loadGlobalMemories();
  const index = memories.findIndex((m) => m.id === doc.id);
  const toSave = { ...doc, isGlobal: true };
  if (index >= 0) {
    memories[index] = toSave;
  } else {
    memories.unshift(toSave);
  }
  await setStorageItem(GLOBAL_MEMORY_KEY, memories);
}

export async function deleteGlobalMemory(id: string): Promise<void> {
  const memories = await loadGlobalMemories();
  const filtered = memories.filter((m) => m.id !== id);
  await setStorageItem(GLOBAL_MEMORY_KEY, filtered);
}

export async function toggleGlobalMemoryActive(id: string): Promise<UserDocument[]> {
  const memories = await loadGlobalMemories();
  const updated = memories.map((m) =>
    m.id === id ? { ...m, isActiveForContext: !m.isActiveForContext } : m
  );
  await setStorageItem(GLOBAL_MEMORY_KEY, updated);
  return updated;
}

// ========================================================
// Tab-Scoped Memories (Specific to current tab / page)
// ========================================================
export async function loadTabMemories(tabKey: string): Promise<UserDocument[]> {
  const key = `${TAB_MEMORY_PREFIX}${encodeURIComponent(tabKey)}`;
  return await getStorageItem<UserDocument[]>(key, []);
}

export async function saveTabMemory(tabKey: string, doc: UserDocument): Promise<void> {
  const key = `${TAB_MEMORY_PREFIX}${encodeURIComponent(tabKey)}`;
  const memories = await loadTabMemories(tabKey);
  const index = memories.findIndex((m) => m.id === doc.id);
  const toSave = { ...doc, isGlobal: false, tabUrlPattern: tabKey };
  if (index >= 0) {
    memories[index] = toSave;
  } else {
    memories.unshift(toSave);
  }
  await setStorageItem(key, memories);
}

export async function deleteTabMemory(tabKey: string, id: string): Promise<void> {
  const key = `${TAB_MEMORY_PREFIX}${encodeURIComponent(tabKey)}`;
  const memories = await loadTabMemories(tabKey);
  const filtered = memories.filter((m) => m.id !== id);
  await setStorageItem(key, filtered);
}

export async function toggleTabMemoryActive(tabKey: string, id: string): Promise<UserDocument[]> {
  const key = `${TAB_MEMORY_PREFIX}${encodeURIComponent(tabKey)}`;
  const memories = await loadTabMemories(tabKey);
  const updated = memories.map((m) =>
    m.id === id ? { ...m, isActiveForContext: !m.isActiveForContext } : m
  );
  await setStorageItem(key, updated);
  return updated;
}

// Get all active memories for a tab (Active Global + Active Tab)
export async function getActiveContextMemories(tabKey: string): Promise<UserDocument[]> {
  const [globalMems, tabMems] = await Promise.all([
    loadGlobalMemories(),
    loadTabMemories(tabKey),
  ]);
  const activeGlobal = globalMems.filter((m) => m.isActiveForContext);
  const activeTab = tabMems.filter((m) => m.isActiveForContext);
  return [...activeGlobal, ...activeTab];
}

// Backwards compatibility wrappers
export async function loadDocuments(): Promise<UserDocument[]> {
  return await loadGlobalMemories();
}

export async function saveDocument(doc: UserDocument): Promise<void> {
  await saveGlobalMemory(doc);
}

export async function deleteDocument(id: string): Promise<void> {
  await deleteGlobalMemory(id);
}

export async function toggleDocumentActive(id: string): Promise<UserDocument[]> {
  return await toggleGlobalMemoryActive(id);
}

// ========================================================
// Chat Sessions Management (General Chat Tabs)
// ========================================================
const CHAT_SESSIONS_KEY = 'autoform_chat_sessions';

export async function loadChatSessions(): Promise<ChatSession[]> {
  const sessions = await getStorageItem<ChatSession[]>(CHAT_SESSIONS_KEY, []);
  if (sessions.length === 0) {
    const defaultSession: ChatSession = {
      id: 'session_default',
      title: 'Chat 1',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await setStorageItem(CHAT_SESSIONS_KEY, [defaultSession]);
    return [defaultSession];
  }
  return sessions;
}

export async function saveChatSessions(sessions: ChatSession[]): Promise<void> {
  await setStorageItem(CHAT_SESSIONS_KEY, sessions);
}

export async function createNewChatSession(title?: string): Promise<ChatSession> {
  const sessions = await loadChatSessions();
  let defaultTitle = title;
  if (!defaultTitle) {
    // Scan all existing session titles to find highest number among "Chat N"
    const numbers = sessions
      .map((s) => {
        const match = s.title.match(/^Chat\s+(\d+)$/i);
        return match ? parseInt(match[1], 10) : 0;
      })
      .filter((n) => n > 0);

    const maxNum = numbers.length > 0 ? Math.max(...numbers) : 0;
    let nextNum = maxNum + 1;
    // Extra safety: ensure title is not duplicate with any existing session
    while (sessions.some((s) => s.title.trim().toLowerCase() === `chat ${nextNum}`.toLowerCase())) {
      nextNum++;
    }
    defaultTitle = `Chat ${nextNum}`;
  }

  const newSession: ChatSession = {
    id: `session_${Date.now()}`,
    title: defaultTitle,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const updated = [...sessions, newSession];
  await saveChatSessions(updated);
  return newSession;
}

export async function deleteChatSession(sessionId: string): Promise<ChatSession[]> {
  const sessions = await loadChatSessions();
  const updated = sessions.filter((s) => s.id !== sessionId);
  const finalSessions = updated.length > 0 ? updated : [
    {
      id: `session_${Date.now()}`,
      title: 'Chat 1',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ];
  await saveChatSessions(finalSessions);
  // Also clear messages, tab memories, and scratchpad associated with deleted session
  await clearChatHistoryForTab(sessionId);
  await clearScratchpad(sessionId);
  return finalSessions;
}

export async function renameChatSession(sessionId: string, newTitle: string): Promise<ChatSession[]> {
  const sessions = await loadChatSessions();
  const trimmed = newTitle.trim();
  if (!trimmed) return sessions;
  const updated = sessions.map((s) =>
    s.id === sessionId ? { ...s, title: trimmed, updatedAt: Date.now() } : s
  );
  await saveChatSessions(updated);
  return updated;
}

// ========================================================
// Last Active State (Nav Tab & Session ID Persistence)
// ========================================================
const LAST_ACTIVE_NAV_TAB_KEY = 'openbua_last_active_nav_tab';
const LAST_ACTIVE_SESSION_ID_KEY = 'openbua_last_active_session_id';

export async function saveLastActiveState(
  navTab: 'chat' | 'memory' | 'settings',
  sessionId?: string
): Promise<void> {
  const ops: Promise<void>[] = [setStorageItem(LAST_ACTIVE_NAV_TAB_KEY, navTab)];
  if (sessionId) {
    ops.push(setStorageItem(LAST_ACTIVE_SESSION_ID_KEY, sessionId));
  }
  await Promise.all(ops);
}

export async function loadLastActiveState(): Promise<{
  navTab: 'chat' | 'memory' | 'settings';
  sessionId?: string;
}> {
  const [navTab, sessionId] = await Promise.all([
    getStorageItem<'chat' | 'memory' | 'settings'>(LAST_ACTIVE_NAV_TAB_KEY, 'chat'),
    getStorageItem<string | undefined>(LAST_ACTIVE_SESSION_ID_KEY, undefined),
  ]);
  return { navTab, sessionId };
}

// ========================================================
// Tab-Scoped Chat History
// ========================================================
export async function loadChatHistoryForTab(tabKey: string): Promise<ChatMessage[]> {
  const key = `${CHAT_HISTORY_PREFIX}${encodeURIComponent(tabKey)}`;
  return await getStorageItem<ChatMessage[]>(key, []);
}

export async function saveChatHistoryForTab(tabKey: string, messages: ChatMessage[]): Promise<void> {
  const key = `${CHAT_HISTORY_PREFIX}${encodeURIComponent(tabKey)}`;
  const trimmed = messages.slice(-100);
  await setStorageItem(key, trimmed);
}

export async function clearChatHistoryForTab(tabKey: string): Promise<void> {
  const key = `${CHAT_HISTORY_PREFIX}${encodeURIComponent(tabKey)}`;
  await setStorageItem(key, []);
}

// Backwards compatibility for single chat
export async function loadChatHistory(): Promise<ChatMessage[]> {
  return await getStorageItem<ChatMessage[]>('autoform_chat_history', []);
}

export async function saveChatHistory(messages: ChatMessage[]): Promise<void> {
  const trimmed = messages.slice(-100);
  await setStorageItem('autoform_chat_history', trimmed);
}

export async function clearChatHistory(): Promise<void> {
  await setStorageItem('autoform_chat_history', []);
}

// ========================================================
// Session-Scoped Agent Scratchpad / Research Notepad
// ========================================================
const SCRATCHPAD_PREFIX = 'openbua_scratchpad_';

let currentActiveSessionId = 'session_default';

export function setActiveSessionIdState(sessionId: string): void {
  if (sessionId) {
    currentActiveSessionId = sessionId;
  }
}

export function getActiveSessionIdState(): string {
  return currentActiveSessionId || 'session_default';
}

export async function getScratchpad(sessionId?: string): Promise<string> {
  const sid = sessionId || currentActiveSessionId || 'session_default';
  const key = `${SCRATCHPAD_PREFIX}${encodeURIComponent(sid)}`;
  return await getStorageItem<string>(key, '');
}

export async function saveScratchpad(content: string, sessionId?: string): Promise<void> {
  const sid = sessionId || currentActiveSessionId || 'session_default';
  const key = `${SCRATCHPAD_PREFIX}${encodeURIComponent(sid)}`;
  await setStorageItem(key, content);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('openbua_scratchpad_updated', {
        detail: { content, sessionId: sid },
      })
    );
  }
}

export async function appendToScratchpad(entry: string, sessionId?: string): Promise<string> {
  const sid = sessionId || currentActiveSessionId || 'session_default';
  const current = await getScratchpad(sid);
  const trimmed = entry.trim();
  const updated = current ? `${current}\n\n${trimmed}` : trimmed;
  await saveScratchpad(updated, sid);
  return updated;
}

export async function clearScratchpad(sessionId?: string): Promise<void> {
  const sid = sessionId || currentActiveSessionId || 'session_default';
  const key = `${SCRATCHPAD_PREFIX}${encodeURIComponent(sid)}`;
  await setStorageItem(key, '');
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('openbua_scratchpad_updated', {
        detail: { content: '', sessionId: sid },
      })
    );
  }
}

// Gemini Daily Usage Tracking (Free Tier Limit: 1,500 Requests/Day)
export const GEMINI_USAGE_KEY = 'gemini_daily_usage';
export const GEMINI_DAILY_LIMIT = 1500;

export interface GeminiUsageInfo {
  count: number;
  limit: number;
  remaining: number;
  remainingPercent: number;
  date: string;
}

export async function getGeminiDailyUsage(): Promise<GeminiUsageInfo> {
  const today = new Date().toISOString().slice(0, 10);
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const data = await chrome.storage.local.get(GEMINI_USAGE_KEY);
      const usage = data[GEMINI_USAGE_KEY];
      if (usage && usage.date === today && typeof usage.count === 'number') {
        const remaining = Math.max(0, GEMINI_DAILY_LIMIT - usage.count);
        const remainingPercent = Math.max(0, Math.min(100, Math.round((remaining / GEMINI_DAILY_LIMIT) * 100)));
        return { count: usage.count, limit: GEMINI_DAILY_LIMIT, remaining, remainingPercent, date: today };
      }
    } else if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(GEMINI_USAGE_KEY);
      if (raw) {
        const usage = JSON.parse(raw);
        if (usage && usage.date === today && typeof usage.count === 'number') {
          const remaining = Math.max(0, GEMINI_DAILY_LIMIT - usage.count);
          const remainingPercent = Math.max(0, Math.min(100, Math.round((remaining / GEMINI_DAILY_LIMIT) * 100)));
          return { count: usage.count, limit: GEMINI_DAILY_LIMIT, remaining, remainingPercent, date: today };
        }
      }
    }
  } catch (e) {
    console.warn('Failed to load Gemini daily usage:', e);
  }
  return { count: 0, limit: GEMINI_DAILY_LIMIT, remaining: GEMINI_DAILY_LIMIT, remainingPercent: 100, date: today };
}

export async function incrementGeminiDailyUsage(): Promise<GeminiUsageInfo> {
  const current = await getGeminiDailyUsage();
  const nextCount = current.count + 1;
  const today = new Date().toISOString().slice(0, 10);
  const updatedData = { date: today, count: nextCount };

  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ [GEMINI_USAGE_KEY]: updatedData });
    } else if (typeof localStorage !== 'undefined') {
      localStorage.setItem(GEMINI_USAGE_KEY, JSON.stringify(updatedData));
    }
  } catch (e) {
    console.warn('Failed to save Gemini daily usage:', e);
  }

  const remaining = Math.max(0, GEMINI_DAILY_LIMIT - nextCount);
  const remainingPercent = Math.max(0, Math.min(100, Math.round((remaining / GEMINI_DAILY_LIMIT) * 100)));
  return { count: nextCount, limit: GEMINI_DAILY_LIMIT, remaining, remainingPercent, date: today };
}



