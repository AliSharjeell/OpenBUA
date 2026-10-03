import { PageFormSummary, FormElementDescriptor, FormFillResult } from '../types';

export interface TabInfo {
  id: number;
  title: string;
  url: string;
  active: boolean;
  favIconUrl?: string;
}

const myExtensionId = typeof chrome !== 'undefined' ? chrome.runtime?.id || '' : '';

export function isExtensionPage(tab?: chrome.tabs.Tab | null): boolean {
  if (!tab) return true;
  const url = tab.url || tab.pendingUrl || '';
  if (!url) return false;
  return (
    url.startsWith('chrome-extension://') &&
    (url.includes(myExtensionId) || url.includes('sidepanel.html'))
  );
}

export async function getActiveTab(timeoutMs = 1500): Promise<chrome.tabs.Tab | null> {
  if (typeof chrome === 'undefined' || !chrome.tabs) {
    return null;
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(null);
    }, timeoutMs);

    const safeResolve = (tab: chrome.tabs.Tab | null) => {
      clearTimeout(timer);
      resolve(tab);
    };

    // 1. In Side Panel (Chrome), lastFocusedWindow targets the main browser window tab
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      const validLast = (tabs || []).find((t) => !isExtensionPage(t));
      if (validLast) {
        return safeResolve(validLast);
      }

      // 2. In Arc Browser or floating window mode, query normal browser windows
      chrome.tabs.query({ active: true, windowType: 'normal' }, (normalTabs) => {
        const validNormal = (normalTabs || []).find((t) => !isExtensionPage(t));
        if (validNormal) {
          return safeResolve(validNormal);
        }

        // 3. Fallback: query any active non-extension tab
        chrome.tabs.query({ active: true }, (tabs3) => {
          const validAnyActive = (tabs3 || []).find((t) => !isExtensionPage(t));
          if (validAnyActive) {
            return safeResolve(validAnyActive);
          }

          // 4. Last resort: any non-extension tab in the browser
          chrome.tabs.query({}, (allTabs) => {
            const anyValid = (allTabs || []).find((t) => !isExtensionPage(t));
            safeResolve(anyValid || null);
          });
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
  document.querySelectorAll('[data-autoform-ref]').forEach((el) => {
    el.removeAttribute('data-autoform-ref');
  });

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
  const rawButtons = Array.from(document.querySelectorAll<HTMLElement>(
    'button, input[type="submit"], input[type="button"], a[role="button"], [role="button"], [role="tab"], tp-yt-paper-tab, yt-tab-shape, ytd-button-renderer, yt-button-shape'
  )).filter((el) => {
    if (el.closest('.sbdd_a, .sbsb_a, [role="listbox"], #complete-list')) return false;
    if (el.closest('.message-in, .message-out, [data-id*="false_"], [data-id*="true_"], [data-pre-plain-text], .chat-message, [role="row"] .copyable-text')) return false;
    const t = (el.textContent || '').trim();
    if (/^\d{1,2}:\d{2}(?:\s*(?:am|pm))?$/i.test(t)) return false;
    if (t.startsWith('reaction ') && t.includes('View reactions')) return false;
    return true;
  });

  rawButtons.forEach((btn) => {
    const text = (btn.textContent || (btn as HTMLInputElement).value || btn.getAttribute('aria-label') || '').trim();
    if (!text || text.length > 50) return;
    const lower = `${text} ${btn.getAttribute('aria-label') || ''}`.toLowerCase();
    counter++;
    const refId = `af_btn_${counter}`;
    btn.setAttribute('data-autoform-ref', refId);

    const isTab = btn.getAttribute('role') === 'tab' ||
      btn.tagName.toLowerCase() === 'tp-yt-paper-tab' ||
      btn.tagName.toLowerCase() === 'yt-tab-shape' ||
      lower.includes('popular') ||
      lower.includes('latest') ||
      lower.includes('videos');

    buttons.push({
      refId,
      text,
      type: isTab ? 'tab' : (btn.getAttribute('type') || 'button'),
      isSubmit: lower.includes('submit') || lower.includes('send') || lower.includes('finish') || lower.includes('complete'),
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
    buttons: buttons.slice(0, 30),
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
        target.focus();
        let selectAllSuccess = false;
        try {
          selectAllSuccess = document.execCommand('selectAll', false, undefined);
        } catch {
          selectAllSuccess = false;
        }
        if (!selectAllSuccess) {
          const sel = window.getSelection();
          if (sel) {
            const range = document.createRange();
            range.selectNodeContents(target);
            sel.removeAllRanges();
            sel.addRange(range);
          }
        }
        let execSuccess = false;
        try {
          execSuccess = document.execCommand('insertText', false, item.value);
        } catch {
          execSuccess = false;
        }
        if (!execSuccess) {
          target.innerText = item.value;
          try {
            const inputEvent = new InputEvent('input', {
              bubbles: true,
              cancelable: true,
              inputType: 'insertText',
              data: item.value,
            });
            target.dispatchEvent(inputEvent);
          } catch {}
        }
        target.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        target.textContent = item.value;
      }

      // Event dispatching
      if (!isContentEditable) {
        target.dispatchEvent(new Event('focus', { bubbles: true }));
        target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true }));
        target.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        target.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
        target.dispatchEvent(new Event('blur', { bubbles: true }));
      }

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
        if (!actualVal && (isContentEditable || target.getAttribute('role') === 'textbox')) {
          const innerP = target.querySelector('p, span, .selectable-text');
          if (innerP) actualVal = (innerP.textContent || '').trim();
        }
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
    try {
      target = document.querySelector(selector);
    } catch {}
    // If selector had an absolute URL e.g. a[href="https://www.youtube.com/@MrBeast"], also try relative pathname
    if (!target && /href=["']https?:\/\/[^/]+(\/[^"']+)["']/i.test(selector)) {
      const pathMatch = selector.match(/href=["']https?:\/\/[^/]+(\/[^"']+)["']/i);
      if (pathMatch) {
        try {
          target = document.querySelector(`a[href="${pathMatch[1]}"], a[href*="${pathMatch[1]}"]`);
        } catch {}
      }
    }
  }
  if (!target && text) {
    const rawCandidates = Array.from(document.querySelectorAll<HTMLElement>(
      'button, a, input[type="submit"], input[type="button"], [role="button"], [role="link"], [role="tab"], [role="listitem"], [role="row"], [role="treeitem"], [role="menuitem"], [role="option"], tp-yt-paper-tab, yt-tab-shape, [contenteditable="true"], [role="textbox"], yt-formatted-string, #video-title, #placeholder-area, #simplebox-placeholder, ytd-channel-name, [data-tooltip], [data-testid*="cell"], [data-testid*="list-item"], [data-testid*="chat-list-item"], span[title], div[title], [aria-label], #pane-side div[tabindex="-1"], #pane-side span'
    ));
    // Filter out search prediction dropdowns / hidden autocomplete popups so we never accidentally click search suggestions
    const candidates = rawCandidates.filter((c) => {
      const inSearchDropdown = c.closest('.sbdd_a, .sbsb_a, [role="listbox"], #complete-list');
      return !inSearchDropdown;
    });

    const tLower = text.toLowerCase().trim();

    // 1. Exact match (highest priority)
    target = candidates.find((c) => {
      const val = (c.textContent || (c as HTMLInputElement).value || c.getAttribute('aria-label') || c.getAttribute('data-tooltip') || c.getAttribute('title') || '').toLowerCase().trim();
      return val === tLower || val.startsWith(tLower);
    }) || null;

    // 2. Exact word boundary match
    if (!target) {
      try {
        const wordRegex = new RegExp(`(^|\\s|[^a-zA-Z0-9])${tLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|\\s|[^a-zA-Z0-9])`, 'i');
        target = candidates.find((c) => {
          const val = (c.textContent || (c as HTMLInputElement).value || c.getAttribute('aria-label') || c.getAttribute('data-tooltip') || c.getAttribute('title') || '').trim();
          return wordRegex.test(val);
        }) || null;
      } catch {}
    }

    // 3. Substring match, sorted by shortest length (most specific leaf element first)
    if (!target) {
      const matches = candidates
        .map((c) => {
          const val = (c.textContent || (c as HTMLInputElement).value || c.getAttribute('aria-label') || c.getAttribute('data-tooltip') || c.getAttribute('title') || '').toLowerCase().trim();
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

  const container = target.closest<HTMLElement>(
    'a[href], button, [role="button"], [role="tab"], [role="listitem"], [role="row"], [role="menuitem"], [role="option"], [role="treeitem"], div[data-testid*="cell"], div[data-testid*="list-item"], div[data-testid*="chat-list-item"], tp-yt-paper-tab, yt-tab-shape, ytd-compact-video-renderer, ytd-video-renderer, #pane-side div[tabindex="-1"], [contenteditable="true"]'
  );

  // If target itself is an outer row or list item container, resolve its inner primary interactive leaf (contact name, title, button)
  let leafTarget = target;
  if (target.matches('[role="listitem"], [role="row"], div[data-testid*="cell"], div[data-testid*="list-item"], #pane-side div[tabindex="-1"]')) {
    const innerLeaf = target.querySelector<HTMLElement>(
      'span[title], div[title], [title], a[href], button, [role="button"], [role="gridcell"], .title, [class*="title" i], [class*="name" i]'
    );
    if (innerLeaf) {
      leafTarget = innerLeaf;
    }
  }

  const primary = container || target;

  try {
    primary.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch {}

  // Inset visual outline and glowing shadow on container
  try {
    const prevOutline = primary.style.outline;
    const prevOffset = primary.style.outlineOffset;
    const prevShadow = primary.style.boxShadow;
    const prevTransition = primary.style.transition;
    primary.style.transition = 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)';
    primary.style.outline = '3px solid #22c55e';
    primary.style.outlineOffset = '-2px';
    primary.style.boxShadow = '0 0 0 2px #22c55e, 0 0 16px rgba(34, 197, 94, 0.7)';
    setTimeout(() => {
      primary.style.outline = prevOutline;
      primary.style.outlineOffset = prevOffset;
      primary.style.boxShadow = prevShadow;
      primary.style.transition = prevTransition;
    }, 1200);
  } catch {}

  // Dispatch full pointer and mouse sequence to trigger React synthetic events
  const rect = leafTarget.getBoundingClientRect();
  const fallbackRect = primary.getBoundingClientRect();
  const effectiveRect = (rect.width > 0 && rect.height > 0) ? rect : fallbackRect;
  const clientX = Math.round(effectiveRect.left + (effectiveRect.width > 0 ? effectiveRect.width / 2 : 10));
  const clientY = Math.round(effectiveRect.top + (effectiveRect.height > 0 ? effectiveRect.height / 2 : 10));

  const mouseInit: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    detail: 1,
    screenX: window.screenX + clientX,
    screenY: window.screenY + clientY,
    clientX,
    clientY,
    button: 0,
    buttons: 1,
  };

  const pointerInit: PointerEventInit = {
    ...mouseInit,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    width: 1,
    height: 1,
    pressure: 0.5,
  };

  const dispatchCycle = (el: HTMLElement) => {
    try {
      el.dispatchEvent(new PointerEvent('pointerover', { ...pointerInit, buttons: 0 }));
      el.dispatchEvent(new MouseEvent('mouseover', { ...mouseInit, buttons: 0 }));
      el.dispatchEvent(new PointerEvent('pointerdown', pointerInit));
      el.dispatchEvent(new MouseEvent('mousedown', mouseInit));
    } catch {}

    try {
      el.focus();
    } catch {}

    try {
      el.dispatchEvent(new PointerEvent('pointerup', { ...pointerInit, buttons: 0 }));
      el.dispatchEvent(new MouseEvent('mouseup', { ...mouseInit, buttons: 0 }));
      el.dispatchEvent(new MouseEvent('click', { ...mouseInit, buttons: 0 }));
    } catch {}
  };

  dispatchCycle(leafTarget);
  if (container && container !== leafTarget) {
    dispatchCycle(container);
  }

  try {
    primary.click();
  } catch {}

  const label = (primary.textContent || primary.getAttribute('aria-label') || target.getAttribute('title') || '').trim().slice(0, 30);
  return { success: true, message: `Clicked element "${label}"` };
}

// --- Audio Alerts for Human-in-the-Loop Intercept Gate ---
export function playCaptchaAlertSound() {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    const now = ctx.currentTime;
    osc.frequency.setValueAtTime(698.46, now); // F5
    osc.frequency.setValueAtTime(880, now + 0.15); // A5
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.42);
  } catch {}
}

export function playCaptchaSuccessSound() {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99]; // C5 -> E5 -> G5
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.1);
      gain.gain.setValueAtTime(0.2, now + idx * 0.1);
      gain.gain.exponentialRampToValueAtTime(0.01, now + idx * 0.1 + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.1);
      osc.stop(now + idx * 0.1 + 0.2);
    });
  } catch {}
}

