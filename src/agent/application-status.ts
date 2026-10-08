export interface ApplicationStatus {
  state: 'submitted' | 'rejected' | 'in-progress' | 'unconfirmed' | 'not-applicable';
  evidence: string;
  actions: string[];
  url?: string;
  feedback?: string[];
}

// Serialized by Chrome: keep DOM helpers inside this function.
function inPageApplicationStatus(ignoredFeedback: string[] | null = null): ApplicationStatus {
  const visible = (element: Element): boolean => element.getClientRects().length > 0
    && getComputedStyle(element).visibility !== 'hidden' && !element.closest('[aria-hidden="true"]');
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"], dialog[open], [aria-modal="true"]')).filter(visible);
  const dialog = dialogs.find(element => {
    const heading = element.querySelector('h1, h2, h3, [role="heading"]');
    const label = element.getAttribute('aria-label') || heading?.textContent || '';
    return /apply to|job application|contact info|review your application|share your profile/i.test(label)
      || Boolean(element.querySelector('[data-test-modal-id*="easy-apply"], .jobs-easy-apply-content'));
  });
  const feedback = Array.from(document.querySelectorAll('[role="alert"], [role="status"], .artdeco-toast-item, .artdeco-inline-feedback')).filter(visible);
  const detail = document.querySelector('.jobs-search__job-details--container, .jobs-details, [data-application-form]');
  const pageText = detail ? (detail as HTMLElement).innerText || '' : '';
  const isApplication = /\/jobs(?:\/|\?|$)|careers|application|apply/i.test(location.href) || Boolean(dialog);
  if (!isApplication) return { state: 'not-applicable', evidence: '', actions: [] };
  const feedbackMessages = feedback.map(element => (element as HTMLElement).innerText || '');
  const feedbackText = feedbackMessages.filter(text => !ignoredFeedback?.includes(text)).join('\n');
  const context = {url: location.href, feedback: feedbackMessages};
  const scopeText = dialog ? (dialog as HTMLElement).innerText || '' : '';
  const actions = dialog ? Array.from(dialog.querySelectorAll('button, input[type="submit"], [role="button"]'))
    .filter(visible).map(element => ((element as HTMLElement).innerText || element.getAttribute('value') || element.getAttribute('aria-label') || '').trim())
    .filter(Boolean) : [];
  const closed = /(?:this|the)\s+(?:job|position)\s+(?:is\s+)?(?:now\s+)?closed|(?:job|position)\s+is\s+no longer available|no longer accepting applications|applications?\s+(?:are|is)\s+closed/i;
  const submitted = /(?:your\s+)?application\s+(?:(?:has been|was|is)\s+)?(?:successfully\s+)?(?:submitted|sent)|successfully applied/i;
  const rejection = /(?:application|submission)\s+(?:(?:has|was|is)\s+)?(?:failed|rejected)|unable to submit|could(?:n['’]t| not) submit|failed to submit|something went wrong|please try again|please (?:fill|complete|enter|select)|required field|invalid (?:email|phone)/i;
  const rejected = (dialog || ignoredFeedback !== null || submitted.test(feedbackText) ? feedbackText.match(closed) : null) || scopeText.match(closed) || pageText.match(closed)
    || feedbackText.match(rejection) || scopeText.match(rejection);
  if (rejected) return { state: 'rejected', evidence: rejected[0], actions, ...context };
  // Success must come from a visible confirmation, not an Applied badge in
  // a background job list or a successful click dispatch.
  const confirmation = feedbackText.match(submitted) || scopeText.match(submitted);
  if (confirmation) return { state: 'submitted', evidence: confirmation[0], actions, ...context };
  if (dialog) {
    const progress = scopeText.match(/\b\d{1,3}%/);
    const heading = scopeText.match(/contact info|resume|additional questions|review your application|review/i);
    return { state: 'in-progress', evidence: [heading?.[0], progress?.[0]].filter(Boolean).join(' · ') || 'Application dialog is still open', actions, ...context };
  }
  return { state: 'unconfirmed', evidence: 'No visible application submission confirmation', actions, ...context };
}

export async function inspectApplicationStatus(tabId: number, waitForUpdate = false, ignoredFeedback: string[] | null = null): Promise<ApplicationStatus> {
  const unavailable: ApplicationStatus = {state:'unconfirmed',evidence:'Could not inspect application outcome; verify the page before claiming submission',actions:[]};
  if (typeof chrome === 'undefined' || !chrome.scripting) return unavailable;
  let latest = unavailable;
  for (const delay of waitForUpdate ? [100, 300, 700] : [0]) {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    try {
      const results = await chrome.scripting.executeScript({target:{tabId},func:inPageApplicationStatus,args:[ignoredFeedback]});
      latest = results[0]?.result || unavailable;
      if (['submitted','rejected','not-applicable'].includes(latest.state)) break;
    } catch { return unavailable; }
  }
  return latest;
}

export function describeApplicationStatus(status: ApplicationStatus): string {
  switch (status.state) {
    case 'submitted': return `Application submission VERIFIED by the website: ${status.evidence}.`;
    case 'rejected': return `Application NOT submitted. The website reports: "${status.evidence}". Report this blocker accurately; do not claim success or repeatedly click Submit.`;
    case 'in-progress': return `Application NOT submitted; current page: ${status.evidence}. Visible actions: ${status.actions.join(', ') || 'none'}. Inspect this current step and advance normally. Do not use earlier screenshots or remembered review fields as proof this step is complete.`;
    case 'unconfirmed': return `${status.evidence}. A click is not submission confirmation. Inspect the page or capture a screenshot; do not claim the application was submitted.`;
    default: return '';
  }
}

/** Keep the final user-facing report consistent with the observed website. */
export function guardApplicationReport(text: string, status: ApplicationStatus | null): string {
  if (!status || status.state === 'submitted' || status.state === 'not-applicable') return text;
  if (!text.trim()) return text;
  const claimsCompletion = /(?:successfully\s+)?(?:submitted|applied)|submitting now|application\s+(?:is\s+)?(?:sent|complete)/i.test(text);
  const acknowledgesFailure = /not submitted|wasn['\u2019]t submitted|could(?:n['\u2019]t| not) submit|unable to submit|job.*closed|submission.*(?:failed|unconfirmed)/i.test(text);
  if (text.trim() && (!claimsCompletion || acknowledgesFailure)) return text;
  if (status.state === 'rejected') return `The application was not submitted. The website reported: "${status.evidence}".`;
  if (status.state === 'in-progress') return `The application has not been submitted. It is still at ${status.evidence}. Visible actions: ${status.actions.join(', ') || 'none'}.`;
  return 'The application submission is unconfirmed. The website has not shown a success confirmation.';
}
