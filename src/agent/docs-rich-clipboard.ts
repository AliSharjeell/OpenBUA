// Chrome serializes these functions: keep every page helper inside the function.
export async function readDocsClipboard(expectedText: string) {
  try {
    const items = await navigator.clipboard.read();
    let text = '', html = '';
    for (const item of items) {
      if (!text && item.types.includes('text/plain')) text = await (await item.getType('text/plain')).text();
      if (!html && item.types.includes('text/html')) html = await (await item.getType('text/html')).text();
    }
    const normalize = (value: string) => value.replace(/^[ \t]*[•●◦▪‣]\s*/gm, '').replace(/\s+/g, ' ').trim();
    const matchesSelection = Boolean(normalize(expectedText)) && normalize(text) === normalize(expectedText);
    if (!matchesSelection || !html.trim()) return { success: false, text: '', html: '', message: 'Clipboard content does not match the copied selection or has no rich HTML. No formatted copy is verified; do not paste or edit the source.' };
    if (html.length > 2_000_000 || text.length > 200_000) return { success: false, text: '', html: '', message: 'Selected block is too large for a formatted project copy. Select only the source project.' };
    return { success: true, text, html, message: 'System clipboard plain text matches the selected source and rich HTML is present.' };
  } catch (error) { return { success: false, text: '', html: '', message: `Cannot verify rich clipboard content: ${String(error)}. Do not assume copy succeeded.` }; }
}

export function dispatchDocsRichPaste(text: string, html: string) {
  let editorDocument: Document | null = null;
  for (const frame of Array.from(document.querySelectorAll('iframe'))) {
    if (!/texteventtarget/i.test(`${frame.id} ${frame.className}`)) continue;
    try { editorDocument = frame.contentDocument; } catch { /* inaccessible frame */ }
    break;
  }
  const target = editorDocument?.activeElement as HTMLElement | null;
  const view = editorDocument?.defaultView;
  if (!editorDocument || !view || !target?.isContentEditable) return { success: false, dispatched: false, message: 'Docs input is not focused. Place and inspect the destination caret first.' };
  const selection = view.getSelection();
  if (selection && !selection.isCollapsed && selection.toString().trim()) return { success: false, dispatched: false, message: 'A text range is still selected. Paste would replace it. Click before the source heading with Shift off, inspect the collapsed caret, then paste.' };
  if (!text.trim() || !html.trim()) return { success: false, dispatched: false, message: 'Verified source text and rich HTML are required.' };
  // Route actual rich clipboard data to the editor's paste handler. A bare
  // execCommand can accept the command while only changing its hidden buffer.
  const constructors = view as unknown as Window & typeof globalThis;
  const data = new constructors.DataTransfer();
  data.setData('text/plain', text);
  data.setData('text/html', html);
  const paste = new constructors.ClipboardEvent('paste', { bubbles: true, cancelable: true, composed: true, clipboardData: data });
  target.dispatchEvent(paste);
  return { success: false, dispatched: true, handlerConsumed: paste.defaultPrevented, documentVerified: false,
    message: paste.defaultPrevented ? 'Docs intercepted the rich paste event. Verify a second complete block and the preserved original in the screenshot before editing.' : 'Paste event was dispatched but Docs did not acknowledge handling it. Do not retry automatically or edit the original. Inspect the screenshot and report the clipboard blocker if no duplicate appears.' };
}