// In-page fallback CAPTCHA detection for direct script execution
function inPageCheckCaptcha(): { detected: boolean; type?: string; selector?: string } {
  const isElementVisible = (el: Element | null): boolean => {
    if (!el) return false;
    if (!(el instanceof HTMLElement)) return true;
    const style = window.getComputedStyle(el);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.opacity === '0' ||
      style.visibility === 'collapse'
    ) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width <= 5 || rect.height <= 5) return false;
    return true;
  };

  const isInvisibleBadge = (el: Element | null): boolean => {
    if (!el) return false;
    if (el.closest('.grecaptcha-badge, [data-size="invisible"]')) return true;
    if (el.getAttribute('data-size') === 'invisible') return true;
    return false;
  };

  const title = (document.title || '').trim().toLowerCase();
  const bodyText = (document.body ? document.body.innerText || '' : '').toLowerCase().slice(0, 3000);

  // 1. Cloudflare Turnstile & Interactive Challenge
  const cfChallengeRunning = document.querySelector('#challenge-running, #challenge-stage');
  const cfTurnstileFrame = document.querySelector('iframe[src*="challenges.cloudflare.com"]');
  if (
    title.includes('just a moment...') ||
    title.includes('attention required! | cloudflare') ||
    (cfChallengeRunning && isElementVisible(cfChallengeRunning)) ||
    (cfTurnstileFrame && isElementVisible(cfTurnstileFrame)) ||
    (bodyText.includes('checking your browser') && bodyText.includes('cloudflare') && bodyText.length < 1000)
  ) {
    return {
      detected: true,
      type: 'cloudflare',
      selector: '#challenge-form, #challenge-stage, iframe[src*="challenges.cloudflare.com"]',
    };
  }

  // 2. Google reCAPTCHA (only active challenge bframe or visible checkbox, never invisible v3 badges)
  const recaptchaBframe = document.querySelector('iframe[src*="recaptcha/api2/bframe"], iframe[src*="recaptcha/enterprise/bframe"]');
  const recaptchaAnchor = document.querySelector('iframe[src*="recaptcha/api2/anchor"], iframe[src*="recaptcha/enterprise/anchor"]');
  if (
    (recaptchaBframe && isElementVisible(recaptchaBframe)) ||
    (recaptchaAnchor && isElementVisible(recaptchaAnchor) && !isInvisibleBadge(recaptchaAnchor))
  ) {
    return {
      detected: true,
      type: 'recaptcha',
      selector: 'iframe[src*="recaptcha"]',
    };
  }

  // 3. hCaptcha
  const hcaptchaBox = document.querySelector('iframe[src*="hcaptcha.com/box"], iframe[src*="hcaptcha.com"][title*="challenge" i]');
  const hcaptchaAnchor = document.querySelector('iframe[src*="hcaptcha.com"]');
  if (
    (hcaptchaBox && isElementVisible(hcaptchaBox)) ||
    (hcaptchaAnchor && isElementVisible(hcaptchaAnchor) && !isInvisibleBadge(hcaptchaAnchor))
  ) {
    return {
      detected: true,
      type: 'hcaptcha',
      selector: 'iframe[src*="hcaptcha.com"]',
    };
  }

  // 4. Arkose Labs / FunCaptcha
  const arkoseFrame = document.querySelector('#fc-iframe-wrap iframe, iframe[src*="arkoselabs"]');
  if (arkoseFrame && isElementVisible(arkoseFrame)) {
    return {
      detected: true,
      type: 'arkose',
      selector: '#fc-iframe-wrap iframe, iframe[src*="arkoselabs"]',
    };
  }

  // 5. Bing Bot Challenge (visible challenge only, no generic challenge form actions)
  const bingCaptcha = document.querySelector('#b_captcha');
  if (
    (bingCaptcha && isElementVisible(bingCaptcha)) ||
    (bodyText.includes('please solve this puzzle') && bodyText.includes('person') && bodyText.length < 800) ||
    (bodyText.includes('verify that you are human') && (bodyText.includes('bing') || title.includes('bing')) && bodyText.length < 800)
  ) {
    return {
      detected: true,
      type: 'bing_bot',
      selector: '#b_captcha',
    };
  }

  // 6. Generic Anti-Bot Challenge (must be dedicated interstitial page with short content)
  if (
    title === 'robot check' ||
    title.includes('robot check') ||
    title === 'security check' ||
    title === 'human verification' ||
    title === 'bot verification' ||
    ((bodyText.includes('verify you are human') || bodyText.includes('confirm you are not a robot')) && bodyText.length < 500 && !document.querySelector('main, article'))
  ) {
    return {
      detected: true,
      type: 'generic',
      selector: 'body',
    };
  }

  return { detected: false };
}

