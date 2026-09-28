// Browser bridge to communicate with Chrome Extension APIs and content script

import { PageFormSummary } from '../types';

export interface TabInfo {
  id: number;
  title: string;
  url: string;
  active: boolean;
  favIconUrl?: string;
}

export async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  if (typeof chrome === 'undefined' || !chrome.tabs) {
    return null;
  }
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs && tabs.length > 0 ? tabs[0] : null);
    });
  });
}

export async function ensureContentScriptInjected(tabId: number): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.scripting) {
    return false;
  }
  try {
    // Try pinging first
    const pong = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { action: 'PING' }, (resp) => {
        if (chrome.runtime.lastError || !resp) {
          resolve(false);
        } else {
          resolve(true);
        }
      });
    });

    if (pong) return true;

    // Inject content script if not present
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
    // Wait briefly for execution
    await new Promise((r) => setTimeout(r, 100));
    return true;
  } catch (e) {
    console.warn('[AutoForm AI] Failed to inject content script:', e);
    return false;
  }
}

export async function sendMessageToTab<T = any>(tabId: number, message: any): Promise<T> {
  if (typeof chrome === 'undefined' || !chrome.tabs) {
    throw new Error('Chrome extension APIs not available in current environment');
  }

  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, async (response) => {
      if (chrome.runtime.lastError) {
        // Try injecting content script and retry once
        const injected = await ensureContentScriptInjected(tabId);
        if (injected) {
          chrome.tabs.sendMessage(tabId, message, (retryResponse) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(retryResponse);
            }
          });
        } else {
          reject(new Error(chrome.runtime.lastError.message));
        }
      } else {
        resolve(response);
      }
    });
  });
}

// Inspect Form on Active Tab
export async function inspectActiveTabForm(): Promise<PageFormSummary> {
  const activeTab = await getActiveTab();
  if (!activeTab || !activeTab.id) {
    // Dev mock fallback if outside extension environment
    return getMockFormSummary();
  }

  try {
    const response = await sendMessageToTab(activeTab.id, { action: 'INSPECT_PAGE_FORM' });
    if (response && response.success && response.data) {
      return response.data;
    }
    throw new Error(response?.error || 'Failed to inspect form');
  } catch (err: any) {
    console.error('Error in inspectActiveTabForm:', err);
    throw err;
  }
}

// Fill fields on active tab
export async function fillActiveTabFields(
  assignments: Array<{ refId?: string; selector?: string; value: string }>
): Promise<{ successCount: number; errors: string[] }> {
  const activeTab = await getActiveTab();
  if (!activeTab || !activeTab.id) {
    console.log('[Dev Mock] Filled fields:', assignments);
    return { successCount: assignments.length, errors: [] };
  }

  const response = await sendMessageToTab(activeTab.id, {
    action: 'FILL_FORM_FIELDS',
    assignments,
  });

  if (response && response.success && response.data) {
    return response.data;
  }
  throw new Error(response?.error || 'Failed to fill form fields');
}

// Click element on active tab
export async function clickActiveTabElement(options: {
  refId?: string;
  selector?: string;
  text?: string;
}): Promise<{ success: boolean; message: string }> {
  const activeTab = await getActiveTab();
  if (!activeTab || !activeTab.id) {
    return { success: true, message: `[Dev Mock] Clicked element: ${JSON.stringify(options)}` };
  }

  const response = await sendMessageToTab(activeTab.id, {
    action: 'CLICK_ELEMENT',
    ...options,
  });

  return response || { success: false, message: 'No response from tab' };
}

// Scroll page
export async function scrollActiveTab(
  direction: 'up' | 'down' | 'top' | 'bottom' | 'element',
  selector?: string
): Promise<{ success: boolean }> {
  const activeTab = await getActiveTab();
  if (!activeTab || !activeTab.id) {
    return { success: true };
  }

  const response = await sendMessageToTab(activeTab.id, {
    action: 'SCROLL_PAGE',
    direction,
    selector,
  });

  return response || { success: false };
}

// Get Page Text
export async function getActiveTabPageContent(): Promise<{ text: string; title: string; url: string }> {
  const activeTab = await getActiveTab();
  if (!activeTab || !activeTab.id) {
    return {
      text: 'Mock Webpage Content: Application Form for Software Developer Position.',
      title: 'Dev Mock Page',
      url: 'https://example.com/careers/apply',
    };
  }

  const response = await sendMessageToTab(activeTab.id, { action: 'GET_PAGE_TEXT' });
  if (response && response.success) {
    return { text: response.text, title: response.title, url: response.url };
  }
  throw new Error(response?.error || 'Failed to get page text');
}

