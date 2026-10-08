import { inspectApplicationStatus, type ApplicationStatus } from './application-status';

export interface ApplicationActionContext {
  tabId: number;
  before: ApplicationStatus;
  token: string;
}

// Run in MAIN so popup calls made by the site's own handler are observable.
// The original handler still runs exactly once; only a blocked HTTP destination
// may be handed back to the extension for opening with chrome.tabs.
function armAction(token: string) {
  const host = window as any;
  host.__openbuaApplicationAction?.cleanup();
  const original = window.open;
  const state = { token, label: '', submission: false, external: false, popupAttempted: false, blockedUrl: '', cleanup: () => {} };
  const onClick = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target.closest('button, a, [role="button"], input[type="submit"]') : null;
    if (!target) return;
    state.label = (target.getAttribute('aria-label') || target.textContent || target.getAttribute('value') || '').trim();
    state.submission = /^(?:submit|send)(?:\s+(?:my|your|the))?\s+application\b|^apply now$/i.test(state.label);
    const dialog = target.closest('[role="dialog"], dialog, [aria-modal="true"]');
    state.external = /^apply(?:\s+on\s+company\s+website)?$/i.test(state.label)
      || (/^continue$/i.test(state.label) && /share your profile/i.test(dialog?.textContent || ''));
  };
  document.addEventListener('click', onClick, true);
  const wrapped: typeof window.open = function (...args) {
    const opened = original.apply(window, args);
    if (state.external) state.popupAttempted = true;
    if (!opened && state.external && args[0]) {
      try {
        const url = new URL(String(args[0]), location.href);
        if (/^https?:$/.test(url.protocol)) state.blockedUrl = url.href;
      } catch { /* No navigation without an explicit valid destination. */ }
    }
    return opened;
  };
  window.open = wrapped;
  const timer = setTimeout(() => state.cleanup(), 2000);
  state.cleanup = () => {
    clearTimeout(timer);
    document.removeEventListener('click', onClick, true);
    if (window.open === wrapped) window.open = original;
  };
  host.__openbuaApplicationAction = state;
}

export async function prepareApplicationAction(tabId: number): Promise<ApplicationActionContext> {
  const before = await inspectApplicationStatus(tabId);
  const token = `${Date.now()}-${Math.random()}`;
  try { await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:armAction,args:[token]}); } catch { /* Inspection still works if MAIN is unavailable. */ }
  return {tabId, before, token};
}

export async function finishApplicationAction(context: ApplicationActionContext) {
  const empty = {label:'',submission:false,external:false,blockedUrl:''};
  try {
    const results = await chrome.scripting.executeScript({target:{tabId:context.tabId},world:'MAIN',args:[context.token],func:async (token: string) => {
      const state = (window as any).__openbuaApplicationAction;
      if (!state || state.token !== token) return null;
      // Profile-sharing may finish asynchronously before opening the company
      // website. Ordinary navigation has no added delay.
      if (state.external) {
        const deadline = Date.now() + 600;
        while (!state.popupAttempted && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
      }
      state.cleanup();
      delete (window as any).__openbuaApplicationAction;
      return {label:state.label,submission:state.submission,external:state.external,blockedUrl:state.blockedUrl};
    }});
    return results[0]?.result || empty;
  } catch { return empty; }
}
