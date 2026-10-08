// Serialized into the page: single native activation, no message timeout fallback.
export async function inPageXCommunity(action: 'join' | 'confirm' | 'verify') {
  const id = location.pathname.match(/^\/i\/communities\/(\d+)(?:\/|$)/)?.[1];
  const result = (state: string, message: string, dispatched = false, rules = '') => ({ state, message, dispatched, rules, success: state === 'joined', membershipVerified: state === 'joined', communityId: id || null, url: location.href });
  if (!id) return result('blocked', 'Open the actual /i/communities/<id> page first, not the @communities profile.');
  const all = (selector: string, root: ParentNode = document): HTMLElement[] => {
    const nodes = Array.from(root.querySelectorAll<HTMLElement>(selector));
    for (const host of Array.from(root.querySelectorAll('*'))) if (host.shadowRoot) nodes.push(...all(selector, host.shadowRoot));
    return nodes;
  };
  const visible = (el: HTMLElement) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const label = (el: HTMLElement) => (el.innerText || el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim();
  const buttons = () => all('button,[role="button"]').filter(visible);
  const dialog = () => all('[role="dialog"],[aria-modal="true"],dialog[open]').find(visible);
  const inside = (el: HTMLElement, outer: HTMLElement) => {
    let cursor: HTMLElement | null = el;
    while (cursor) {
      if (cursor === outer) return true;
      cursor = cursor.assignedSlot || cursor.parentElement || (cursor.getRootNode() as ShadowRoot).host as HTMLElement || null;
    }
    return false;
  };
  const read = (dispatched = false) => {
    const modal = dialog();
    if (modal) {
      if (buttons().some(el => inside(el, modal) && /^agree and join$/i.test(label(el)))) return result('rules_required', 'Join opened community rules. Read these constraints, then use join_x_community with confirmRules:true once if appropriate. Do not click Join again or dismiss the dialog.', dispatched, (modal.innerText || modal.textContent || '').slice(0, 12000));
      return result('blocked', 'An active dialog requires input. Inspect its actual fields; do not dismiss it and repeatedly click Join.', dispatched, (modal.innerText || modal.textContent || '').slice(0, 12000));
    }
    const membership = buttons().filter(el => !el.closest('article,[data-testid="tweet"],aside'));
    if (membership.some(el => /^(?:leave|joined|member)$/i.test(label(el)))) return result('joined', 'Community membership is confirmed by the current Leave/Joined control. Do not click that control: it would undo joining.', dispatched);
    if (membership.some(el => /^(?:requested|pending|cancel request|request pending)$/i.test(label(el)))) return result('requested', 'Membership request is pending moderator approval. Record requested, not joined; do not click again or cancel the request.', dispatched);
    const errors = all('[role="alert"],[data-testid="toast"]').filter(visible).map(label).filter(Boolean);
    if (errors.length) return result('blocked', `X reports: ${errors.join('; ')}. Stop this attempt; do not keep clicking.`, dispatched);
    return result('unconfirmed', 'No membership confirmation yet. Verify once or report the blocker; do not retry Join or switch methods.', dispatched);
  };
  const initial = read();
  if (action === 'verify' || ['joined', 'requested'].includes(initial.state)) return initial;
  if (initial.state === 'blocked') return initial;
  if (initial.state === 'rules_required' && action !== 'confirm') return initial;
  if (action === 'confirm' && initial.state !== 'rules_required') return result('blocked', 'No visible Agree and join rules dialog. Do not click the underlying Join button.');
  let attempts: Record<string, string[]> = {};
  try { attempts = JSON.parse(document.documentElement.dataset.openbuaXCommunityAttempts || '{}'); } catch {}
  const phase = action;
  if (attempts[id]?.includes(phase)) return result('unconfirmed', 'This community join stage was already dispatched. Use verifyOnly:true; no repeated Join/Agree click was dispatched.');
  const modal = dialog();
  const matches = buttons().filter(el => action === 'confirm'
    ? Boolean(modal && inside(el, modal) && /^agree and join$/i.test(label(el)))
    : !el.closest('article,[data-testid="tweet"],aside') && /^(?:join|request to join|ask to join)$/i.test(label(el)));
  const targets = matches.filter(el => !matches.some(other => other !== el && inside(other, el)));
  if (targets.length !== 1) return result('blocked', `Found ${targets.length} independent community join controls. No click dispatched; inspect once instead of guessing coordinates.`);
  const target = targets[0];
  let cursor: HTMLElement | null = target;
  while (cursor) {
    if (cursor.matches(':disabled,[disabled],[aria-disabled="true"],[inert]')) return result('blocked', 'The community join control is disabled. No click dispatched.');
    cursor = cursor.assignedSlot || cursor.parentElement || (cursor.getRootNode() as ShadowRoot).host as HTMLElement || null;
  }
  attempts[id] = [...(attempts[id] || []), phase];
  document.documentElement.dataset.openbuaXCommunityAttempts = JSON.stringify(Object.fromEntries(Object.entries(attempts).slice(-100)));
  target.click();
  const deadline = Date.now() + 2500;
  do {
    await new Promise(resolve => setTimeout(resolve, 100));
    const outcome = read(true);
    if (outcome.state !== 'unconfirmed') return outcome;
  } while (Date.now() < deadline);
  return read(true);
}

const pending = new Map<number, Promise<any>>();
export async function xCommunityAction(tabId: number, action: 'join' | 'confirm' | 'verify') {
  if (pending.has(tabId)) return { success: false, dispatched: false, state: 'pending', message: 'A community operation is still running. Do not dispatch another click; verify its result.' };
  const run = chrome.scripting.executeScript({ target: { tabId }, func: inPageXCommunity, args: [action] });
  pending.set(tabId, run);
  try { return (await run)[0]?.result || { success: false, state: 'unconfirmed', dispatched: false, message: 'No community result received. Verify without clicking again.' }; }
  finally { pending.delete(tabId); }
}

export async function interceptXCommunityClick(tab: { id: number; url?: string }, params: { refId?: string; selector?: string; text?: string; x?: number; y?: number }) {
  if (!/^https:\/\/(?:www\.)?(?:x|twitter)\.com\/i\/communities\/\d+(?:\/|\?|$)/i.test(tab.url || '') || /^leave$/i.test(params.text || '')) return null;
  const targets = await chrome.scripting.executeScript({ target: { tabId: tab.id }, args: [params], func: (request: typeof params) => {
    const all = (selector: string, root: ParentNode = document): HTMLElement[] => {
      const nodes = Array.from(root.querySelectorAll<HTMLElement>(selector));
      for (const host of Array.from(root.querySelectorAll('*'))) if (host.shadowRoot) nodes.push(...all(selector, host.shadowRoot));
      return nodes;
    };
    const text = (el: Element) => (el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
    let target: Element | null = null;
    try {
      if (request.refId) target = all(`[data-autoform-ref="${CSS.escape(request.refId)}"]`)[0];
      else if (request.selector) target = all(request.selector)[0];
      else if (request.text) target = all('button,[role="button"]').find(el => text(el).toLowerCase() === request.text!.toLowerCase()) || null;
      else if (request.x !== undefined && request.y !== undefined) target = document.elementFromPoint(request.x / devicePixelRatio, request.y / devicePixelRatio);
    } catch {}
    const button = target?.closest('button,[role="button"]');
    return button && !button.closest('article,[data-testid="tweet"],aside') ? text(button) : '';
  } });
  const label = targets[0]?.result || params.text || '';
  if (!/^(?:join|request to join|ask to join|agree and join|leave|joined|member|requested|pending|cancel request|request pending)$/i.test(label)) return null;
  return xCommunityAction(tab.id, /^agree and join$/i.test(label) ? 'confirm' : /^(?:leave|joined|member|requested|pending|cancel request|request pending)$/i.test(label) ? 'verify' : 'join');
}
