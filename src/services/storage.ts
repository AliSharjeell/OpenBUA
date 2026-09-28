// Local storage service using chrome.storage.local with browser fallback for dev/testing

import { AppSettings, UserDocument, ChatMessage } from '../types';

const SETTINGS_KEY = 'autoform_settings';
const DOCUMENTS_KEY = 'autoform_documents';
const CHAT_HISTORY_KEY = 'autoform_chat_history';

export const DEFAULT_SETTINGS: AppSettings = {
  activeProvider: 'openai',
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o',
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com/v1',
    apiKey: '',
    model: 'claude-3-7-sonnet-20250219',
  },
  autoConfirmSubmit: true,
  systemInstruction: 'You are AutoForm AI, an autonomous browser assistant that helps users fill forms on websites accurately using their stored documents and profile.',
};

const DEFAULT_DOCUMENTS: UserDocument[] = [
  {
    id: 'doc-default-profile',
    title: 'Personal & Professional Profile',
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
    tags: ['profile', 'contact', 'resume'],
    isActiveForContext: true,
  }
];

// Chrome storage wrapper with window.localStorage fallback
export async function getStorageItem<T>(key: string, defaultValue: T): Promise<T> {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (result) => {
        if (chrome.runtime.lastError || !result[key]) {
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
    openai: { ...DEFAULT_SETTINGS.openai, ...(settings?.openai || {}) },
    anthropic: { ...DEFAULT_SETTINGS.anthropic, ...(settings?.anthropic || {}) },
  };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await setStorageItem(SETTINGS_KEY, settings);
}

// Documents
export async function loadDocuments(): Promise<UserDocument[]> {
  const docs = await getStorageItem<UserDocument[]>(DOCUMENTS_KEY, DEFAULT_DOCUMENTS);
  return docs;
}

export async function saveDocument(doc: UserDocument): Promise<void> {
  const docs = await loadDocuments();
  const index = docs.findIndex((d) => d.id === doc.id);
  if (index >= 0) {
    docs[index] = doc;
  } else {
    docs.unshift(doc);
  }
  await setStorageItem(DOCUMENTS_KEY, docs);
}

export async function deleteDocument(id: string): Promise<void> {
  const docs = await loadDocuments();
  const filtered = docs.filter((d) => d.id !== id);
  await setStorageItem(DOCUMENTS_KEY, filtered);
}

export async function toggleDocumentActive(id: string): Promise<UserDocument[]> {
  const docs = await loadDocuments();
  const updated = docs.map((d) => (d.id === id ? { ...d, isActiveForContext: !d.isActiveForContext } : d));
  await setStorageItem(DOCUMENTS_KEY, updated);
  return updated;
}

// Chat History
export async function loadChatHistory(): Promise<ChatMessage[]> {
  return await getStorageItem<ChatMessage[]>(CHAT_HISTORY_KEY, []);
}

export async function saveChatHistory(messages: ChatMessage[]): Promise<void> {
  // Retain the last 50 messages to keep storage fast
  const trimmed = messages.slice(-50);
  await setStorageItem(CHAT_HISTORY_KEY, trimmed);
}

export async function clearChatHistory(): Promise<void> {
  await setStorageItem(CHAT_HISTORY_KEY, []);
}
