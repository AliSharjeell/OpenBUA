// Local storage service using chrome.storage.local with browser fallback for dev/testing

import { AppSettings, UserDocument, ChatMessage, ChatSession, SuggestedMemory } from '../types';
import { compactMemoryMedia } from './memory-media';
import { deleteMediaBlob, mediaBlobKeyFor } from './blob-store';

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
    model: 'gemini-3.5-flash-lite',
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

export const DEFAULT_GLOBAL_MEMORIES: UserDocument[] = [];

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
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [key]: value }, () => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message || 'Failed to save extension storage'));
        else resolve();
      });
    });
  } else {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error('Failed to save to localStorage:', e);
      throw e;
    }
  }
}

// Settings
export async function loadSettings(): Promise<AppSettings> {
  const settings = await getStorageItem<AppSettings>(SETTINGS_KEY, DEFAULT_SETTINGS);
  const loadedFreeModel = settings?.free?.model;
  // Automatically migrate deprecated 2.5 models to gemini-3.5-flash-lite
  const activeFreeModel =
    loadedFreeModel === 'gemini-2.5-flash-lite' || loadedFreeModel === 'gemini-2.5-flash'
      ? 'gemini-3.5-flash-lite'
      : loadedFreeModel || DEFAULT_SETTINGS.free.model;

  const mergedSettings: AppSettings = {
    ...DEFAULT_SETTINGS,
    ...settings,
    selectedMode: settings?.selectedMode || 'free',
    free: { ...DEFAULT_SETTINGS.free, ...(settings?.free || {}), model: activeFreeModel },
    openai: { ...DEFAULT_SETTINGS.openai, ...(settings?.openai || {}) },
    anthropic: { ...DEFAULT_SETTINGS.anthropic, ...(settings?.anthropic || {}) },
  };

  // If migration occurred, persist the updated model to storage
  if (loadedFreeModel && loadedFreeModel !== activeFreeModel) {
    setStorageItem(SETTINGS_KEY, mergedSettings).catch(() => {});
  }

  return mergedSettings;
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await setStorageItem(SETTINGS_KEY, settings);
}

// ========================================================
// Global Memories (Consistent across all tabs)
// ========================================================
const pendingMemoryLoads = new Map<string, Promise<UserDocument[]>>();

function loadMemoryList(key: string, defaults: UserDocument[] = []): Promise<UserDocument[]> {
  const pending = pendingMemoryLoads.get(key);
  if (pending) return pending;
  // Reads never decode media or wait for IndexedDB. Migration is explicit.
  const load = getStorageItem<UserDocument[]>(key, defaults);
  pendingMemoryLoads.set(key, load);
  void load.finally(() => pendingMemoryLoads.delete(key)).catch(() => {});
  return load;
}

const pendingMemoryWrites = new Map<string, Promise<UserDocument[]>>();

function updateMemoryList(
  key: string, update: (docs: UserDocument[]) => UserDocument[] | Promise<UserDocument[]>
): Promise<UserDocument[]> {
  const previous = pendingMemoryWrites.get(key) || Promise.resolve([]);
  const write = previous.catch(() => []).then(async () => {
    const current = await loadMemoryList(key);
    const updated = await update(current);
    if (updated !== current) await setStorageItem(key, updated);
    return updated;
  });
  pendingMemoryWrites.set(key, write);
  void write.finally(() => {
    if (pendingMemoryWrites.get(key) === write) pendingMemoryWrites.delete(key);
  }).catch(() => {});
  return write;
}

const pendingMediaMigrations = new Map<string, Promise<UserDocument[]>>();

