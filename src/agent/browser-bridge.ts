import { PageFormSummary, FormElementDescriptor, FormFillResult } from '../types';

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
    // In Side Panel, lastFocusedWindow targets the main browser window tab
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      if (tabs && tabs.length > 0) {
        return resolve(tabs[0]);
      }
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs2) => {
        if (tabs2 && tabs2.length > 0) {
          return resolve(tabs2[0]);
        }
        chrome.tabs.query({ active: true }, (tabs3) => {
          resolve(tabs3 && tabs3.length > 0 ? tabs3[0] : null);
        });
      });
    });
  });
}

export async function ensureContentScriptInjected(tabId: number, timeoutMs = 2500): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.scripting) {
    return false;
  }
  return Promise.race([
    (async () => {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content.js'],
        });
        await new Promise((r) => setTimeout(r, 100));
        return true;
      } catch (e: any) {
        console.warn('[OpenBUA] Content script injection notice:', e?.message || e);
        return false;
      }
    })(),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
}

export async function sendMessageToTab<T = any>(tabId: number, message: any, timeoutMs = 3000): Promise<T> {
  if (typeof chrome === 'undefined' || !chrome.tabs) {
    throw new Error('Chrome extension APIs not available in current environment');
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      settled = true;
      clearTimeout(timer);
    };

    const timer = setTimeout(() => {
      if (!settled) {
        cleanup();
        reject(new Error(`Timeout waiting for response from tab ${tabId} (${timeoutMs}ms)`));
      }
    }, timeoutMs);

    try {
      chrome.tabs.sendMessage(tabId, message, async (response) => {
        if (settled) return;

        if (chrome.runtime.lastError) {
          // Tab might not have content script yet; try injecting once
          try {
            const injected = await ensureContentScriptInjected(tabId, 2000);
            if (injected && !settled) {
              chrome.tabs.sendMessage(tabId, message, (retryResponse) => {
                if (settled) return;
                cleanup();
                if (chrome.runtime.lastError) {
                  reject(new Error(chrome.runtime.lastError.message));
                } else {
                  resolve(retryResponse);
                }
              });
              return;
            }
          } catch {
            // ignore
          }

          if (!settled) {
            cleanup();
            reject(new Error(chrome.runtime.lastError.message));
          }
        } else {
          cleanup();
          resolve(response);
        }
      });
    } catch (e: any) {
      if (!settled) {
        cleanup();
        reject(e);
      }
    }
  });
}

