import { writeRedditDraft } from './reddit-editor';
import { recordRedditOutcome, redditRemovalBlocker, redditDraftReviewBlocker } from './reddit-review';
import { getActiveSessionIdState } from '../services/storage';

// Runs in the page. Find the real submit control through custom-element shadows,
// report site validation, and never retry an unconfirmed submission automatically.
export async function inPageRedditSubmit(submit: boolean, remembered: { url: string; values: { title?: string; body?: string } } | null = null) {
  const all = (selector: string, root: ParentNode = document): HTMLElement[] => {
    const nodes = Array.from(root.querySelectorAll<HTMLElement>(selector));
    if (root instanceof Element && root.shadowRoot) nodes.push(...all(selector, root.shadowRoot));
    for (const host of Array.from(root.querySelectorAll('*'))) if (host.shadowRoot) nodes.push(...all(selector, host.shadowRoot));
    return [...new Set(nodes)];
  };
  const visible = (el: HTMLElement) => {
    if (!el.getClientRects().length) return false;
    for (let node: HTMLElement | null = el; node; node = node.assignedSlot || node.parentElement || (node.getRootNode() as ShadowRoot).host as HTMLElement || null) {
      const style = getComputedStyle(node);
      if (node.hidden || node.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    }
    return true;
  };
  const fold = (text: string) => text.replace(/\s+/g, ' ').trim();
  const result = (state: string, message: string, dispatched = false) => ({ state, message, dispatched, success: state === 'posted', postVerified: state === 'posted', url: location.href });
  let expected: { url: string; values: { title?: string; body?: string } } | null = null;
  try { expected = JSON.parse(document.documentElement.dataset.openbuaRedditDraft || 'null'); } catch {}
  if (!expected && !submit) expected = remembered;
  const errors = () => all('[role="alert"],[aria-invalid="true"],.error-message,.error,[data-testid*="error"],[slot="error"],faceplate-form-helper-text[error]')
    .filter(visible).map(el => fold(el.innerText || el.getAttribute('aria-label') || '')).filter(Boolean);
  const openPicker = () => all('r-post-flairs-modal,[role="dialog"][aria-label*="flair" i],[role="dialog"][aria-label*="tags" i]').find(modal =>
    all('button,[role="radio"],input[type="radio"],faceplate-radio-input,[role="switch"]', modal).some(visible)
  );
  const pickerBlocker = (dispatched = false) => {
    const modal = openPicker();
    if (!modal) return null;
    const choices = all('[role="radio"],input[type="radio"],faceplate-radio-input,[role="option"]', modal).filter(visible);
    if (choices.length) return flairBlocked(dispatched);
    return { ...result('blocked', 'The optional tags dialog is open, but no selectable flair options are available. NSFW and Brand affiliate switches are tags, not flair. Do not invent a flair or turn on unrelated tags. Close the dialog with Cancel or its close button, then submit_reddit_post. Only a site validation error can establish that flair is required.', dispatched), validationBlocked: true, requirement: 'close_tags_dialog' };
  };
  const flairBlocked = (dispatched = false) => ({ ...result('blocked', 'Reddit requires a flair selection. Inspect get_active_tab_form selectionControls, choose the relevant option by refId, verify SELECTED, then click Add/Apply and verify the picker closes. After fixing this validation requirement, submit_reddit_post may be used again.', dispatched), validationBlocked: true, requirement: 'flair' });
  const publication = (): { url: string; node: HTMLElement | null } | null => {
    if (!expected?.values.title) return null;
    const matches = (el: HTMLElement) => visible(el) && fold(el.getAttribute('post-title') || el.innerText || '') === fold(expected!.values.title!);
    if (/\/comments\/[^/]+/.test(location.pathname) && all('h1,shreddit-post[post-title],.thing.link a.title').some(matches)) return { url: location.href, node: null };
    // Modern Reddit may return to the community feed after publishing. Require
    // its created post ID AND the matching visible card/title/permalink.
    const created = new URL(location.href).searchParams.get('created')?.match(/^t3_([a-z0-9]+)$/i)?.[1];
    if (!created) return null;
    for (const card of all('shreddit-post[post-title],.thing.link').filter(visible)) {
      const title = card.getAttribute('post-title') || card.querySelector('a.title,h1,h2,h3')?.textContent || '';
      if (fold(title) !== fold(expected.values.title)) continue;
      const hrefs = [card.getAttribute('permalink'), ...Array.from(card.querySelectorAll('a[href]')).map(link => link.getAttribute('href'))];
      for (const href of hrefs) {
        if (!href) continue;
        try {
          const url = new URL(href, location.href);
          if (url.origin === location.origin && url.pathname.match(/\/comments\/([a-z0-9]+)(?:\/|$)/i)?.[1] === created) return { url: url.href, node: card };
        } catch {}
      }
    }
    return null;
  };
  const posted = () => Boolean(publication());
  const confirmed = (dispatched = false) => ({ ...result('posted', 'Reddit confirms the matching created post and permalink with no removal notice observed. Later moderation remains possible.', dispatched), url: publication()!.url, submitted: true });
  const closestComposed = (element: HTMLElement, selector: string): HTMLElement | null => {
    let cursor: HTMLElement | null = element;
    while (cursor) {
      if (cursor.matches(selector)) return cursor;
      cursor = cursor.assignedSlot || cursor.parentElement || (cursor.getRootNode() as ShadowRoot).host as HTMLElement || null;
    }
    return null;
  };
  const moderation = (dispatched = false) => {
    const published = publication();
    if (!published) return null;
    const notice = all('p,div,span,[role="alert"],shreddit-post-removal-notice').filter(visible).find(el => {
      // Never interpret a quote in the submitted body or a neighbouring post as
      // moderation of this permalink. Match the complete notice, not substrings.
      if (closestComposed(el, '.usertext-body,[slot="text-body"],shreddit-post-text-body,[data-testid="post-content"],blockquote')) return false;
      const owner = closestComposed(el, 'shreddit-post,.thing.link,article');
      if (published.node && owner !== published.node) return false;
      if (owner) {
        const ownerTitle = owner.getAttribute('post-title') || owner.querySelector('h1,a.title')?.textContent;
        if (ownerTitle && fold(ownerTitle) !== fold(expected!.values.title!)) return false;
      }
      return /^(?:sorry,?\s+)?this post (?:was|has been|is) removed (?:by|due to) (?:reddit|the moderators|moderators)/i.test(fold(el.innerText || el.textContent || '')) &&
        fold(el.innerText || el.textContent || '').length < 400;
    });
    return notice ? { ...result('removed', `Submitted, but removed: ${fold(notice.innerText || notice.textContent || '')}. Stop this batch; do not repost. The notice does not establish an account-wide restriction or the exact cause.`, dispatched), url: published.url, submitted: true, removalEvidence: fold(notice.innerText || notice.textContent || '') } : null;
  };
  const rateLimit = (dispatched = false) => {
    const notice = all('p,div,span,faceplate-form-helper-text,[role="alert"],[slot*="error"]').filter(visible).find(el => {
      if (closestComposed(el, '[contenteditable="true"],.usertext-body,[slot="text-body"],shreddit-post-text-body,blockquote')) return false;
      const text = fold(el.innerText || el.textContent || '');
      return text.length < 400 && /^(?:rate limit exceeded|you(?:'|’)?re doing that too much|try again in \d+)/i.test(text);
    });
    if (!notice) return null;
    const evidence = fold(notice.innerText || notice.textContent || '');
    const duration = evidence.match(/(?:wait|in)\s+(\d+)\s*(second|minute|hour)s?/i);
    const retryAfterSeconds = duration ? Number(duration[1]) * ({ second: 1, minute: 60, hour: 3600 }[duration[2].toLowerCase()] || 1) : null;
    return { ...result('rate_limited', `Reddit posting is rate limited: ${evidence}. Preserve the draft and report the cooldown. Do not repeatedly wait_seconds, retry Post, or continue this posting batch.`, dispatched), retryAfterSeconds, rateLimitEvidence: evidence };
  };
  const removed = moderation();
  if (removed) return removed;
  if (posted()) return confirmed();
  const limited = rateLimit();
  if (limited) return limited;
  const messages = errors();
  const picker = pickerBlocker();
  if (picker) return picker;
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
    if (posted()) return confirmed(true);
    const limited = rateLimit(true);
    if (limited) return limited;
    // Reddit can reject the attempt by opening its flair picker without an
    // alert. This is validation, not an uncertain publication or a duplicate.
    const picker = pickerBlocker(true);
    if (picker) {
      delete document.documentElement.dataset.openbuaRedditSubmitAttempt;
      return picker;
    }
    const failures = errors();
    if (failures.length) {
      delete document.documentElement.dataset.openbuaRedditSubmitAttempt; // Rejected, not an uncertain success.
      return result('blocked', `Reddit rejected the post: ${failures.join('; ')}. Fix this requirement before another attempt.`, true);
    }
  } while (Date.now() < deadline);
  return result('unconfirmed', 'Post click dispatched, but Reddit has not confirmed publication. Use verify_reddit_post once; do not click Post again or claim success.', true);
}

const rememberedDrafts = new Map<number, { url: string; values: { title?: string; body?: string } }>();
const cooldowns = new Map<string, { until: number | null; evidence: string }>();
export function redditPostingCooldown() {
  const known = cooldowns.get(getActiveSessionIdState() || 'default');
  if (!known || (known.until !== null && known.until <= Date.now())) return null;
  return { success: false, state: 'rate_limited', dispatched: false, postVerified: false, retryAfterSeconds: known.until === null ? null : Math.ceil((known.until - Date.now()) / 1000), message: `Reddit reported a posting cooldown: ${known.evidence}. Preserve the draft and report it; do not loop on waits, retries or other posting destinations. An unspecified expiry is unknown; inspect later rather than inventing a reset time.` };
}
export async function redditPostAction(tabId: number, submit: boolean) {
  if (submit) {
    const cooldown = redditPostingCooldown();
    if (cooldown) return cooldown;
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
  if (outcome?.state === 'rate_limited') {
    const duration = 'retryAfterSeconds' in outcome && typeof outcome.retryAfterSeconds === 'number' ? outcome.retryAfterSeconds : null;
    const evidence = 'rateLimitEvidence' in outcome && typeof outcome.rateLimitEvidence === 'string' ? outcome.rateLimitEvidence : outcome.message;
    cooldowns.set(getActiveSessionIdState() || 'default', { until: duration === null ? null : Date.now() + Math.max(1, duration) * 1000, evidence });
  }
  const draft = rememberedDrafts.get(tabId);
  if (outcome && draft) recordRedditOutcome(draft, outcome.state, outcome.url);
  return outcome || { success: false, state: 'unconfirmed', dispatched: false, postVerified: false, message: 'Could not verify Reddit state. Inspect before any retry.' };
}