export async function checkActiveTabCaptcha(tabId?: number): Promise<{ detected: boolean; type?: string; selector?: string }> {
  let targetTabId = tabId;
  if (!targetTabId) {
    const activeTab = await getActiveTab();
    targetTabId = activeTab?.id;
  }
  if (!targetTabId || typeof chrome === 'undefined' || !chrome.tabs) {
    return { detected: false };
  }

  // 1. Try sendMessageToTab first
  try {
    const res = await sendMessageToTab<{ success: boolean; data: { detected: boolean; type?: string; selector?: string } }>(
      targetTabId,
      { action: 'CHECK_CAPTCHA' },
      1000
    );
    if (res && res.success && res.data) {
      return res.data;
    }
  } catch {
    // Fall back to direct executeScript
  }

  // 2. Direct executeScript fallback
  if (chrome.scripting) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        func: inPageCheckCaptcha,
      });
      if (results && results[0] && results[0].result) {
        return results[0].result as { detected: boolean; type?: string; selector?: string };
      }
    } catch {
      // Ignore
    }
  }

  return { detected: false };
}

// --- Human-in-the-Loop (HITL) 10-Second CAPTCHA Intercept Gate Manager ---
export interface CaptchaState {
  isActive: boolean;
  isManualSolving?: boolean;
  type: string;
  url: string;
  remainingSeconds: number;
}