// Chrome-level tools
export async function listAllTabs(): Promise<TabInfo[]> {
  if (typeof chrome === 'undefined' || !chrome.tabs) {
    return [
      { id: 1, title: 'Job Application - Careers Portal', url: 'https://example.com/apply', active: true },
      { id: 2, title: 'GitHub - Profile', url: 'https://github.com/alexmercer', active: false },
      { id: 3, title: 'LinkedIn', url: 'https://linkedin.com', active: false },
    ];
  }

  return new Promise((resolve) => {
    chrome.tabs.query({ currentWindow: true }, (tabs) => {
      const list = (tabs || []).map((t) => ({
        id: t.id || 0,
        title: t.title || 'Untitled Tab',
        url: t.url || '',
        active: Boolean(t.active),
        favIconUrl: t.favIconUrl,
      }));
      resolve(list);
    });
  });
}

export async function switchTab(tabId: number): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.tabs) {
    return true;
  }
  return new Promise((resolve) => {
    chrome.tabs.update(tabId, { active: true }, () => {
      resolve(!chrome.runtime.lastError);
    });
  });
}

export async function createNewTab(url: string): Promise<number | null> {
  if (typeof chrome === 'undefined' || !chrome.tabs) {
    return null;
  }
  return new Promise((resolve) => {
    chrome.tabs.create({ url }, (tab) => {
      resolve(tab?.id || null);
    });
  });
}

export async function closeBrowserTab(tabId: number): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.tabs) {
    return true;
  }
  return new Promise((resolve) => {
    chrome.tabs.remove(tabId, () => {
      resolve(!chrome.runtime.lastError);
    });
  });
}

export async function navigateActiveTab(url: string): Promise<boolean> {
  const activeTab = await getActiveTab();
  if (!activeTab || !activeTab.id || typeof chrome === 'undefined' || !chrome.tabs) {
    return true;
  }
  return new Promise((resolve) => {
    chrome.tabs.update(activeTab.id!, { url }, () => {
      resolve(!chrome.runtime.lastError);
    });
  });
}

export async function captureTabScreenshot(): Promise<string> {
  if (typeof chrome === 'undefined' || !chrome.tabs) {
    // Return empty mock PNG
    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  }

  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab({ format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(dataUrl);
      }
    });
  });
}

// Development mock data when previewing outside extension
function getMockFormSummary(): PageFormSummary {
  return {
    title: 'Career Application - Job Portal (Demo Mock)',
    url: 'https://careers.example.com/apply/senior-engineer',
    stepIndicators: ['Step 1: Personal Information', 'Step 2: Experience', 'Step 3: Review & Submit'],
    fields: [
      {
        refId: 'af_1',
        tagName: 'input',
        type: 'text',
        id: 'full_name',
        name: 'full_name',
        label: 'Full Name',
        placeholder: 'e.g. John Doe',
        value: '',
        required: true,
        disabled: false,
        readonly: false,
        isVisible: true,
        selector: '#full_name',
      },
      {
        refId: 'af_2',
        tagName: 'input',
        type: 'email',
        id: 'email_address',
        name: 'email',
        label: 'Email Address',
        placeholder: 'name@example.com',
        value: '',
        required: true,
        disabled: false,
        readonly: false,
        isVisible: true,
        selector: '#email_address',
      },
      {
        refId: 'af_3',
        tagName: 'input',
        type: 'tel',
        id: 'phone_number',
        name: 'phone',
        label: 'Phone Number',
        placeholder: '+1 (555) 000-0000',
        value: '',
        required: false,
        disabled: false,
        readonly: false,
        isVisible: true,
        selector: '#phone_number',
      },
      {
        refId: 'af_4',
        tagName: 'input',
        type: 'text',
        id: 'city',
        name: 'city',
        label: 'City',
        placeholder: 'Seattle',
        value: '',
        required: true,
        disabled: false,
        readonly: false,
        isVisible: true,
        selector: '#city',
      },
      {
        refId: 'af_5',
        tagName: 'select',
        type: 'select',
        id: 'experience_level',
        name: 'experience_level',
        label: 'Years of Experience',
        placeholder: '',
        value: '',
        required: true,
        disabled: false,
        readonly: false,
        isVisible: true,
        selector: '#experience_level',
        options: [
          { value: '', label: 'Select experience...', selected: true },
          { value: 'entry', label: '0-2 years', selected: false },
          { value: 'mid', label: '3-5 years', selected: false },
          { value: 'senior', label: '6+ years', selected: false },
        ],
      },
      {
        refId: 'af_6',
        tagName: 'textarea',
        type: 'textarea',
        id: 'cover_summary',
        name: 'summary',
        label: 'Professional Summary',
        placeholder: 'Briefly describe your qualifications...',
        value: '',
        required: false,
        disabled: false,
        readonly: false,
        isVisible: true,
        selector: '#cover_summary',
      },
    ],
    buttons: [
      {
        refId: 'af_btn_1',
        text: 'Next Step: Experience',
        type: 'button',
        isSubmit: false,
        isNext: true,
        isPrevious: false,
      },
    ],
  };
}
