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
  return { controls, selectionText: selectionText.slice(0, 12000), selectionVerified: Boolean(selectionText),
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