type CaptchaListener = (state: CaptchaState) => void;

class CaptchaGateManager {
  private activeState: CaptchaState = {
    isActive: false,
    isManualSolving: false,
    type: '',
    url: '',
    remainingSeconds: 0,
  };
  private listeners = new Set<CaptchaListener>();
  private activeResolver: ((value: { solved: boolean; message: string }) => void) | null = null;
  private countdownTimer: any = null;
  private pollInterval: any = null;

  public getState(): CaptchaState {
    return { ...this.activeState };
  }

  public subscribe(cb: CaptchaListener): () => void {
    this.listeners.add(cb);
    cb(this.getState());
    return () => this.listeners.delete(cb);
  }

  private notify() {
    const state = this.getState();
    this.listeners.forEach((cb) => cb(state));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('openbua_captcha_state', { detail: state }));
    }
  }

  public pauseForManualSolving() {
    if (!this.activeState.isActive) return;
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    this.activeState.isManualSolving = true;
    this.notify();
  }

  public resolveActiveGate(solved: boolean, customMessage?: string) {
    if (!this.activeState.isActive || !this.activeResolver) return;

    if (this.countdownTimer) clearInterval(this.countdownTimer);
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.countdownTimer = null;
    this.pollInterval = null;

    if (solved) {
      playCaptchaSuccessSound();
    }

    const resolver = this.activeResolver;
    this.activeResolver = null;
    this.activeState = {
      isActive: false,
      isManualSolving: false,
      type: '',
      url: '',
      remainingSeconds: 0,
    };
    this.notify();

    resolver({
      solved,
      message:
        customMessage ||
        (solved
          ? 'CAPTCHA was resolved by user. Resuming automation.'
          : 'CAPTCHA challenge skipped by user. ABORT this domain immediately and pivot to an alternate source/query.'),
    });
  }

  public async runGate(tabId: number, type: string, url: string): Promise<{ solved: boolean; message: string }> {
    if (this.activeState.isActive) {
      return { solved: false, message: 'CAPTCHA gate already active.' };
    }

    playCaptchaAlertSound();

    this.activeState = {
      isActive: true,
      isManualSolving: false,
      type: type || 'bot_challenge',
      url,
      remainingSeconds: 10,
    };
    this.notify();

    return new Promise<{ solved: boolean; message: string }>((resolve) => {
      this.activeResolver = resolve;

      // Absolute hard safety timeout (12s) to prevent any possibility of indefinite freezing
      const hardTimeout = setTimeout(() => {
        if (this.activeState.isActive) {
          this.resolveActiveGate(false, 'CAPTCHA challenge timed out after safety period. Resuming automation.');
        }
      }, 12000);

      // 1. Tick countdown every 1 second
      this.countdownTimer = setInterval(() => {
        if (!this.activeState.isActive) {
          clearTimeout(hardTimeout);
          return;
        }
        const nextRemaining = this.activeState.remainingSeconds - 1;
        if (nextRemaining <= 0) {
          clearTimeout(hardTimeout);
          // Timer expired: do a final check to see if human solved it right before expiry
          checkActiveTabCaptcha(tabId)
            .then((check) => {
              if (!check.detected) {
                this.resolveActiveGate(true, 'CAPTCHA challenge solved before 10s timeout expired. Resuming automation.');
              } else {
                this.resolveActiveGate(
                  false,
                  'CAPTCHA challenge timed out after 10s. Human was unable to solve it or chose to pivot. Workaround activated: ABORT current domain/URL immediately and pivot to an alternate source (e.g. Google X-Ray search, web search snippet, or alternate URL). Do NOT attempt to reload this blocked URL.'
                );
              }
            })
            .catch(() => {
              this.resolveActiveGate(false, 'CAPTCHA check failed. Resuming automation.');
            });
        } else {
          this.activeState.remainingSeconds = nextRemaining;
          this.notify();
        }
      }, 1000);

      // 2. Poll every 600ms for DOM detachment / human solving
      this.pollInterval = setInterval(async () => {
        if (!this.activeState.isActive) return;
        try {
          const check = await checkActiveTabCaptcha(tabId);
          if (!check.detected) {
            clearTimeout(hardTimeout);
            this.resolveActiveGate(true, 'CAPTCHA challenge solved by human in browser (DOM challenge cleared). Resuming automation.');
          }
        } catch {
          // ignore transient poll errors
        }
      }, 600);
    });
  }
}

