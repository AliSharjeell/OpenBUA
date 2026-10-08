import { writeRedditDraft } from './reddit-editor';
import { recordRedditOutcome, redditRemovalBlocker, redditDraftReviewBlocker } from './reddit-review';

// Runs in the page. Find the real submit control through custom-element shadows,
// report site validation, and never retry an unconfirmed submission automatically.
export async function inPageRedditSubmit(submit: boolean, remembered: { url: string; values: { title?: string; body?: string } } | null = null) {
  const all = (selector: string, root: ParentNode = document): HTMLElement[] => {
    const nodes = Array.from(root.querySelectorAll<HTMLElement>(selector));
    for (const host of Array.from(root.querySelectorAll('*'))) if (host.shadowRoot) nodes.push(...all(selector, host.shadowRoot));
    return [...new Set(nodes)];
  };
  const visible = (el: HTMLElement) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const fold = (text: string) => text.replace(/\s+/g, ' ').trim();
  const result = (state: string, message: string, dispatched = false) => ({ state, message, dispatched, success: state === 'posted', postVerified: state === 'posted', url: location.href });
  let expected: { url: string; values: { title?: string; body?: string } } | null = null;
  try { expected = JSON.parse(document.documentElement.dataset.openbuaRedditDraft || 'null'); } catch {}
  if (!expected && !submit) expected = remembered;
  const errors = () => all('[role="alert"],[aria-invalid="true"],.error-message,.error,[data-testid*="error"],[slot="error"],faceplate-form-helper-text[error]')
    .filter(visible).map(el => fold(el.innerText || el.getAttribute('aria-label') || '')).filter(Boolean);
  const posted = () => Boolean(expected?.values.title && /\/comments\/[^/]+/.test(location.pathname) &&
    all('h1,shreddit-post[post-title],.thing.link a.title').some(el => visible(el) && fold(el.getAttribute('post-title') || el.innerText || '') === fold(expected!.values.title!)));
  const closestComposed = (element: HTMLElement, selector: string): HTMLElement | null => {
    let cursor: HTMLElement | null = element;
    while (cursor) {
      if (cursor.matches(selector)) return cursor;
      cursor = cursor.assignedSlot || cursor.parentElement || (cursor.getRootNode() as ShadowRoot).host as HTMLElement || null;
    }
    return null;
  };
  const moderation = (dispatched = false) => {
    if (!posted()) return null;
    const notice = all('p,div,span,[role="alert"],shreddit-post-removal-notice').filter(visible).find(el => {
      // Never interpret a quote in the submitted body or a neighbouring post as
      // moderation of this permalink. Match the complete notice, not substrings.
      if (closestComposed(el, '.usertext-body,[slot="text-body"],shreddit-post-text-body,[data-testid="post-content"],blockquote')) return false;
      const owner = closestComposed(el, 'shreddit-post,.thing.link,article');
      if (owner) {
        const ownerTitle = owner.getAttribute('post-title') || owner.querySelector('h1,a.title')?.textContent;
        if (ownerTitle && fold(ownerTitle) !== fold(expected!.values.title!)) return false;
      }
      return /^(?:sorry,?\s+)?this post (?:was|has been|is) removed (?:by|due to) (?:reddit|the moderators|moderators)/i.test(fold(el.innerText || el.textContent || '')) &&
        fold(el.innerText || el.textContent || '').length < 400;
    });
    return notice ? { ...result('removed', `Submitted, but removed: ${fold(notice.innerText || notice.textContent || '')}. Stop this batch; do not repost. The notice does not establish an account-wide restriction or the exact cause.`, dispatched), submitted: true, removalEvidence: fold(notice.innerText || notice.textContent || '') } : null;
  };
  const removed = moderation();
  if (removed) return removed;
  if (posted()) return result('posted', 'Reddit opened the matching permalink with no removal notice observed. Later moderation remains possible.');
  const messages = errors();
  if (!submit) return messages.length ? result('blocked', `Reddit reports: ${messages.join('; ')}. Fix the requirement; do not re-click Post.`)
    : result('unconfirmed', 'No published post confirmation yet. Do not click Post again or claim success. Inspect the current page for a site requirement or pending request.');
  if (!expected?.values.title || expected.url !== location.href) return result('blocked', 'Prepare and verify the complete title/body with prepare_reddit_post first. No Post click dispatched.');
  if (document.documentElement.dataset.openbuaRedditSubmitAttempt === JSON.stringify(expected)) return result('unconfirmed', 'A submission was already dispatched for this draft. Use verify_reddit_post; do not submit it again.');
  if (messages.length) return result('blocked', `Reddit reports: ${messages.join('; ')}. No Post click dispatched.`);
  const label = (el: HTMLElement) => fold(el.getAttribute('aria-label') || el.innerText || (el as HTMLInputElement).value ||
    Array.from(el.querySelectorAll('slot')).map(slot => slot.assignedNodes({ flatten: true }).map(node => node.textContent || '').join('')).join(' ') || el.textContent || '');
  const buttons = all('button,[role="button"],input[type="submit"],r-post-form-submit-button').filter(visible)
    .filter(el => {
      // The component owns both actions. Ownership is not evidence of Post:
      // never include Save Draft, even when it lives in the same shadow root.
      if (/save.?draft/i.test(el.id) || /^(?:save draft|drafts?|cancel)$/i.test(label(el))) return false;
      const oldSubmit = el.closest('form#newlink') && /^(?:post|submit)$/i.test(label(el));
      return el.tagName === 'R-POST-FORM-SUBMIT-BUTTON' || el.id === 'inner-post-submit-button' || /^post$/i.test(label(el)) || oldSubmit;
    });
  // A single visible Post may expose a custom host, role=button wrapper and
  // native button. Collapse ancestors across light DOM, slots and shadows.
  const parent = (el: HTMLElement): HTMLElement | null => el.assignedSlot || el.parentElement || ((el.getRootNode() as ShadowRoot).host as HTMLElement | undefined) || null;
  const containsControl = (outer: HTMLElement, inner: HTMLElement) => {
    let cursor = parent(inner);
    while (cursor) { if (cursor === outer) return true; cursor = parent(cursor); }
    return false;
  };
  const candidates = buttons.filter(el => !buttons.some(other => other !== el && containsControl(el, other)));
  if (candidates.length !== 1) {
    const controls = candidates.map(el => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} (${fold(el.innerText || el.getAttribute('aria-label') || '') || 'slotted Post'})`).join('; ');
    return result('blocked', `Found ${candidates.length} independent Post controls after collapsing nested wrappers: ${controls || 'none'}. No click was dispatched. Do not bypass this with coordinates or repeat clicks; inspect the composer once and report the ambiguity if unresolved.`);
  }
  const target = candidates[0];
  const disabled = (el: HTMLElement) => el.hasAttribute('disabled') || el.hasAttribute('inert') || el.getAttribute('aria-disabled') === 'true';
  let cursor: HTMLElement | null = target;
  while (cursor) {
    if (disabled(cursor)) return result('blocked', 'Reddit Post is disabled. Check required flair/tags, community selection, title/body validation, sign-in or CAPTCHA. Do not keep clicking Post.');
    cursor = parent(cursor);
  }
  const invalid = all('input,textarea,select').filter(visible).find(el => !(el as HTMLInputElement).checkValidity());
  if (invalid) return result('blocked', `Required field is invalid: ${invalid.getAttribute('aria-label') || invalid.getAttribute('name') || invalid.id || 'unnamed field'}. ${(invalid as HTMLInputElement).validationMessage}`);
  document.documentElement.dataset.openbuaRedditSubmitAttempt = JSON.stringify(expected);
  target.click();
  const deadline = Date.now() + 4000;
  do {
    await new Promise(resolve => setTimeout(resolve, 150));
    const removed = moderation(true);
    if (removed) return removed;
    if (posted()) return result('posted', 'Reddit opened the matching permalink with no removal notice observed. Later moderation remains possible.', true);
    const failures = errors();
    if (failures.length) {
      delete document.documentElement.dataset.openbuaRedditSubmitAttempt; // Rejected, not an uncertain success.
      return result('blocked', `Reddit rejected the post: ${failures.join('; ')}. Fix this requirement before another attempt.`, true);
    }
  } while (Date.now() < deadline);
  return result('unconfirmed', 'Post click dispatched, but Reddit has not confirmed publication. Use verify_reddit_post once; do not click Post again or claim success.', true);
}

const rememberedDrafts = new Map<number, { url: string; values: { title?: string; body?: string } }>();
export async function redditPostAction(tabId: number, submit: boolean) {
  if (submit) {
    const blocker = redditRemovalBlocker();
    if (blocker) return { success: false, state: 'blocked', dispatched: false, postVerified: false, message: blocker };
    const draft = await writeRedditDraft(tabId, [], true);
    if (draft.errors.length) return { success: false, state: 'blocked', dispatched: false, postVerified: false, message: draft.errors.join('\n') };
    const capture = await chrome.scripting.executeScript({ target: { tabId }, func: () => {
      try { return JSON.parse(document.documentElement.dataset.openbuaRedditDraft || 'null'); } catch { return null; }
    } });
    if (capture[0]?.result) {
      const blocker = redditDraftReviewBlocker(tabId, capture[0].result);
      if (blocker) return { success: false, state: 'blocked', dispatched: false, postVerified: false, message: blocker };
      rememberedDrafts.set(tabId, capture[0].result);
    }
  }
  let results;
  try { results = await chrome.scripting.executeScript({ target: { tabId }, func: inPageRedditSubmit, args: [submit, rememberedDrafts.get(tabId) || null] }); }
  catch (error) {
    if (!submit) throw error;
    // Navigation can destroy the injected execution context after a successful
    // click. Re-read the new document without clicking or assuming success.
    results = await chrome.scripting.executeScript({ target: { tabId }, func: inPageRedditSubmit, args: [false, rememberedDrafts.get(tabId) || null] });
  }
  const outcome = results[0]?.result;
  const draft = rememberedDrafts.get(tabId);
  if (outcome && draft) recordRedditOutcome(draft, outcome.state, outcome.url);
  return outcome || { success: false, state: 'unconfirmed', dispatched: false, postVerified: false, message: 'Could not verify Reddit state. Inspect before any retry.' };
}