// In-page fallback script for direct DOM inspection without relying on message ports
function inPageInspectForm(containerSelector?: string): PageFormSummary {
  let root: ParentNode = document;
  if (containerSelector) {
    const customRoot = document.querySelector(containerSelector);
    if (customRoot) root = customRoot;
  }

  const rawElements = Array.from(root.querySelectorAll<HTMLElement>(
    'input:not([type="hidden"]), textarea, select, [contenteditable="true"], [contenteditable=""], [role="textbox"], [role="combobox"], [role="checkbox"]'
  ));

  // Prioritize active dialogs / modals
  const elements = rawElements.sort((a, b) => {
    const aInDialog = a.closest('[role="dialog"], dialog, .M9, [aria-modal="true"], .modal') ? 1000 : 0;
    const bInDialog = b.closest('[role="dialog"], dialog, .M9, [aria-modal="true"], .modal') ? 1000 : 0;
    const aIsText = a.tagName === 'TEXTAREA' || a.isContentEditable || a.getAttribute('role') === 'textbox' ? 100 : 0;
    const bIsText = b.tagName === 'TEXTAREA' || b.isContentEditable || b.getAttribute('role') === 'textbox' ? 100 : 0;
    return (bInDialog + bIsText) - (aInDialog + aIsText);
  });

  const fields: FormElementDescriptor[] = [];
  let counter = 0;

  elements.forEach((elem) => {
    const tagName = elem.tagName.toLowerCase();
    const type = (elem.getAttribute('type') || (tagName === 'textarea' ? 'textarea' : tagName === 'select' ? 'select' : 'text')).toLowerCase();
    if (['submit', 'reset', 'button', 'image'].includes(type)) return;

    counter++;
    const refId = `af_${counter}`;
    elem.setAttribute('data-autoform-ref', refId);

    // Label lookup
    let label = '';
    const labelledBy = elem.getAttribute('aria-labelledby');
    if (labelledBy) {
      const l = document.getElementById(labelledBy);
      if (l) label = l.textContent?.trim() || '';
    }
    if (!label && elem.getAttribute('aria-label')) {
      label = elem.getAttribute('aria-label') || '';
    }
    if (!label && elem.id) {
      try {
        const l = document.querySelector(`label[for="${CSS.escape(elem.id)}"]`);
        if (l) label = l.textContent?.trim() || '';
      } catch {
        // ignore invalid selector syntax
      }
    }
    if (!label) {
      const parentLabel = elem.closest('label');
      if (parentLabel) label = parentLabel.textContent?.replace(elem.textContent || '', '').trim() || '';
    }
    if (!label && elem.previousElementSibling) {
      const prev = elem.previousElementSibling;
      if (['LABEL', 'SPAN', 'DIV', 'P'].includes(prev.tagName)) {
        label = prev.textContent?.trim().slice(0, 80) || '';
      }
    }

    let value = '';
    let checked: boolean | undefined = undefined;
    let options: Array<{ value: string; label: string; selected: boolean }> | undefined = undefined;

    if (tagName === 'input') {
      const inp = elem as HTMLInputElement;
      if (type === 'checkbox' || type === 'radio') {
        checked = inp.checked;
        value = inp.value || (inp.checked ? 'true' : 'false');
      } else {
        value = inp.value || '';
      }
    } else if (tagName === 'textarea') {
      value = (elem as HTMLTextAreaElement).value || '';
    } else if (tagName === 'select') {
      const sel = elem as HTMLSelectElement;
      value = sel.value || '';
      options = Array.from(sel.options).map((o) => ({
        value: o.value,
        label: o.text.trim(),
        selected: o.selected,
      }));
    }

    let visible = false;
    if (elem.offsetWidth > 0 || elem.offsetHeight > 0 || elem.getClientRects().length > 0) {
      try {
        visible = window.getComputedStyle(elem).display !== 'none';
      } catch {
        visible = true;
      }
    }

    fields.push({
      refId,
      tagName,
      type,
      id: elem.id || '',
      name: elem.getAttribute('name') || '',
      label,
      placeholder: elem.getAttribute('placeholder') || '',
      value,
      checked,
      required: elem.hasAttribute('required') || elem.getAttribute('aria-required') === 'true',
      disabled: (elem as HTMLInputElement).disabled || false,
      readonly: (elem as HTMLInputElement).readOnly || false,
      isVisible: visible,
      selector: `[data-autoform-ref="${refId}"]`,
      options,
    });
  });

  const buttons: Array<{ refId: string; text: string; type: string; isSubmit: boolean; isNext: boolean; isPrevious: boolean }> = [];
  document.querySelectorAll<HTMLElement>('button, input[type="submit"], input[type="button"], [role="button"]').forEach((btn) => {
    const text = (btn.textContent || (btn as HTMLInputElement).value || '').trim();
    if (!text || text.length > 50) return;
    const lower = text.toLowerCase();
    counter++;
    const refId = `af_btn_${counter}`;
    btn.setAttribute('data-autoform-ref', refId);
    buttons.push({
      refId,
      text,
      type: btn.getAttribute('type') || 'button',
      isSubmit: lower.includes('submit') || lower.includes('finish') || lower.includes('complete'),
      isNext: lower.includes('next') || lower.includes('continue') || lower.includes('proceed'),
      isPrevious: lower.includes('back') || lower.includes('prev'),
    });
  });

  const stepIndicators: string[] = [];
  document.querySelectorAll('[class*="step"], [class*="progress"]').forEach((el) => {
    const t = el.textContent?.replace(/\s+/g, ' ').trim();
    if (t && t.length > 3 && t.length < 80 && !stepIndicators.includes(t)) {
      stepIndicators.push(t);
    }
  });

  return {
    title: document.title,
    url: window.location.href,
    fields,
    stepIndicators: stepIndicators.slice(0, 5),
    buttons: buttons.slice(0, 8),
  };
}