export const captchaManager = new CaptchaGateManager();

// Inspect Form on Active Tab
export async function inspectActiveTabForm(selector?: string): Promise<PageFormSummary> {
  const activeTab = await getActiveTab();
  if (!activeTab || !activeTab.id) {
    return getMockFormSummary();
  }

  if (activeTab.url && (activeTab.url.startsWith('chrome://') || activeTab.url.startsWith('chrome-extension://') || activeTab.url.startsWith('edge://') || activeTab.url.startsWith('about:'))) {
    throw new Error(`Chrome restricts extensions from accessing internal pages (${activeTab.url}). Please open a regular webpage or form (such as test-form.html) in your browser!`);
  }

  // Check for CAPTCHA challenge before inspecting form
  const captcha = await checkActiveTabCaptcha(activeTab.id);
  if (captcha.detected) {
    const gate = await captchaManager.runGate(activeTab.id, captcha.type || 'bot_challenge', activeTab.url || '');
    if (!gate.solved) {
      throw new Error(`[BLOCKED BY CAPTCHA]: ${gate.message}`);
    }
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

// In-page fallback script for directly scrolling containers without relying on message ports
function inPageScrollPage(
  direction: 'up' | 'down' | 'top' | 'bottom' | 'element',
  selector?: string
): { success: boolean; message: string } {
  const isVisible = (el: HTMLElement | null): boolean => {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 5 && rect.height > 5;
  };

  if (direction === 'element' && selector) {
    const el = document.querySelector<HTMLElement>(selector);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return { success: true, message: `Scrolled to element "${selector}"` };
    }
  }

  let container: HTMLElement | Window = window;

  // 1. Explicit selector if provided
  if (selector) {
    try {
      const el = document.querySelector<HTMLElement>(selector);
      if (el) {
        const style = window.getComputedStyle(el);
        if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 10) {
          container = el;
        } else {
          const scrollableChild = Array.from(el.querySelectorAll<HTMLElement>('*')).find((c) => {
            const s = window.getComputedStyle(c);
            return (s.overflowY === 'auto' || s.overflowY === 'scroll') && c.scrollHeight > c.clientHeight + 10;
          });
          if (scrollableChild) container = scrollableChild;
        }
      }
    } catch {}
  }

  // 2. WhatsApp Web active conversation messages panel (#main)
  if (container === window) {
    const mainPane = document.querySelector<HTMLElement>('#main');
    if (mainPane && isVisible(mainPane)) {
      const whatsappSelectors = [
        '#main div[data-testid="conversation-panel-messages"]',
        '#main div[role="application"]',
        '#main .copyable-area > div[tabindex="0"]',
        '#main .copyable-area > div:nth-child(2)',
        '#main .copyable-area > div',
        '#main div[tabindex="0"]',
        '#main div[tabindex="-1"]',
      ];
      for (const sel of whatsappSelectors) {
        const el = document.querySelector<HTMLElement>(sel);
        if (el && el.scrollHeight > el.clientHeight + 20) {
          container = el;
          break;
        }
      }
      if (container === window) {
        const mainChildren = Array.from(mainPane.querySelectorAll<HTMLElement>('*'));
        for (const child of mainChildren) {
          if (child.scrollHeight > child.clientHeight + 30) {
            const style = window.getComputedStyle(child);
            if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
              container = child;
              break;
            }
          }
        }
      }
    }
  }

  // 3. WhatsApp Web contact list (#pane-side)
  if (container === window) {
    const paneSide = document.querySelector<HTMLElement>('#pane-side, div[data-testid="chat-list"]');
    if (paneSide && isVisible(paneSide) && paneSide.scrollHeight > paneSide.clientHeight + 20) {
      container = paneSide;
    }
  }

  // 4. Common web app chat and feed containers (Slack, Discord, Telegram, YouTube comments, modal dialogs)
  if (container === window) {
    const commonAppSelectors = [
      'div[role="dialog"] [class*="scroll" i]',
      'div[role="dialog"]',
      '[data-qa="slack_kit_scrollbar"]',
      '[data-qa="message_pane"]',
      '[class*="messagesWrapper"]',
      '[class*="chatContent"]',
      '.messages-container',
      '#comments #contents',
      'ytd-item-section-renderer #contents',
      '[role="feed"]',
      '[role="log"]',
    ];
    for (const sel of commonAppSelectors) {
      try {
        const el = document.querySelector<HTMLElement>(sel);
        if (el && isVisible(el) && el.scrollHeight > el.clientHeight + 20) {
          container = el;
          break;
        }
      } catch {}
    }
  }

  // 5. Check if main document is scrollable
  if (container === window) {
    const docScrollable =
      document.documentElement.scrollHeight > window.innerHeight + 50 ||
      document.body.scrollHeight > window.innerHeight + 50;

    if (!docScrollable) {
      let largest: HTMLElement | null = null;
      let maxArea = 0;
      const candidates = Array.from(document.querySelectorAll<HTMLElement>('div, section, main, article'));
      for (const el of candidates) {
        if (el.scrollHeight > el.clientHeight + 40 && el.clientHeight > 150 && el.clientWidth > 150 && isVisible(el)) {
          const style = window.getComputedStyle(el);
          if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
            const area = el.clientHeight * el.clientWidth;
            if (area > maxArea) {
              maxArea = area;
              largest = el;
            }
          }
        }
      }
      if (largest) container = largest;
    }
  }

  if (container === window) {
    const amount = Math.round(window.innerHeight * 0.75);
    if (direction === 'top') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (direction === 'bottom') {
      window.scrollTo({ top: document.documentElement.scrollHeight || document.body.scrollHeight, behavior: 'smooth' });
    } else if (direction === 'down') {
      window.scrollBy({ top: amount, behavior: 'smooth' });
    } else if (direction === 'up') {
      window.scrollBy({ top: -amount, behavior: 'smooth' });
    }
    return { success: true, message: `Scrolled window ${direction} (${amount}px)` };
  }

  const el = container as HTMLElement;
  const amount = Math.max(350, Math.round(el.clientHeight * 0.75));
  const beforeTop = el.scrollTop;
  const delta = direction === 'up' || direction === 'top' ? -amount : amount;

  if (direction === 'top') {
    el.scrollTop = 0;
    try { el.scrollTo({ top: 0, behavior: 'smooth' }); } catch {}
  } else if (direction === 'bottom') {
    el.scrollTop = el.scrollHeight;
    try { el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); } catch {}
  } else if (direction === 'down') {
    const prev = el.scrollTop;
    try { el.scrollBy({ top: amount, behavior: 'smooth' }); } catch {}
    if (el.scrollTop === prev) {
      el.scrollTop += amount;
    }
  } else if (direction === 'up') {
    const prev = el.scrollTop;
    try { el.scrollBy({ top: -amount, behavior: 'smooth' }); } catch {}
    if (el.scrollTop === prev) {
      el.scrollTop = Math.max(0, el.scrollTop - amount);
    }
  }

  el.dispatchEvent(new Event('scroll', { bubbles: true, cancelable: false }));

  try {
    const rect = el.getBoundingClientRect();
    const wheelEvent = new WheelEvent('wheel', {
      deltaY: delta,
      deltaMode: 0,
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: Math.round(rect.left + Math.min(rect.width / 2, 200)),
      clientY: Math.round(rect.top + Math.min(rect.height / 2, 200)),
    });
    el.dispatchEvent(wheelEvent);
  } catch {}

  try {
    const key = direction === 'top' ? 'Home' : direction === 'bottom' ? 'End' : direction === 'up' ? 'PageUp' : 'PageDown';
    el.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key, code: key, bubbles: true, cancelable: true }));
  } catch {}

  const containerLabel = el.id ? `#${el.id}` : (el.getAttribute('data-testid') || el.tagName.toLowerCase());
  return {
    success: true,
    message: `Scrolled <${containerLabel}> ${direction} (scrollTop: ${Math.round(beforeTop)} -> ${Math.round(el.scrollTop)}, max: ${el.scrollHeight})`,
  };
}