function migrateMemoryMedia(key: string, snapshot: UserDocument[]): Promise<UserDocument[]> {
  const pending = pendingMediaMigrations.get(key);
  if (pending) return pending;
  const migration = (async () => {
    const changes = new Map<string, { before: UserDocument; after: UserDocument }>();
    for (const doc of snapshot) {
      if (!doc.dataUrl) continue;
      // Use a separate blob key so an old migration cannot overwrite a newer
      // attachment saved while this document was being decoded.
      const candidate = { ...doc, blobKey: `${mediaBlobKeyFor(doc.id)}:legacy:${crypto.randomUUID()}` };
      const compacted = await compactMemoryMedia(candidate);
      if (compacted !== candidate) changes.set(doc.id, { before: doc, after: compacted });
    }
    if (!changes.size) return snapshot;
    const applied = new Set<string>();
    const latest = await updateMemoryList(key, (docs) => docs.map((doc) => {
      const change = changes.get(doc.id);
      if (!change || doc.dataUrl !== change.before.dataUrl || doc.blobKey !== change.before.blobKey) return doc;
      applied.add(doc.id);
      const { dataUrl: _inlineBytes, ...metadata } = doc;
      return { ...metadata, blobKey: change.after.blobKey };
    }));
    for (const [id, change] of changes) {
      if (!applied.has(id) && change.after.blobKey) await deleteMediaBlob(change.after.blobKey);
    }
    return latest;
  })();
  pendingMediaMigrations.set(key, migration);
  void migration.finally(() => pendingMediaMigrations.delete(key)).catch(() => {});
  return migration;
}

/** Explicit maintenance: run after startup has rendered, never inside a load. */
export function migrateGlobalMemoryMedia(snapshot: UserDocument[]): Promise<UserDocument[]> {
  return migrateMemoryMedia(GLOBAL_MEMORY_KEY, snapshot);
}

export function migrateTabMemoryMedia(tabKey: string, snapshot: UserDocument[]): Promise<UserDocument[]> {
  return migrateMemoryMedia(`${TAB_MEMORY_PREFIX}${encodeURIComponent(tabKey)}`, snapshot);
}

export async function loadGlobalMemories(): Promise<UserDocument[]> {
  const list = await loadMemoryList(GLOBAL_MEMORY_KEY, DEFAULT_GLOBAL_MEMORIES);
  return list.filter((m) => m.id !== 'mem-default-profile');
}

export async function saveGlobalMemory(doc: UserDocument): Promise<void> {
  const toSave = await compactMemoryMedia({ ...doc, isGlobal: true });
  await updateMemoryList(GLOBAL_MEMORY_KEY, (docs) =>
    docs.some((m) => m.id === doc.id)
      ? docs.map((m) => m.id === doc.id ? toSave : m)
      : [toSave, ...docs]
  );
}

export async function deleteGlobalMemory(id: string): Promise<void> {
  await updateMemoryList(GLOBAL_MEMORY_KEY, (docs) => docs.filter((m) => m.id !== id));
}

export async function toggleGlobalMemoryActive(id: string): Promise<UserDocument[]> {
  return updateMemoryList(GLOBAL_MEMORY_KEY, (docs) => docs.map((m) =>
    m.id === id ? { ...m, isActiveForContext: !m.isActiveForContext } : m
  ));
}

// ========================================================
// Tab-Scoped Memories (Specific to current tab / page)
// ========================================================
export async function loadTabMemories(tabKey: string): Promise<UserDocument[]> {
  const key = `${TAB_MEMORY_PREFIX}${encodeURIComponent(tabKey)}`;
  return await loadMemoryList(key);
}

export async function saveTabMemory(tabKey: string, doc: UserDocument): Promise<void> {
  const key = `${TAB_MEMORY_PREFIX}${encodeURIComponent(tabKey)}`;
  const toSave = await compactMemoryMedia({ ...doc, isGlobal: false, tabUrlPattern: tabKey });
  await updateMemoryList(key, (docs) =>
    docs.some((m) => m.id === doc.id)
      ? docs.map((m) => m.id === doc.id ? toSave : m)
      : [toSave, ...docs]
  );
}

export async function deleteTabMemory(tabKey: string, id: string): Promise<void> {
  const key = `${TAB_MEMORY_PREFIX}${encodeURIComponent(tabKey)}`;
  await updateMemoryList(key, (docs) => docs.filter((m) => m.id !== id));
}