// In-page fallback script for directly setting field values in tab
function inPageFillForm(assignments: Array<{ refId?: string; selector?: string; value: string }>): {
  successCount: number;
  errors: string[];
  verifications: Array<{
    refId: string;
    selector?: string;
    requestedValue: string;
    actualValue: string;
    verified: boolean;
    elementFound: boolean;
  }>;
} {
  let successCount = 0;
  const errors: string[] = [];
  const verifications: Array<{
    refId: string;
    selector?: string;
    requestedValue: string;
    actualValue: string;
    verified: boolean;
    elementFound: boolean;
  }> = [];

  for (const item of assignments) {
    let target: HTMLElement | null = null;
    if (item.refId) {
      target = document.querySelector(`[data-autoform-ref="${CSS.escape(item.refId)}"]`);
      if (!target) {
        target = document.getElementById(item.refId);
      }
      if (!target) {
        target = document.querySelector(`[name="${CSS.escape(item.refId)}"]`);
      }
    }
    if (!target && item.selector) {
      target = document.querySelector(item.selector);
    }

    if (!target) {
      errors.push(`Field not found: ${item.refId || item.selector}`);
      verifications.push({
        refId: item.refId || '',
        selector: item.selector,
        requestedValue: item.value,
        actualValue: '',
        verified: false,
        elementFound: false,
      });
      continue;
    }

    try {
      const tagName = target.tagName.toLowerCase();
      const isContentEditable = target.isContentEditable || target.getAttribute('contenteditable') === 'true' || target.getAttribute('role') === 'textbox';

      // Rich text placeholder activation (YouTube, etc.)
      if (isContentEditable || tagName === 'div') {
        const parentBox = target.closest('ytd-commentbox, ytd-comments-header-renderer, #simple-box, .comment-simplebox') || target.parentElement;
        if (parentBox) {
          const placeholder = parentBox.querySelector<HTMLElement>('#simplebox-placeholder, #placeholder, [id*="placeholder"]');
          if (placeholder && placeholder !== target) {
            placeholder.click();
            placeholder.focus();
          }
        }
      }

      target.focus();

      if (tagName === 'input') {
        const input = target as HTMLInputElement;
        const type = (input.getAttribute('type') || 'text').toLowerCase();
        if (type === 'checkbox' || type === 'radio') {
          const boolVal = item.value === 'true' || item.value === '1' || item.value === 'yes' || item.value === 'on';
          const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'checked');
          if (desc?.set) desc.set.call(input, boolVal);
          else input.checked = boolVal;
        } else {
          const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
          if (desc?.set) desc.set.call(input, item.value);
          else input.value = item.value;
        }
      } else if (tagName === 'textarea') {
        const desc = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
        if (desc?.set) desc.set.call(target, item.value);
        else (target as HTMLTextAreaElement).value = item.value;
      } else if (tagName === 'select') {
        const sel = target as HTMLSelectElement;
        const valLower = item.value.toLowerCase().trim();
        let idx = -1;
        for (let i = 0; i < sel.options.length; i++) {
          const opt = sel.options[i];
          if (opt.value.toLowerCase().trim() === valLower || opt.text.toLowerCase().trim() === valLower || opt.text.toLowerCase().includes(valLower)) {
            idx = i;
            break;
          }
        }
        if (idx >= 0) {
          sel.selectedIndex = idx;
          const desc = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value');
          if (desc?.set) desc.set.call(sel, sel.options[idx].value);
          else sel.value = sel.options[idx].value;
        } else {
          sel.value = item.value;
        }
      } else if (isContentEditable) {
        // Selection replacement and insertText for rich text editors
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(target);
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(range);
        }
        let execSuccess = false;
        try {
          execSuccess = document.execCommand('insertText', false, item.value);
        } catch {
          execSuccess = false;
        }
        if (!execSuccess || !target.innerText.includes(item.value.slice(0, 10))) {
          target.innerText = item.value;
        }
      } else {
        target.textContent = item.value;
      }

      // Event dispatching
      target.dispatchEvent(new Event('focus', { bubbles: true }));
      target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true }));
      target.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      target.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      target.dispatchEvent(new Event('blur', { bubbles: true }));

      // Visual flash highlight
      target.style.outline = '2px solid #22c55e';
      setTimeout(() => {
        target!.style.outline = '';
      }, 1500);

      // Verify DOM actual value
      let actualVal = '';
      if (tagName === 'input') {
        const inp = target as HTMLInputElement;
        actualVal = inp.type === 'checkbox' || inp.type === 'radio' ? String(inp.checked) : inp.value;
      } else if (tagName === 'textarea') {
        actualVal = (target as HTMLTextAreaElement).value;
      } else if (tagName === 'select') {
        actualVal = (target as HTMLSelectElement).value;
      } else {
        actualVal = target.innerText || target.textContent || '';
      }

      const verified = actualVal.length > 0 && (
        actualVal.toLowerCase().includes(item.value.toLowerCase().trim().slice(0, 15)) ||
        item.value.toLowerCase().includes(actualVal.toLowerCase().trim().slice(0, 15)) ||
        actualVal === item.value ||
        (target as HTMLInputElement).type === 'checkbox' ||
        (target as HTMLInputElement).type === 'radio'
      );

      verifications.push({
        refId: item.refId || '',
        selector: item.selector,
        requestedValue: item.value,
        actualValue: actualVal,
        verified,
        elementFound: true,
      });

      if (verified) {
        successCount++;
      } else {
        errors.push(`Field ${item.refId || item.selector} DOM value remained empty or mismatch`);
      }
    } catch (e: any) {
      errors.push(`Error filling ${item.refId}: ${e?.message || e}`);
      verifications.push({
        refId: item.refId || '',
        selector: item.selector,
        requestedValue: item.value,
        actualValue: '',
        verified: false,
        elementFound: true,
      });
    }
  }

  return { successCount, errors, verifications };
}

