// Self-contained for chrome.scripting injection: expose ARIA/custom choices
// that ordinary input inspection misses, including controls in shadow roots.
export function inPageSelectionControls(selector = '') {
  const roots = (root: ParentNode): ParentNode[] => {
    const result = [root];
    if (root instanceof Element && root.shadowRoot) result.push(...roots(root.shadowRoot));
    for (const host of Array.from(root.querySelectorAll('*'))) if (host.shadowRoot) result.push(...roots(host.shadowRoot));
    return result;
  };
  const all = (query: string, root: ParentNode = document): HTMLElement[] => [...new Set(roots(root).flatMap(scope => Array.from(scope.querySelectorAll<HTMLElement>(query))))];
  const visible = (node: HTMLElement) => node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden' && getComputedStyle(node).display !== 'none';
  const scopeVisible = (node: HTMLElement) => visible(node) || all('button,label,[role="radio"],[role="option"]', node).some(visible);
  const scopes = all('[role="dialog"],[role="listbox"],[role="menu"],[aria-modal="true"],r-post-flairs-modal').filter(scopeVisible);
  let scope: ParentNode = document;
  let scopeFound = true;
  if (selector) {
    let match: HTMLElement | undefined;
    try { match = all(selector).find(scopeVisible); } catch {}
    scopeFound = Boolean(match);
    // Custom popups may lack role=dialog. Explain the mismatch and return the
    // actual popup controls instead of an apparently empty inspection.
    scope = match || scopes[scopes.length - 1] || document;
  } else if (scopes.length) scope = scopes[scopes.length - 1];
  const candidates = all('input[type="radio"],input[type="checkbox"],[role="radio"],[role="option"],[role="menuitemradio"],[role="menuitemcheckbox"],faceplate-radio-input,faceplate-checkbox-input', scope);
  const controls = candidates.flatMap(node => {
    const input = node instanceof HTMLInputElement ? node : node.shadowRoot?.querySelector<HTMLInputElement>('input') || node.querySelector<HTMLInputElement>('input');
    const label = input?.labels?.[0];
    const target = label && visible(label) ? label : input && visible(input) ? input : visible(node) ? node : null;
    if (!target) return [];
    if (node instanceof HTMLInputElement && candidates.some(other => other !== node && (other.contains(node) || other.shadowRoot?.contains(node)))) return [];
    const text = (node.getAttribute('aria-label') || label?.innerText || node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length > 200) return [];
    let refId = target.getAttribute('data-autoform-ref');
    if (!refId) {
      const next = Number(document.documentElement.dataset.openbuaChoiceCounter || 0) + 1;
      document.documentElement.dataset.openbuaChoiceCounter = String(next);
      refId = `choice_${next}`;
      target.setAttribute('data-autoform-ref', refId);
    }
    return [{ refId, label: text, role: node.getAttribute('role') || input?.type || 'radio', selected: input ? input.checked : node.getAttribute('aria-checked') === 'true' || node.getAttribute('aria-selected') === 'true' || node.hasAttribute('checked'), disabled: Boolean(input?.disabled || node.hasAttribute('disabled') || node.getAttribute('aria-disabled') === 'true') }];
  }).slice(0, 80);
  return { scopeFound, scopes: scopes.map(node => ({ selector: node.id ? `#${CSS.escape(node.id)}` : node.tagName.toLowerCase(), label: node.getAttribute('aria-label') || node.getAttribute('role') || node.tagName.toLowerCase() })), controls };
}

export async function inspectSelectionControls(tabId: number, selector?: string) {
  const result = await chrome.scripting.executeScript({ target: { tabId }, func: inPageSelectionControls, args: [selector || ''] });
  return result[0]?.result || { scopeFound: true, scopes: [], controls: [] };
}