export async function toggleTabMemoryActive(tabKey: string, id: string): Promise<UserDocument[]> {
  const key = `${TAB_MEMORY_PREFIX}${encodeURIComponent(tabKey)}`;
  return updateMemoryList(key, (docs) => docs.map((m) =>
    m.id === id ? { ...m, isActiveForContext: !m.isActiveForContext } : m
  ));
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
  // Also clear messages, tab memories, scratchpad, and suggested memories associated with deleted session
  await clearChatHistoryForTab(sessionId);
  await clearScratchpad(sessionId);
  await clearSuggestedMemories(sessionId);
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

export function isGenericSessionTitle(title?: string): boolean {
  if (!title) return true;
  const trimmed = title.trim();
  return (
    /^Chat\s+\d+$/i.test(trimmed) ||
    /^Chat$/i.test(trimmed) ||
    /^New\s+Chat$/i.test(trimmed) ||
    /^Untitled$/i.test(trimmed)
  );
}

export function generateSessionTitle(prompt: string): string {
  if (!prompt || typeof prompt !== 'string') return 'New Chat';

  let text = prompt.trim();

  // Strip code blocks, markdown tags, backticks
  text = text.replace(/```[\s\S]*?```/g, '').replace(/`.*?`/g, '').replace(/[*_~#]/g, '');

  // Convert URLs to clean domain titles (e.g. jobs.lever.co -> Lever)
  text = text.replace(/https?:\/\/(?:www\.)?([^\s/]+)[^\s]*/gi, (_match, domain) => {
    const parts = domain.split('.');
    const cleanDomain = parts.length > 2 && (parts[0] === 'jobs' || parts[0] === 'apply') ? parts[1] : parts[0];
    return cleanDomain.charAt(0).toUpperCase() + cleanDomain.slice(1);
  });

  // Remove common conversational command prefixes
  const prefixRegex =
    /^(can you please|could you please|please|can you|could you|help me to|help me|i want to|i need to|i'd like to|let's|go to|open up|open|navigate to|look at|check out|find me|search for|look for|tell me about|tell me|show me|how to|what is|give me a|give me|start)\s+/i;

  let cleaned = text.replace(prefixRegex, '').trim();
  if (cleaned.length < 3) cleaned = text;

  // Split into words, cleaning punctuation
  let words = cleaned
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return 'New Chat';

  // Acronym preservation
  const acronyms = new Set(['ai', 'vc', 'ceo', 'cto', 'url', 'api', 'yc', 'bua', 'ui', 'ux', 'sf', 'la', 'ny', 'nyc', 'mv3', 'gfm', 'dom']);

  // Handle common 1-word greetings or test inputs
  const greetings = new Set(['hi', 'hello', 'hey', 'test', 'ping', 'sup', 'yo']);
  if (words.length === 1 && greetings.has(words[0].toLowerCase())) {
    return 'General Chat';
  }

  // Filter low-value filler words if phrase is longer than 3 words
  const fillerWords = new Set(['the', 'a', 'an', 'this', 'that', 'these', 'those', 'my', 'our', 'some', 'any']);
  if (words.length > 3) {
    words = words.filter((w, idx) => idx === 0 || !fillerWords.has(w.toLowerCase()));
  }

  // Capitalize words
  const capitalized = words.map((w) => {
    const lower = w.toLowerCase();
    if (acronyms.has(lower) || (w.length <= 4 && w === w.toUpperCase() && !/^\d+$/.test(w))) {
      return w.toUpperCase();
    }
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  });

  // Accumulate up to 4 words (max ~25 chars)
  const titleWords: string[] = [];
  let length = 0;
  for (const w of capitalized) {
    if (titleWords.length >= 4) break;
    if (length + w.length + 1 > 24 && titleWords.length >= 2) break;
    titleWords.push(w);
    length += w.length + 1;
  }

  // Remove trailing prepositions/stopwords (e.g. "On", "For", "To", "From", "In", "At", "With", "Of", "About")
  const trailingPrepositions = new Set(['to', 'for', 'on', 'with', 'from', 'in', 'at', 'of', 'and', 'or', 'about']);
  while (titleWords.length > 1 && trailingPrepositions.has(titleWords[titleWords.length - 1].toLowerCase())) {
    titleWords.pop();
  }

  const result = titleWords.join(' ');
  return result.length > 26 ? result.slice(0, 23).trim() + '...' : result;
}

// ========================================================
// Last Active State (Nav Tab & Session ID Persistence)
// ========================================================
const LAST_ACTIVE_NAV_TAB_KEY = 'openbua_last_active_nav_tab';
const LAST_ACTIVE_SESSION_ID_KEY = 'openbua_last_active_session_id';

export async function saveLastActiveState(
  navTab: 'chat' | 'memory' | 'settings' | 'preview' | 'suggestions',
  sessionId?: string
): Promise<void> {
  const ops: Promise<void>[] = [setStorageItem(LAST_ACTIVE_NAV_TAB_KEY, navTab)];
  if (sessionId) {
    ops.push(setStorageItem(LAST_ACTIVE_SESSION_ID_KEY, sessionId));
  }
  await Promise.all(ops);
}

export async function loadLastActiveState(): Promise<{
  navTab: 'chat' | 'memory' | 'settings' | 'preview' | 'suggestions';
  sessionId?: string;
}> {
  const [navTab, sessionId] = await Promise.all([
    getStorageItem<'chat' | 'memory' | 'settings' | 'preview' | 'suggestions'>(LAST_ACTIVE_NAV_TAB_KEY, 'chat'),
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
  if (!current) {
    await saveScratchpad(trimmed, sid);
    return trimmed;
  }
  const isTableRow = trimmed.startsWith('|') && trimmed.includes('|');
  const lastLineIsTableRow = current.trimEnd().endsWith('|');
  const separator = isTableRow && lastLineIsTableRow ? '\n' : '\n\n';
  const updated = `${current.trimEnd()}${separator}${trimmed}`;
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

// ========================================================
// Suggested Memories Storage
// ========================================================
const SUGGESTED_MEMORIES_KEY = 'openbua_suggested_memories';

export async function loadSuggestedMemories(sessionId?: string): Promise<SuggestedMemory[]> {
  const all = await getStorageItem<SuggestedMemory[]>(SUGGESTED_MEMORIES_KEY, []);
  if (!sessionId) return all;
  return all.filter((s) => !s.sessionId || s.sessionId === sessionId);
}

export async function saveSuggestedMemory(suggestion: SuggestedMemory): Promise<SuggestedMemory[]> {
  const all = await getStorageItem<SuggestedMemory[]>(SUGGESTED_MEMORIES_KEY, []);
  const existingIdx = all.findIndex((s) => s.id === suggestion.id);
  let updated: SuggestedMemory[];
  if (existingIdx >= 0) {
    updated = [...all];
    updated[existingIdx] = suggestion;
  } else {
    updated = [suggestion, ...all];
  }
  await setStorageItem(SUGGESTED_MEMORIES_KEY, updated);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('openbua_suggested_memories_updated', {
        detail: { suggestion, sessionId: suggestion.sessionId },
      })
    );
  }
  return updated;
}

export async function deleteSuggestedMemory(id: string): Promise<SuggestedMemory[]> {
  const all = await getStorageItem<SuggestedMemory[]>(SUGGESTED_MEMORIES_KEY, []);
  const updated = all.filter((s) => s.id !== id);
  await setStorageItem(SUGGESTED_MEMORIES_KEY, updated);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('openbua_suggested_memories_updated', {
        detail: { deletedId: id },
      })
    );
  }
  return updated;
}

export async function clearSuggestedMemories(sessionId?: string): Promise<void> {
  if (sessionId) {
    const all = await getStorageItem<SuggestedMemory[]>(SUGGESTED_MEMORIES_KEY, []);
    const remaining = all.filter((s) => s.sessionId && s.sessionId !== sessionId);
    await setStorageItem(SUGGESTED_MEMORIES_KEY, remaining);
  } else {
    await setStorageItem(SUGGESTED_MEMORIES_KEY, []);
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('openbua_suggested_memories_updated', {
        detail: { clearedSessionId: sessionId },
      })
    );
  }
}