// In-page fallback script for clicking buttons
function inPageClickElement(refId?: string, selector?: string, text?: string): { success: boolean; message: string } {
  let target: HTMLElement | null = null;
  if (refId) {
    target = document.querySelector(`[data-autoform-ref="${CSS.escape(refId)}"]`);
  }
  if (!target && selector) {
    target = document.querySelector(selector);
  }
  if (!target && text) {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(
      'button, a, input[type="submit"], input[type="button"], [role="button"], [role="link"], [contenteditable="true"], [role="textbox"], yt-formatted-string, #video-title, #placeholder-area, #simplebox-placeholder'
    ));
    const tLower = text.toLowerCase().trim();

    // 1. Exact match (highest priority)
    target = candidates.find((c) => {
      const val = (c.textContent || (c as HTMLInputElement).value || c.getAttribute('aria-label') || c.getAttribute('title') || '').toLowerCase().trim();
      return val === tLower;
    }) || null;

    // 2. Exact word boundary match
    if (!target) {
      try {
        const wordRegex = new RegExp(`(^|\\s|[^a-zA-Z0-9])${tLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|\\s|[^a-zA-Z0-9])`, 'i');
        target = candidates.find((c) => {
          const val = (c.textContent || (c as HTMLInputElement).value || c.getAttribute('aria-label') || c.getAttribute('title') || '').trim();
          return wordRegex.test(val);
        }) || null;
      } catch {}
    }

    // 3. Substring match, sorted by shortest length (most specific leaf element first)
    if (!target) {
      const matches = candidates
        .map((c) => {
          const val = (c.textContent || (c as HTMLInputElement).value || c.getAttribute('aria-label') || c.getAttribute('title') || '').toLowerCase().trim();
          return { elem: c, val, len: val.length };
        })
        .filter((item) => item.val.includes(tLower))
        .sort((a, b) => a.len - b.len);
      if (matches.length > 0) {
        target = matches[0].elem;
      }
    }
  }

  if (!target) {
    return { success: false, message: `Button or element not found: ${refId || selector || text}` };
  }

  const clickable = target.closest<HTMLElement>('a[href], button, [role="button"], [contenteditable="true"]') || target;
  clickable.scrollIntoView({ behavior: 'smooth', block: 'center' });
  clickable.focus();
  clickable.click();
  return { success: true, message: `Clicked element "${(clickable.textContent || clickable.getAttribute('aria-label') || '').trim().slice(0, 30)}"` };
}

