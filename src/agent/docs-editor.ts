import { getActiveTab } from './browser-bridge';

// Serialized by Chrome: all DOM helpers must remain inside this function.
export function inspectDocsEditor() {
  const visible = (el: Element) => el.getClientRects().length > 0;
  const controls = Array.from(document.querySelectorAll(
    '[role="toolbar"] [role="button"], [role="toolbar"] [role="combobox"], .goog-toolbar-button, .goog-toolbar-menu-button, #fontSizeSelect, #headingStyleSelect'
  )).filter(visible).slice(0, 100).map(el => {
    const rect = el.getBoundingClientRect();
    const input = el.querySelector('input');
    return {
      id: el.id || null,
      label: el.getAttribute('aria-label') || el.getAttribute('data-tooltip') || el.getAttribute('title') || '',
      value: input?.value || el.querySelector('.goog-toolbar-menu-button-caption')?.textContent?.trim() || el.textContent?.trim().slice(0, 100) || '',
      pressed: el.getAttribute('aria-pressed'),
      checked: el.getAttribute('aria-checked'),
      disabled: el.getAttribute('aria-disabled') === 'true',
      screenshotPosition: { x: (rect.x + rect.width / 2) * devicePixelRatio, y: (rect.y + rect.height / 2) * devicePixelRatio },
    };
  });
  let selectionText = window.getSelection()?.toString() || '';
  for (const frame of Array.from(document.querySelectorAll('iframe'))) {
    if (!/texteventtarget/i.test(`${frame.id} ${frame.className}`)) continue;
    try { selectionText ||= frame.contentWindow?.getSelection()?.toString() || ''; } catch { /* inaccessible frame */ }
  }
  return { controls, selectionText: selectionText.slice(0, 12000), selectionVerified: Boolean(selectionText.trim()),
    note: 'Toolbar states are DOM observations. Null states mean unknown or mixed. Canvas document text and caret location require a screenshot; an empty DOM selection does not prove nothing is selected.' };
}

export function setDocsToggle(controlId: string, enabled: boolean) {
  const allowed = ['boldButton', 'italicButton', 'underlineButton', 'bulletedListButton', 'numberedListButton'];
  if (!allowed.includes(controlId)) return { success: false, message: 'Unsupported formatting control.' };
  const el = document.getElementById(controlId);
  if (!el || !el.getClientRects().length || el.getAttribute('aria-disabled') === 'true') {
    return { success: false, message: 'Formatting control is missing, hidden, or disabled. Inspect the toolbar first.' };
  }
  const state = el.getAttribute('aria-pressed') ?? el.getAttribute('aria-checked');
  if (state !== 'true' && state !== 'false') return { success: false, message: 'Formatting state is unknown or mixed. Select a homogeneous text range and inspect it before changing formatting.' };
  if ((state === 'true') === enabled) return { success: true, changed: false, message: 'Requested formatting is already active.' };
  el.click();
  const after = el.getAttribute('aria-pressed') ?? el.getAttribute('aria-checked');
  return { success: after === String(enabled), changed: true, state: after, message: after === String(enabled) ? 'Toolbar confirms requested formatting.' : 'Click dispatched; toolbar has not confirmed the requested state. Inspect a screenshot before retrying.' };
}

export async function runDocsInspection() {
  const tab = await getActiveTab();
  if (!tab?.id || !/^https:\/\/docs\.google\.com\/document\//.test(tab.url || '')) throw new Error('Activate a Google Docs document first.');
  const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: inspectDocsEditor });
  if (!results[0]?.result) throw new Error('Could not inspect the document toolbar.');
  return results[0].result;
}

export async function runDocsToggle(controlId: string, enabled: boolean) {
  const tab = await getActiveTab();
  if (!tab?.id || !/^https:\/\/docs\.google\.com\/document\//.test(tab.url || '')) throw new Error('Activate a Google Docs document first.');
  const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: setDocsToggle, args: [controlId, enabled] });
  return results[0]?.result || { success: false, message: 'Formatting action could not be inspected.' };
}

export function commandDocsClipboard(action: string) {
  if (!['copy', 'paste', 'cut'].includes(action)) return { success: false, message: 'Use copy, paste, or cut.' };
  let editorDocument = document;
  for (const frame of Array.from(document.querySelectorAll('iframe'))) {
    if (!/texteventtarget/i.test(`${frame.id} ${frame.className}`)) continue;
    try {
      if (frame.contentDocument) editorDocument = frame.contentDocument;
    } catch { /* fall back to outer active document */ }
    break;
  }
  const target = editorDocument.activeElement as HTMLElement | null;
  if (!target || !(target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) {
    return { success: false, message: 'Document input is not focused. Select or place the caret in the document body and verify a screenshot first.' };
  }
  // Browser command triggers clipboard events, including Docs rich-text handlers.
  // Never fall back to typing or retry a paste automatically.
  try {
    const accepted = editorDocument.execCommand(action);
    return { success: accepted, commandAccepted: accepted, placementVerified: false,
      message: accepted ? `${action} command accepted. Verify the selection/result in the screenshot; command acceptance does not prove content or formatting.` : `${action} was rejected by the browser. Check clipboard permissions and editor focus. Do not assume it completed.` };
  } catch (error) { return { success: false, message: `Clipboard command failed: ${String(error)}` }; }
}

export async function runDocsClipboard(action: string) {
  const tab = await getActiveTab();
  if (!tab?.id || !/^https:\/\/docs\.google\.com\/document\//.test(tab.url || '')) throw new Error('Activate a Google Docs document first.');
  const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: commandDocsClipboard, args: [action] });
  return results[0]?.result || { success: false, message: 'Clipboard command returned no result.' };
}

// Read only rendered page labels, never sidebar outlines or the typing buffer.
export function findDocsRenderedText(query: string) {
  const needle = query.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!needle) return { matches: [], message: 'Supply existing document text to locate.' };
  const matches: Array<{ text: string; start: { x: number; y: number }; end: { x: number; y: number }; exactLine: boolean }> = [];
  const seen = new Set<string>();
  for (const node of Array.from(document.querySelectorAll('.kix-page svg [aria-label], .kix-canvas-tile-content [aria-label]'))) {
    const text = (node.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
    if (!text.toLowerCase().includes(needle)) continue;
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth) continue;
    const key = `${text}:${rect.x}:${rect.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push({ text, exactLine: text.toLowerCase() === needle,
      start: { x: Math.max(0, rect.left + 1) * devicePixelRatio, y: (rect.top + rect.height / 2) * devicePixelRatio },
      end: { x: Math.min(innerWidth - 1, rect.right - 1) * devicePixelRatio, y: (rect.top + rect.height / 2) * devicePixelRatio },
    });
    if (matches.length >= 30) break;
  }
  return { matches, message: matches.length ? 'Coordinates come from rendered document labels. They bracket the entire labeled run, not just the query substring. Verify them against the screenshot before selecting or editing.' : 'No visible rendered document label matches. Do not invent coordinates or assume the sidebar is document text. Scroll to the target and inspect a fresh screenshot. Some Docs versions expose only a canvas.' };
}

export async function runDocsTextLookup(query: string) {
  const tab = await getActiveTab();
  if (!tab?.id || !/^https:\/\/docs\.google\.com\/document\//.test(tab.url || '')) throw new Error('Activate a Google Docs document first.');
  const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: findDocsRenderedText, args: [query] });
  return results[0]?.result || { matches: [], message: 'Document label lookup returned no result.' };
}
