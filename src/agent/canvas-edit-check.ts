import { getActiveTab } from './browser-bridge';

export interface CanvasTextCheck {
  allowed: boolean;
  message?: string;
}

// This function is serialized into the page by Chrome; keep it self-contained.
export function inspectCanvasInsertion(
  text: string,
  expectedCaretText?: string,
  allowUniformParagraphStyle = false
): CanvasTextCheck {
  if (!document.querySelector('.kix-appview, .docs-texteventtarget-iframe')) return { allowed: true };

  let inputContext = '';
  for (const frame of Array.from(document.querySelectorAll('iframe'))) {
    if (!/texteventtarget/i.test(`${frame.className} ${frame.id}`)) continue;
    try {
      inputContext = (frame.contentDocument?.body?.textContent || '').replace(/\s+/g, ' ').trim();
    } catch { /* No readable input context; placement still needs a screenshot. */ }
    break;
  }
  const expected = expectedCaretText?.replace(/\s+/g, ' ').trim();
  if (expected && inputContext && !inputContext.includes(expected)) {
    return {
      allowed: false,
      message: `No text inserted. The editor input context is "${inputContext.slice(0, 220)}", which does not contain the expected "${expected}". Locate the intended section again and verify the caret with a screenshot before typing.`,
    };
  }

  const styleControl = document.querySelector('#headingStyleSelect, #stylesComboButton, [aria-label="Styles"], [aria-label="Paragraph styles"]');
  const caption = styleControl?.querySelector('.goog-toolbar-menu-button-caption');
  const style = (caption?.textContent || styleControl?.textContent || '').trim();
  const bold = document.querySelector('#boldButton')?.getAttribute('aria-pressed') === 'true';
  if (/\n/.test(text) && !allowUniformParagraphStyle && (/\b(title|subtitle|heading)\b/i.test(style) || bold)) {
    return {
      allowed: false,
      message: `No text inserted. Google Docs currently uses ${style || 'bold text'}${bold ? ' with bold enabled' : ''}. A multi-line block here would inherit that formatting. To match an existing project, copy its complete formatted block and replace each line's text separately. Use normal text and the editor's bullet-list formatting for body paragraphs. Do not ignore the toolbar or type the whole project into a title paragraph. Set allowUniformParagraphStyle only when every inserted paragraph intentionally uses the current style.`,
    };
  }
  return { allowed: true };
}

export async function checkCanvasTextInsertion(
  text: string, expectedCaretText?: string, allowUniformParagraphStyle?: boolean
): Promise<CanvasTextCheck> {
  const tab = await getActiveTab();
  if (!tab?.id || !/^https:\/\/docs\.google\.com\/document\//.test(tab.url || '')) return { allowed: true };
  if (typeof chrome === 'undefined' || !chrome.scripting) {
    return { allowed: false, message: 'No text inserted: Google Docs insertion checks are unavailable. Verify editor access before retrying.' };
  }
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id }, func: inspectCanvasInsertion,
    args: [text, expectedCaretText, Boolean(allowUniformParagraphStyle)],
  });
  return results[0]?.result || { allowed: false, message: 'No text inserted: could not inspect Google Docs formatting.' };
}