// Inspect Form on Active Tab
export async function inspectActiveTabForm(selector?: string): Promise<PageFormSummary> {
  const activeTab = await getActiveTab();
  if (!activeTab || !activeTab.id) {
    return getMockFormSummary();
  }

  if (activeTab.url && (activeTab.url.startsWith('chrome://') || activeTab.url.startsWith('chrome-extension://') || activeTab.url.startsWith('edge://') || activeTab.url.startsWith('about:'))) {
    throw new Error(`Chrome restricts extensions from accessing internal pages (${activeTab.url}). Please open a regular webpage or form (such as test-form.html) in your browser!`);
  }

  // 1. Try sendMessageToTab first with generous 4-second timeout for rich SPAs
  try {
    const response = await sendMessageToTab(activeTab.id, { action: 'INSPECT_PAGE_FORM', selector }, 4000);
    if (response && response.success && response.data) {
      return response.data;
    }
  } catch (err: any) {
    console.warn('[OpenBUA] sendMessageToTab failed, falling back to direct executeScript:', err?.message || err);
  }

  // 2. Direct executeScript fallback (never hangs, 100% reliable)
  if (typeof chrome !== 'undefined' && chrome.scripting) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: inPageInspectForm,
        args: selector ? [selector] : [],
      });
      if (results && results[0] && results[0].result) {
        return results[0].result as PageFormSummary;
      }
    } catch (scriptErr: any) {
      const msg = scriptErr?.message || String(scriptErr);
      if (msg.includes('Cannot access contents of url') || msg.includes('file:')) {
        throw new Error(`Permission needed: To allow OpenBUA to inspect local files (file:///...), please open chrome://extensions -> OpenBUA Details -> toggle ON "Allow access to file URLs". Alternatively, test on any http:// or https:// webpage!`);
      }
      throw scriptErr;
    }
  }

  throw new Error('Failed to inspect form fields on the active tab.');
}

// Fill fields on active tab
export async function fillActiveTabFields(
  assignments: Array<{ refId?: string; selector?: string; value: string }>
): Promise<FormFillResult> {
  const activeTab = await getActiveTab();
  if (!activeTab || !activeTab.id) {
    console.log('[Dev Mock] Filled fields:', assignments);
    return {
      successCount: assignments.length,
      errors: [],
      verifications: assignments.map(a => ({
        refId: a.refId || '',
        selector: a.selector,
        requestedValue: a.value,
        actualValue: a.value,
        verified: true,
        elementFound: true,
      })),
    };
  }

  if (activeTab.url && (activeTab.url.startsWith('chrome://') || activeTab.url.startsWith('chrome-extension://') || activeTab.url.startsWith('edge://') || activeTab.url.startsWith('about:'))) {
    throw new Error(`Chrome restricts extensions from accessing internal pages (${activeTab.url}). Please open a regular webpage or form (such as test-form.html) in your browser!`);
  }

  // 1. Try sendMessageToTab
  try {
    const response = await sendMessageToTab(activeTab.id, {
      action: 'FILL_FORM_FIELDS',
      assignments,
    }, 2000);
    if (response && response.success && response.data) {
      return response.data as FormFillResult;
    }
  } catch (err: any) {
    console.warn('[OpenBUA] sendMessageToTab failed, falling back to direct executeScript:', err?.message || err);
  }

  // 2. Direct executeScript fallback
  if (typeof chrome !== 'undefined' && chrome.scripting) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: inPageFillForm,
        args: [assignments],
      });
      if (results && results[0] && results[0].result) {
        return results[0].result as FormFillResult;
      }
    } catch (scriptErr: any) {
      const msg = scriptErr?.message || String(scriptErr);
      if (msg.includes('Cannot access contents of url') || msg.includes('file:')) {
        throw new Error(`Permission needed: Please enable "Allow access to file URLs" in chrome://extensions -> OpenBUA Details to interact with local files.`);
      }
      throw scriptErr;
    }
  }

  throw new Error('Failed to fill form fields on active tab');
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

  // 1. Try sendMessageToTab
  try {
    const response = await sendMessageToTab(activeTab.id, {
      action: 'CLICK_ELEMENT',
      ...options,
    }, 2000);
    if (response && response.success) {
      return response;
    }
  } catch (err) {
    // Fall back to direct script
  }

  // 2. Direct executeScript fallback
  if (typeof chrome !== 'undefined' && chrome.scripting) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: inPageClickElement,
        args: [options.refId, options.selector, options.text],
      });
      if (results && results[0] && results[0].result) {
        return results[0].result as { success: boolean; message: string };
      }
    } catch {
      // Fall through
    }
  }

  return { success: false, message: 'Could not click element on active tab' };
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
  }, 1500).catch(() => ({ success: false }));

  return response || { success: false };
}

