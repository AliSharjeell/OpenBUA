export type RedditAssignment = { refId?: string; selector?: string; value: string; role?: 'title' | 'body' };

// Self-contained: Chrome executes this function in the page, without closures.
export async function inPageWriteRedditDraft(assignments: RedditAssignment[], verifyOnly = false) {
  const all = (selector: string, root: ParentNode = document): HTMLElement[] => {
    const nodes = Array.from(root.querySelectorAll<HTMLElement>(selector));
    for (const host of Array.from(root.querySelectorAll('*'))) if (host.shadowRoot) nodes.push(...all(selector, host.shadowRoot));
    return [...new Set(nodes)];
  };
  const visible = (el: HTMLElement) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const controls = () => all('input,textarea,[contenteditable="true"]').filter(visible);
  const marker = (el: HTMLElement) => [el.getAttribute('name'), el.id, el.getAttribute('aria-label'), el.getAttribute('placeholder')].filter(Boolean).join(' ').toLowerCase();
  const role = (el: HTMLElement): 'title' | 'body' | null => /\btitle\b/.test(marker(el)) ? 'title'
    : (el.tagName === 'TEXTAREA' && el.getAttribute('name') === 'text') || /\bbody\b|markdown|post text/.test(marker(el)) || el.isContentEditable ? 'body' : null;
  const read = (el: HTMLElement) => /^(INPUT|TEXTAREA)$/.test(el.tagName) ? (el as HTMLInputElement).value : el.innerText;
  const fold = (text: string) => text.replace(/\r\n?/g, '\n').replace(/[\u200B\uFEFF]/g, '').split('\n').map(line => line.trimEnd()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const result = { successCount: 0, errors: [] as string[], verifications: [] as Array<{ refId: string; selector?: string; requestedValue: string; actualValue: string; verified: boolean; elementFound: boolean }>, mode: 'unchanged' };
  if (verifyOnly) {
    let expected: { url: string; values: Record<string, string> } | null = null;
    try { expected = JSON.parse(document.documentElement.dataset.openbuaRedditDraft || 'null'); } catch {}
    if (!expected || expected.url !== location.href) return result;
    for (const [fieldRole, value] of Object.entries(expected.values)) {
      const targets = controls().filter(el => role(el) === fieldRole);
      if (targets.length !== 1 || fold(read(targets[0]) || '') !== fold(value)) result.errors.push(`${fieldRole} differs from the intended complete draft. Repair it with prepare_reddit_post before posting.`);
    }
    const titles = controls().filter(el => role(el) === 'title');
    if (titles.length !== 1 || !read(titles[0]).trim()) result.errors.push('The distinct post title is missing.');
    return result;
  }
  const resolved = assignments.map(item => {
    let candidates: HTMLElement[] = [];
    const eligible = (el: HTMLElement) => visible(el) || (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'file');
    if (item.refId) candidates = all(`[data-autoform-ref="${CSS.escape(item.refId)}"]`).filter(eligible);
    else if (item.selector) { try { candidates = all(item.selector).filter(eligible); } catch {} }
    else if (item.role) candidates = controls().filter(el => role(el) === item.role);
    const target = candidates.length === 1 ? candidates[0] : null;
    const fieldRole = target ? role(target) : null;
    return { item, target, fieldRole };
  });
  // Leave file-only batches to the normal upload path, including hidden inputs.
  if (resolved.length && resolved.every(({ target }) => target?.tagName === 'INPUT' && (target as HTMLInputElement).type === 'file')) {
    result.mode = 'file-input';
    return result;
  }
  // Validate every target before changing any field. Duplicate assignments to
  // the body cannot masquerade as distinct title/body fields.
  const oldFormFields = resolved.length && resolved.every(({ target, item }) => target && !item.role && !target.isContentEditable && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
  if (oldFormFields && resolved.some(({ fieldRole }) => !fieldRole)) {
    result.mode = 'native-form';
    return result;
  }
  if (resolved.some(entry => !entry.target || !entry.fieldRole || (entry.item.role && entry.item.role !== entry.fieldRole)) || new Set(resolved.map(entry => entry.target)).size !== resolved.length) {
    result.errors.push('Title and body must resolve to distinct, unambiguous post fields. Inspect the composer and use prepare_reddit_post; no text was inserted.');
    return result;
  }
  let previous: { url: string; values: Record<string, string> } | null = null;
  try { previous = JSON.parse(document.documentElement.dataset.openbuaRedditDraft || 'null'); } catch {}
  const values = previous?.url === location.href ? previous.values : {};
  for (const entry of resolved) values[entry.fieldRole!] = entry.item.value;
  document.documentElement.dataset.openbuaRedditDraft = JSON.stringify({ url: location.href, values });
  const settle = () => new Promise(resolve => setTimeout(resolve, 80));
  const setPlain = (target: HTMLElement, value: string) => {
    const proto = target.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(target, value);
    target.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: value }));
    target.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  };
  for (const entry of resolved) {
    const { item, fieldRole } = entry;
    let target = entry.target!;
    try {
      if (fieldRole === 'title' && /\n/.test(item.value)) throw new Error('Title must be a single line; keep paragraphs in the body.');
      if (fieldRole === 'body' && target.isContentEditable) {
        const markdown = all('button,[role="button"]').filter(visible).filter(el => /^switch to markdown(?: editor)?$/i.test((el.innerText || el.getAttribute('aria-label') || '').trim()));
        if (markdown.length === 1) {
          markdown[0].click();
          const end = Date.now() + 1200;
          do {
            await settle();
            const bodies = controls().filter(el => el.tagName === 'TEXTAREA' && role(el) === 'body');
            if (bodies.length === 1) { target = bodies[0]; break; }
          } while (Date.now() < end);
          if (target.isContentEditable) throw new Error('Markdown mode did not expose one body textarea. No body text was inserted.');
        }
      }
      if (/^(INPUT|TEXTAREA)$/.test(target.tagName)) {
        setPlain(target, item.value);
        result.mode = fieldRole === 'body' ? (target.getAttribute('name') === 'text' ? 'plain-text' : 'markdown') : result.mode;
      } else if (target.isContentEditable && fieldRole === 'body') {
        // Select only this editor's contents. Never use document-wide selectAll.
        target.focus();
        const root = target.getRootNode() as ShadowRoot & { getSelection?: () => Selection | null };
        const selection = root.getSelection?.() || document.getSelection();
        if (!selection) throw new Error('Could not establish a body-only selection.');
        const range = document.createRange(); range.selectNodeContents(target);
        selection.removeAllRanges(); selection.addRange(range);
        document.execCommand('delete'); await settle();
        if (fold(read(target))) throw new Error('Existing body was not cleared. No replacement appended.');
        const data = new DataTransfer(); data.setData('text/plain', item.value);
        const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        data.setData('text/html', item.value.replace(/\r\n?/g, '\n').split(/\n\n+/).map(paragraph => `<p>${escape(paragraph).replace(/\n/g, '<br>')}</p>`).join(''));
        const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true, composed: true });
        target.dispatchEvent(event); await settle();
        if (!event.defaultPrevented && !fold(read(target))) {
          // Plain contenteditable fallback: native paragraph commands preserve
          // breaks. Framework editors must accept their own paste handler.
          const lines = item.value.replace(/\r\n?/g, '\n').split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (i && !document.execCommand('insertParagraph')) throw new Error('Body editor rejected a paragraph break.');
            if (lines[i] && !document.execCommand('insertText', false, lines[i])) throw new Error('Body editor rejected text insertion.');
          }
        }
        result.mode = 'rich-text';
      } else throw new Error('Post title must be a native title input/textarea.');
      await settle();
      const actual = read(target) || '';
      const verified = fold(actual) === fold(item.value);
      result.verifications.push({ refId: item.refId || fieldRole!, selector: item.selector, requestedValue: item.value, actualValue: actual, verified, elementFound: true });
      if (verified) {
        result.successCount++;
        target.dataset.openbuaDraftExpected = item.value;
      } else {
        target.dataset.openbuaDraftExpected = item.value;
        result.errors.push(`Full ${fieldRole} verification failed. Inspect the current draft; do not append, submit, or blindly retype it.`);
      }
    } catch (error: any) {
      result.errors.push(error?.message || String(error));
      result.verifications.push({ refId: item.refId || fieldRole!, selector: item.selector, requestedValue: item.value, actualValue: read(target) || '', verified: false, elementFound: true });
    }
  }
  return result;
}

export async function writeRedditDraft(tabId: number, assignments: RedditAssignment[], verifyOnly = false) {
  const response = await chrome.scripting.executeScript({ target: { tabId }, args: [assignments, verifyOnly], func: inPageWriteRedditDraft });
  return response[0]?.result || { successCount: 0, errors: ['Reddit draft write could not be confirmed. Inspect before retrying.'], verifications: [] };
}
