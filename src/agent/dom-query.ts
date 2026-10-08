// Keep self-contained: fallback scripts embed this function when serialized.
export function createDomQuery(root: ParentNode = document) {
  function roots(node: ParentNode): ParentNode[] {
    const result: ParentNode[] = [node];
    if (node instanceof Element && node.shadowRoot) result.push(...roots(node.shadowRoot));
    for (const host of Array.from(node.querySelectorAll('*'))) {
      if (host.shadowRoot) result.push(...roots(host.shadowRoot));
    }
    return result;
  }
  return {
    querySelectorAll<T extends Element = Element>(selector: string): T[] {
      return [...new Set(roots(root).flatMap(scope => Array.from(scope.querySelectorAll<T>(selector))))];
    },
    querySelector<T extends Element = Element>(selector: string): T | null {
      for (const scope of roots(root)) {
        const element = scope.querySelector<T>(selector);
        if (element) return element;
      }
      return null;
    },
    shadowText(): string {
      const text = roots(root).filter(scope => scope instanceof ShadowRoot).flatMap(scope =>
        Array.from(scope.querySelectorAll<HTMLElement>('h1,h2,h3,h4,label,p,button,input,textarea,[role="dialog"],[role="button"]'))
          .filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none')
          .map(el => el.innerText?.trim() || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '')
          .filter(Boolean));
      return [...new Set(text)].join('\n').slice(0, 8000);
    },
  };
}