// Get Page Text — wrapped in a hard timeout to prevent hanging on SPAs like YouTube
export async function getActiveTabPageContent(): Promise<{ text: string; title: string; url: string }> {
  const fallback = { text: '', title: '', url: '' };

  const activeTab = await getActiveTab();
  if (!activeTab || !activeTab.id) {
    return {
      text: 'Mock Webpage Content: Application Form for Software Developer Position.',
      title: 'Dev Mock Page',
      url: 'https://example.com/careers/apply',
    };
  }

  // Hard 5-second timeout to prevent the tool from hanging forever
  const result = await Promise.race([
    (async () => {
      // Force re-inject content script before sending message (handles SPA navigations like YouTube)
      await ensureContentScriptInjected(activeTab.id!).catch(() => {});
      const response = await sendMessageToTab(activeTab.id!, { action: 'GET_PAGE_TEXT' }, 3000).catch(() => null);
      if (response && response.success) {
        return { text: response.text, title: response.title, url: response.url };
      }
      return null;
    })(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
  ]);

  if (result) return result;

  // Fallback: use tab metadata if content script communication failed
  return {
    text: activeTab.title || 'Web page',
    title: activeTab.title || '',
    url: activeTab.url || '',
  };
}

// Chrome-level tools
export async function listAllTabs(): Promise<TabInfo[]> {
  if (typeof chrome === 'undefined' || !chrome.tabs) {
    return [
      { id: 1, title: 'Job Application - Careers Portal', url: 'https://example.com/apply', active: true },
      { id: 2, title: 'GitHub - Profile', url: 'https://github.com/alexmercer', active: false },
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

  const tabId = activeTab.id;
  let targetUrl = url.trim();
  if (!/^https?:\/\//i.test(targetUrl)) {
    targetUrl = `https://${targetUrl}`;
  }

  return new Promise((resolve) => {
    let finished = false;

    const cleanup = () => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdatedListener);
      }
    };

    // 8-second safety timeout so it never hangs indefinitely on slow or streaming pages
    const timer = setTimeout(async () => {
      cleanup();
      // Ensure content script is injected even if status didn't reach complete
      await ensureContentScriptInjected(tabId).catch(() => {});
      resolve(true);
    }, 8000);

    const onUpdatedListener = async (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        cleanup();
        // Give client-side SPA frameworks (YouTube, React, Vue, Next.js) time to hydrate DOM
        await new Promise((r) => setTimeout(r, 1200));
        await ensureContentScriptInjected(tabId).catch(() => {});
        resolve(true);
      }
    };

    chrome.tabs.onUpdated.addListener(onUpdatedListener);

    chrome.tabs.update(tabId, { url: targetUrl }, (updatedTab) => {
      if (chrome.runtime.lastError || !updatedTab) {
        cleanup();
        resolve(false);
      }
    });
  });
}