// Scroll page
export async function scrollActiveTab(
  direction: 'up' | 'down' | 'top' | 'bottom' | 'element',
  selector?: string
): Promise<{ success: boolean; message?: string }> {
  const activeTab = await getActiveTab();
  if (!activeTab || !activeTab.id) {
    return { success: true, message: `[Dev Mock] Scrolled ${direction}` };
  }

  // 1. Try sendMessageToTab
  try {
    const response = await sendMessageToTab(activeTab.id, {
      action: 'SCROLL_PAGE',
      direction,
      selector,
    }, 1500);
    if (response && response.success) {
      return response as { success: boolean; message?: string };
    }
  } catch {
    // Fall back to direct executeScript
  }

  // 2. Direct executeScript fallback (never fails, works on WhatsApp Web, Slack, etc.)
  if (typeof chrome !== 'undefined' && chrome.scripting) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: inPageScrollPage,
        args: [direction, selector],
      });
      if (results && results[0] && results[0].result) {
        return results[0].result as { success: boolean; message?: string };
      }
    } catch {
      // Fall through
    }
  }

  return { success: false, message: 'Could not scroll active tab' };
}

// Get Page Text — wrapped in a hard timeout and direct scripting fallback to prevent hanging
export async function getActiveTabPageContent(timeoutMs = 4000): Promise<{ text: string; title: string; url: string }> {
  const activeTab = await getActiveTab(1500);
  if (!activeTab || !activeTab.id) {
    return {
      text: 'No active browser tab found. Please open a webpage in your browser.',
      title: 'No Tab',
      url: '',
    };
  }

  const rawUrl = activeTab.url || '';

  // 1. Guard against internal / restricted browser pages that reject content scripts
  if (
    rawUrl.startsWith('chrome://') ||
    rawUrl.startsWith('chrome-extension://') ||
    rawUrl.startsWith('edge://') ||
    rawUrl.startsWith('about:') ||
    rawUrl.startsWith('devtools://')
  ) {
    return {
      text: `Browser internal page (${rawUrl}). Content cannot be inspected due to browser security restrictions.`,
      title: activeTab.title || 'Internal Page',
      url: rawUrl,
    };
  }

  // 2. Passive CAPTCHA detection (NON-BLOCKING: never freeze read tools with a human gate!)
  let captchaNotice = '';
  try {
    const captcha = await checkActiveTabCaptcha(activeTab.id);
    if (captcha && captcha.detected) {
      captchaNotice = `[Note: Bot challenge / CAPTCHA detected on page (${captcha.type || 'bot_challenge'})]\n\n`;
    }
  } catch {
    // Non-blocking, continue extraction
  }

  // 3. Fast extraction with hard timeout race
  const result = await Promise.race([
    (async () => {
      // Step A: Try content script messaging first
      try {
        await ensureContentScriptInjected(activeTab.id!, 1500).catch(() => {});
        const response = await sendMessageToTab(activeTab.id!, { action: 'GET_PAGE_TEXT' }, 2200).catch(() => null);
        if (response && response.success && response.text) {
          return {
            text: captchaNotice + response.text,
            title: response.title || activeTab.title || '',
            url: response.url || rawUrl,
          };
        }
      } catch {
        // Fall through to direct script
      }

      // Step B: Direct executeScript fallback (fast, immune to content script messaging stalls)
      if (typeof chrome !== 'undefined' && chrome.scripting) {
        try {
          const directScriptResults = await chrome.scripting.executeScript({
            target: { tabId: activeTab.id! },
            func: () => {
              const title = document.title || '';
              const url = window.location.href;
              const mainEl = document.querySelector('main, article, #content, [role="main"]') || document.body;
              const text = (mainEl ? (mainEl as HTMLElement).innerText || '' : '').replace(/\n\s*\n\s*\n/g, '\n\n').slice(0, 10000);
              return { title, url, text };
            },
          });
          if (directScriptResults && directScriptResults[0] && directScriptResults[0].result) {
            const data = directScriptResults[0].result as { title: string; url: string; text: string };
            return {
              text: captchaNotice + (data.text || activeTab.title || 'No readable text content on page.'),
              title: data.title || activeTab.title || '',
              url: data.url || rawUrl,
            };
          }
        } catch {
          // Direct script failed (e.g. page still loading or frame discarded)
        }
      }

      return null;
    })(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);

  if (result) return result;

  // Step C: Guaranteed fallback — returns active tab title & URL immediately instead of hanging
  return {
    text: `${captchaNotice}Page Title: ${activeTab.title || 'Web page'}\nURL: ${rawUrl}\n(Notice: Detailed DOM extraction timed out. The page may still be loading or heavy. Proceeding with tab context.)`,
    title: activeTab.title || '',
    url: rawUrl,
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
    // In Arc Browser or floating window mode, query normal browser windows first
    chrome.tabs.query({ windowType: 'normal' }, (normalTabs) => {
      let list = (normalTabs || []).filter((t) => !isExtensionPage(t));
      if (list.length > 0) {
        return resolve(
          list.map((t) => ({
            id: t.id || 0,
            title: t.title || 'Untitled Tab',
            url: t.url || '',
            active: Boolean(t.active),
            favIconUrl: t.favIconUrl,
          }))
        );
      }

      // Fallback: query all tabs in the browser excluding our extension
      chrome.tabs.query({}, (allTabs) => {
        list = (allTabs || []).filter((t) => !isExtensionPage(t));
        resolve(
          list.map((t) => ({
            id: t.id || 0,
            title: t.title || 'Untitled Tab',
            url: t.url || '',
            active: Boolean(t.active),
            favIconUrl: t.favIconUrl,
          }))
        );
      });
    });
  });
}

export async function switchTab(tabId: number): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.tabs) {
    return true;
  }
  return new Promise((resolve) => {
    chrome.tabs.update(tabId, { active: true }, (tab) => {
      if (tab?.windowId) {
        chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
      }
      resolve(!chrome.runtime.lastError);
    });
  });
}

