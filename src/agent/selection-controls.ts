// Self-contained for chrome.scripting injection: expose ARIA/custom choices
// that ordinary input inspection misses, including controls in shadow roots.
export function inPageSelectionControls(selector = '') {
  /** Self-contained: serialized alongside DOM observers into the page. */
  function nearbyChoiceQuestion(node: HTMLElement): string {
    const choiceSelector = 'input[type="radio"],input[type="checkbox"],[role="radio"],[role="checkbox"]';
    let container = node.parentElement;
    for (let depth = 0; container && depth < 9; depth++, container = container.parentElement) {
      // Never cross into a container holding another question or free-text answer.
      const choices = Array.from(container.querySelectorAll<HTMLElement>(choiceSelector));
      if (choices.length < 2) continue;
      if (choices.length > 2 || container.querySelector('input:not([type="radio"]):not([type="checkbox"]):not([type="hidden"]),textarea,select')) return '';
      const labels = Array.from(container.querySelectorAll<HTMLElement>('label,legend,p,[data-label]'))
        .filter(label => !choices.some(choice => label.contains(choice) || choice.contains(label)) &&
          !label.closest('label')?.querySelector(choiceSelector))
        .map(label => (label.innerText || '').replace(/\s+/g, ' ').trim())
        .filter(label => label.length > 8 && label.length <= 1200 && !/^(yes|no)\b/i.test(label));
      const unique = [...new Set(labels)];
      if (unique.length === 1) return unique[0];
      if (unique.length > 1) return '';
    }
    return '';
  }

  const roots = (root: ParentNode): ParentNode[] => {
    const result = [root];
    if (root instanceof Element && root.shadowRoot) result.push(...roots(root.shadowRoot));
    for (const host of Array.from(root.querySelectorAll('*'))) if (host.shadowRoot) visit(host.shadowRoot);
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
    let optionLabel = label?.innerText?.replace(/\s+/g, ' ').trim();
    if (!optionLabel && input) {
      let ancestor = input.parentElement || (input.getRootNode() as ShadowRoot).host;
      for (let depth = 0; ancestor && depth < 4; depth++, ancestor = ancestor.parentElement || (ancestor.getRootNode() as ShadowRoot).host) {
        const candidate = (ancestor as HTMLElement).innerText?.replace(/\s+/g, ' ').trim() || '';
        if (all('input[type="radio"],input[type="checkbox"],[role="radio"],[role="checkbox"]', ancestor).length > 1) break;
        if (candidate && candidate.length <= 200 && !candidate.includes(node.getAttribute('aria-label') || '\u0000')) { optionLabel = candidate; break; }
      }
    }
    const text = (optionLabel || node.getAttribute('aria-label') || node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
    const groupNode = node.closest('fieldset,[role="radiogroup"],[data-test-form-element]');
    const groupIds = (groupNode?.getAttribute('aria-labelledby') || '').split(/\s+/);
    const group = (groupNode?.getAttribute('aria-label') || groupIds.map(id => document.getElementById(id)?.textContent || '').join(' ').trim()
      || groupNode?.querySelector('legend')?.textContent || (optionLabel && node.getAttribute('aria-label') !== optionLabel ? node.getAttribute('aria-label') : '') || nearbyChoiceQuestion(node)).replace(/\s+/g, ' ').trim().slice(0, 1200);
    if (!text || text.length > 200) return [];
    let refId = target.getAttribute('data-autoform-ref');
    if (!refId) {
      const next = Number(document.documentElement.dataset.openbuaChoiceCounter || 0) + 1;
      document.documentElement.dataset.openbuaChoiceCounter = String(next);
      refId = `choice_${next}`;
      target.setAttribute('data-autoform-ref', refId);
    }
    return [{ refId, label: text, group, role: node.getAttribute('role') || input?.type || 'radio', selected: input ? input.checked : node.getAttribute('aria-checked') === 'true' || node.getAttribute('aria-selected') === 'true' || node.hasAttribute('checked'), disabled: Boolean(input?.disabled || node.hasAttribute('disabled') || node.getAttribute('aria-disabled') === 'true') }];
  }).slice(0, 80);
  return { scopeFound, scopes: scopes.map(node => ({ selector: node.id ? `#${CSS.escape(node.id)}` : node.tagName.toLowerCase(), label: node.getAttribute('aria-label') || node.getAttribute('role') || node.tagName.toLowerCase() })), controls };
}

export async function inspectSelectionControls(tabId: number, selector?: string) {
  const result = await chrome.scripting.executeScript({ target: { tabId }, func: inPageSelectionControls, args: [selector || ''] });
  return result[0]?.result || { scopeFound: true, scopes: [], controls: [] };
}