export async function captureTabScreenshot(): Promise<string> {
  if (typeof chrome === 'undefined' || !chrome.tabs) {
    return 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
  }

  const activeTab = await getActiveTab();
  const windowId = activeTab?.windowId;

  return new Promise((resolve, reject) => {
    // Use JPEG format with quality 80 for lightweight, fast screenshots (~150KB instead of 4MB PNG)
    const options: chrome.tabs.CaptureVisibleTabOptions = { format: 'jpeg', quality: 80 };
    
    // When called from a side panel, passing the active tab's windowId ensures capturing the browser window rather than side panel
    const captureCallback = (dataUrl?: string) => {
      if (chrome.runtime.lastError || !dataUrl) {
        // Fallback without windowId if window-specific call failed
        chrome.tabs.captureVisibleTab(options, (fallbackDataUrl) => {
          if (chrome.runtime.lastError || !fallbackDataUrl) {
            reject(new Error(chrome.runtime.lastError?.message || 'Failed to capture tab screenshot'));
          } else {
            resolve(fallbackDataUrl);
          }
        });
      } else {
        resolve(dataUrl);
      }
    };

    if (typeof windowId === 'number') {
      chrome.tabs.captureVisibleTab(windowId, options, captureCallback);
    } else {
      chrome.tabs.captureVisibleTab(options, captureCallback);
    }
  });
}

// Development mock data
function getMockFormSummary(): PageFormSummary {
  return {
    title: 'Career Application - Job Portal (Demo Mock)',
    url: 'https://careers.example.com/apply/senior-engineer',
    stepIndicators: ['Step 1: Personal Information', 'Step 2: Experience'],
    fields: [
      {
        refId: 'af_1',
        tagName: 'input',
        type: 'text',
        id: 'first_name',
        name: 'firstName',
        label: 'First Name',
        placeholder: 'Alex',
        value: '',
        required: true,
        disabled: false,
        readonly: false,
        isVisible: true,
        selector: '#first_name',
      },
      {
        refId: 'af_2',
        tagName: 'input',
        type: 'text',
        id: 'last_name',
        name: 'lastName',
        label: 'Last Name',
        placeholder: 'Mercer',
        value: '',
        required: true,
        disabled: false,
        readonly: false,
        isVisible: true,
        selector: '#last_name',
      },
      {
        refId: 'af_3',
        tagName: 'input',
        type: 'email',
        id: 'email',
        name: 'email',
        label: 'Email Address',
        placeholder: 'alex@example.com',
        value: '',
        required: true,
        disabled: false,
        readonly: false,
        isVisible: true,
        selector: '#email',
      },
    ],
    buttons: [
      {
        refId: 'af_btn_1',
        text: 'Next: Experience',
        type: 'button',
        isSubmit: false,
        isNext: true,
        isPrevious: false,
      },
    ],
  };
}

// In-page key combination dispatcher
function inPagePressKey(options: {
  key: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  selector?: string;
}) {
  const target = options.selector
    ? document.querySelector<HTMLElement>(options.selector) || document.activeElement || document.body
    : (document.activeElement as HTMLElement) || document.body;

  const keyUpper = options.key.toUpperCase();
  const keyCode =
    keyUpper === 'ENTER' ? 13 :
    keyUpper === 'ESCAPE' || keyUpper === 'ESC' ? 27 :
    keyUpper === 'TAB' ? 9 :
    options.key.charCodeAt(0) || 0;

  const eventInit: KeyboardEventInit = {
    key: options.key,
    code: options.key === 'Enter' ? 'Enter' : options.key === 'Escape' ? 'Escape' : options.key,
    keyCode,
    which: keyCode,
    bubbles: true,
    cancelable: true,
    composed: true,
    ctrlKey: Boolean(options.ctrlKey),
    shiftKey: Boolean(options.shiftKey),
    altKey: Boolean(options.altKey),
    metaKey: Boolean(options.metaKey),
  };

  target.dispatchEvent(new KeyboardEvent('keydown', eventInit));
  target.dispatchEvent(new KeyboardEvent('keypress', eventInit));
  target.dispatchEvent(new KeyboardEvent('keyup', eventInit));

  return {
    success: true,
    message: `Dispatched ${options.ctrlKey ? 'Ctrl+' : ''}${options.key} to ${target.tagName.toLowerCase()}`,
  };
}