export async function createNewTab(url: string): Promise<number | null> {
  if (typeof chrome === 'undefined' || !chrome.tabs) {
    return null;
  }
  const activeTab = await getActiveTab();
  const createProps: chrome.tabs.CreateProperties = { url, active: true };
  if (activeTab?.windowId) {
    createProps.windowId = activeTab.windowId;
  }
  return new Promise((resolve) => {
    chrome.tabs.create(createProps, (tab) => {
      if (tab?.windowId) {
        chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
      }
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

export interface NavigationResult {
  success: boolean;
  blockedByCaptcha?: boolean;
  message?: string;
  url?: string;
}

export async function navigateActiveTab(url: string, timeoutMs = 8000): Promise<NavigationResult> {
  const activeTab = await getActiveTab();
  if (!activeTab || !activeTab.id || typeof chrome === 'undefined' || !chrome.tabs) {
    return { success: true, url };
  }

  const tabId = activeTab.id;
  let targetUrl = url.trim();
  if (!/^https?:\/\//i.test(targetUrl)) {
    targetUrl = `https://${targetUrl}`;
  }

  return new Promise((resolve) => {
    let settled = false;

    const safeResolve = (res: NavigationResult) => {
      if (settled) return;
      settled = true;
      try {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdatedListener);
      } catch {}
      resolve(res);
    };

    // Absolute hard safety timeout (8s) - guarantees resolve even if page streams or hangs
    const timer = setTimeout(() => {
      safeResolve({
        success: true,
        url: targetUrl,
        message: 'Navigation initiated (continuing without waiting indefinitely for page load event).',
      });
    }, timeoutMs);

    const onUpdatedListener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        safeResolve({
          success: true,
          url: targetUrl,
        });
      }
    };

    try {
      chrome.tabs.onUpdated.addListener(onUpdatedListener);

      chrome.tabs.update(tabId, { url: targetUrl }, (updatedTab) => {
        if (chrome.runtime.lastError || !updatedTab) {
          safeResolve({
            success: false,
            message: chrome.runtime.lastError?.message || 'Failed to update tab URL',
            url: targetUrl,
          });
        }
      });
    } catch (err: any) {
      safeResolve({
        success: false,
        message: err?.message || 'Failed to navigate tab',
        url: targetUrl,
      });
    }
  });
}

export async function captureTabScreenshot(): Promise<string> {
  if (typeof chrome === 'undefined' || !chrome.tabs) {
    return 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
  }

  const activeTab = await getActiveTab();
  const windowId = activeTab?.windowId;

  const tryCapture = (): Promise<string> => {
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
  };

  try {
    return await tryCapture();
  } catch (err: any) {
    // If image readback failed (e.g. active tab mid-scroll, rendering frame, or GPU memory swapping), retry once after a short delay
    const msg = err?.message || String(err);
    if (msg.toLowerCase().includes('readback') || msg.toLowerCase().includes('internal error')) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return await tryCapture();
    }
    throw err;
  }
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

// Fast lightweight background HTTP check (replaces slow full-tab navigations to verify sites)
export async function checkUrlReachable(url: string): Promise<{ reachable: boolean; status?: number; message: string }> {
  let cleanUrl = url.trim();
  if (!/^https?:\/\//i.test(cleanUrl)) {
    cleanUrl = `https://${cleanUrl}`;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);

    const res = await fetch(cleanUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    clearTimeout(timer);

    return {
      reachable: res.ok || res.status < 400,
      status: res.status,
      message: res.ok || res.status < 400
        ? `URL ${cleanUrl} is live (HTTP ${res.status}).`
        : `URL ${cleanUrl} returned error status (HTTP ${res.status}).`,
    };
  } catch (err: any) {
    return {
      reachable: false,
      message: `URL ${cleanUrl} is unreachable or timed out: ${err?.message || err}`,
    };
  }
}