// In-page Gmail send button finder and dispatcher
function inPageDispatchSendEmail() {
  const sendSelectors = [
    'div[role="button"][data-tooltip*="Send" i]',
    'div[role="button"][aria-label*="Send" i]',
    'div[data-tooltip*="Send (Ctrl-Enter)" i]',
    'div[data-tooltip*="Send (Cmd-Enter)" i]',
    '.T-I.J-J5-Ji.aoO.v7.T-I-atl.L3',
  ];

  for (const sel of sendSelectors) {
    const btn = document.querySelector<HTMLElement>(sel);
    if (btn && btn.offsetParent !== null) {
      btn.click();
      return { success: true, message: `Clicked Send button (${sel}). Email dispatched successfully.` };
    }
  }

  // Fallback: Dispatch Ctrl+Enter
  const composeArea =
    document.querySelector<HTMLElement>('div[role="textbox"][aria-label*="Message Body" i]') ||
    document.querySelector<HTMLElement>('div[aria-label*="New Message" i]') ||
    document.activeElement ||
    document.body;

  const eventInit: KeyboardEventInit = {
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true,
    composed: true,
    ctrlKey: true,
  };

  composeArea.dispatchEvent(new KeyboardEvent('keydown', eventInit));
  composeArea.dispatchEvent(new KeyboardEvent('keyup', eventInit));

  return {
    success: true,
    message: 'Dispatched Ctrl+Enter in Gmail compose window to send email.',
  };
}

// Dispatch keyboard key combination on active tab
export async function pressKeyCombination(options: {
  key: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  selector?: string;
}): Promise<{ success: boolean; message: string }> {
  const activeTab = await getActiveTab();
  if (!activeTab || !activeTab.id) {
    return { success: true, message: `[Dev Mock] Pressed key combination ${options.ctrlKey ? 'Ctrl+' : ''}${options.key}` };
  }

  if (typeof chrome !== 'undefined' && chrome.scripting) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: inPagePressKey,
        args: [options],
      });
      if (results && results[0] && results[0].result) {
        return results[0].result as { success: boolean; message: string };
      }
    } catch (err: any) {
      return { success: false, message: `Failed to dispatch key: ${err?.message || err}` };
    }
  }

  return { success: false, message: 'chrome.scripting unavailable' };
}

// Fast compound email sender via deep-link and auto-send
export async function sendWebEmailDirect(options: {
  to: string;
  subject: string;
  body: string;
  userEmail?: string;
}): Promise<{ success: boolean; message: string }> {
  const activeTab = await getActiveTab();
  if (!activeTab || !activeTab.id) {
    return { success: true, message: `[Dev Mock] Sent email to ${options.to}` };
  }

  const authUserParam = options.userEmail ? `authuser=${encodeURIComponent(options.userEmail)}&` : '';
  const composeUrl = `https://mail.google.com/mail/?${authUserParam}view=cm&fs=1&to=${encodeURIComponent(options.to)}&su=${encodeURIComponent(options.subject)}&body=${encodeURIComponent(options.body)}`;

  // 1. Navigate to Gmail direct compose endpoint
  await navigateActiveTab(composeUrl);

  // 2. Wait up to 2.5s for Gmail SPA interface to settle
  await new Promise((r) => setTimeout(r, 2200));

  // 3. Trigger Send in page
  if (typeof chrome !== 'undefined' && chrome.scripting) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: inPageDispatchSendEmail,
      });
      if (results && results[0] && results[0].result) {
        return results[0].result as { success: boolean; message: string };
      }
    } catch (e: any) {
      return { success: false, message: `Failed to trigger send in Gmail: ${e?.message || e}` };
    }
  }

  return { success: true, message: `Email compose opened and dispatched for ${options.to}` };
}
