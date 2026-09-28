// AutoForm AI - Content Script
// Injected into web pages to inspect DOM, extract form elements, and fill form fields.

export interface FormElementDescriptor {
  refId: string;
  tagName: string;
  type: string;
  id: string;
  name: string;
  label: string;
  placeholder: string;
  value: string;
  checked?: boolean;
  required: boolean;
  disabled: boolean;
  readonly: boolean;
  isVisible: boolean;
  selector: string;
  options?: Array<{ value: string; label: string; selected: boolean }>;
  sectionHint?: string;
  ariaLabel?: string;
}

export interface PageFormSummary {
  title: string;
  url: string;
  fields: FormElementDescriptor[];
  stepIndicators: string[];
  buttons: Array<{ refId: string; text: string; type: string; isSubmit: boolean; isNext: boolean; isPrevious: boolean }>;
}

let elementRefMap = new Map<string, HTMLElement>();
let refCounter = 0;

function generateRefId(el: HTMLElement): string {
  // If element already has an autoform ID, return it
  const existing = el.getAttribute('data-autoform-ref');
  if (existing && elementRefMap.has(existing)) {
    return existing;
  }
  refCounter++;
  const refId = `af_${refCounter}`;
  el.setAttribute('data-autoform-ref', refId);
  elementRefMap.set(refId, el);
  return refId;
}

function findLabelText(el: HTMLElement): string {
  // 1. Check aria-labelledby
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelElem = document.getElementById(labelledBy);
    if (labelElem && labelElem.textContent?.trim()) {
      return labelElem.textContent.trim();
    }
  }

  // 2. Check aria-label
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim()) {
    return ariaLabel.trim();
  }

  // 3. Check for HTML label element with 'for' attribute matching id
  if (el.id) {
    const labelElem = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (labelElem && labelElem.textContent?.trim()) {
      return labelElem.textContent.trim();
    }
  }

  // 4. Check if enclosed within a <label>
  const parentLabel = el.closest('label');
  if (parentLabel) {
    // Clone and remove the input itself to get just the text
    const clone = parentLabel.cloneNode(true) as HTMLElement;
    const inputs = clone.querySelectorAll('input, select, textarea');
    inputs.forEach(i => i.remove());
    if (clone.textContent?.trim()) {
      return clone.textContent.trim();
    }
  }

  // 5. Look for previous sibling or nearby text
  let prev = el.previousElementSibling;
  while (prev) {
    if (['LABEL', 'SPAN', 'P', 'DIV', 'H4', 'H5'].includes(prev.tagName) && prev.textContent?.trim()) {
      const text = prev.textContent.trim();
      if (text.length < 80) return text;
      break;
    }
    prev = prev.previousElementSibling;
  }

  // 6. Look for closest parent container header/label
  const formGroup = el.closest('.form-group, .field, .input-group, [class*="form-item"], [class*="Field"], [class*="row"]');
  if (formGroup) {
    const labelInGroup = formGroup.querySelector('label, [class*="label"], [class*="title"]');
    if (labelInGroup && labelInGroup !== el && labelInGroup.textContent?.trim()) {
      return labelInGroup.textContent.trim();
    }
  }

  return '';
}

function findSectionHint(el: HTMLElement): string {
  // Check fieldset legend
  const fieldset = el.closest('fieldset');
  if (fieldset) {
    const legend = fieldset.querySelector('legend');
    if (legend && legend.textContent?.trim()) {
      return legend.textContent.trim();
    }
  }

  // Check closest section or form with heading
  const section = el.closest('section, form, [role="tabpanel"], [class*="step"], [class*="section"]');
  if (section) {
    const heading = section.querySelector('h1, h2, h3, h4');
    if (heading && heading.textContent?.trim()) {
      return heading.textContent.trim();
    }
  }

  return '';
}

function isElementVisible(el: HTMLElement): boolean {
  if (!el.isConnected) return false;
  // Fast geometry check first — avoids expensive getComputedStyle reflow on hundreds of elements
  if (el.offsetWidth === 0 && el.offsetHeight === 0 && el.getClientRects().length === 0) {
    return false;
  }
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function detectStepIndicators(): string[] {
  const steps: string[] = [];
  const candidates = document.querySelectorAll(
    '[class*="step"], [class*="progress"], [class*="wizard"], [role="progressbar"], [aria-label*="step" i], [aria-label*="progress" i]'
  );

  candidates.forEach(c => {
    if (isElementVisible(c as HTMLElement)) {
      const text = c.textContent?.replace(/\s+/g, ' ').trim();
      if (text && text.length > 2 && text.length < 120 && !steps.includes(text)) {
        steps.push(text);
      }
    }
  });

  return steps.slice(0, 5);
}

function readElementValue(el: HTMLElement): string {
  if (!el) return '';
  const tagName = el.tagName.toLowerCase();
  if (tagName === 'input') {
    const input = el as HTMLInputElement;
    if (input.type === 'checkbox' || input.type === 'radio') {
      return input.checked ? 'true' : 'false';
    }
    return input.value || '';
  }
  if (tagName === 'textarea') {
    return (el as HTMLTextAreaElement).value || '';
  }
  if (tagName === 'select') {
    const sel = el as HTMLSelectElement;
    return sel.options[sel.selectedIndex]?.text || sel.value || '';
  }
  if (
    el.isContentEditable ||
    el.getAttribute('contenteditable') === 'true' ||
    el.getAttribute('contenteditable') === '' ||
    el.getAttribute('role') === 'textbox'
  ) {
    return (el.innerText || el.textContent || '').trim();
  }
  // Check child elements for contenteditable or inputs (e.g. YouTube ytd-commentbox, container DIVs)
  const innerEditable = el.querySelector<HTMLElement>(
    '[contenteditable="true"], [contenteditable=""], [role="textbox"], textarea, input'
  );
  if (innerEditable && innerEditable !== el) {
    return readElementValue(innerEditable);
  }
  return (el.innerText || el.textContent || '').trim();
}

function getElementPriority(el: HTMLElement): number {
  let score = 0;
  // 1. Elements inside an active modal, dialog, or floating compose window get highest priority (e.g. Gmail Compose, modals, popups)
  const inDialog = el.closest('[role="dialog"], dialog, .M9, [aria-modal="true"], .modal, div[aria-label*="New Message" i], div[aria-label*="Compose" i]');
  if (inDialog) {
    score += 1000;
  }

  // 2. Focused element gets bonus
  if (document.activeElement === el || el.contains(document.activeElement)) {
    score += 500;
  }

  // 3. Rich text, textarea, and main inputs get priority over generic table checkboxes
  const tagName = el.tagName.toLowerCase();
  const type = (el.getAttribute('type') || '').toLowerCase();
  const isEditable = el.isContentEditable || el.getAttribute('role') === 'textbox';

  if (isEditable || tagName === 'textarea') {
    score += 200;
  } else if (tagName === 'input' && !['checkbox', 'radio'].includes(type)) {
    score += 150;
  } else if (tagName === 'select') {
    score += 100;
  } else if (['checkbox', 'radio'].includes(type)) {
    // If inside a table row (e.g. bulk email list checkboxes), lower score so it doesn't crowd out form fields
    if (el.closest('tr, [role="row"], table')) {
      score += 10;
    } else {
      score += 50;
    }
  }

  return score;
}

function inspectAllFormElements(containerSelector?: string): PageFormSummary {
  // Clear stale references
  elementRefMap.clear();
  refCounter = 0;

  let root: ParentNode = document;
  if (containerSelector) {
    const customRoot = document.querySelector(containerSelector);
    if (customRoot) root = customRoot;
  }

  // Also auto-detect active modal/dialog if one exists and no specific selector was provided
  if (!containerSelector) {
    const activeModal = document.querySelector<HTMLElement>(
      'div[role="dialog"]:not([aria-hidden="true"]), dialog[open], .M9, div[aria-label*="New Message" i], div[aria-label*="Compose" i]'
    );
    // If an active compose window/modal is currently open, note it
    if (activeModal && isElementVisible(activeModal)) {
      // We will sort modal elements first via getElementPriority
    }
  }

  const rawElements = Array.from(root.querySelectorAll<HTMLElement>(
    'input:not([type="hidden"]), textarea, select, [contenteditable="true"], [contenteditable=""], [role="textbox"], [role="combobox"], [role="checkbox"], ytd-commentbox, #contenteditable-root, #simplebox-placeholder, #placeholder-area'
  ));

  // Sort elements by priority: active dialog/modal first, text inputs/textareas second, generic list checkboxes last
  const elements = rawElements.sort((a, b) => getElementPriority(b) - getElementPriority(a));

  const fields: FormElementDescriptor[] = [];

  elements.forEach((elem) => {
    const tagName = elem.tagName.toLowerCase();
    const isEditable =
      elem.isContentEditable ||
      elem.getAttribute('contenteditable') === 'true' ||
      elem.getAttribute('contenteditable') === '';

    const type = isEditable
      ? 'contenteditable'
      : (
          elem.getAttribute('type') ||
          (tagName === 'textarea' ? 'textarea' : tagName === 'select' ? 'select' : 'text')
        ).toLowerCase();

    // Ignore submit/reset buttons here (handled in buttons)
    if (['submit', 'reset', 'button', 'image'].includes(type)) return;

    const visible = isElementVisible(elem);
    const refId = generateRefId(elem);
    const id = elem.id || '';
    const name = elem.getAttribute('name') || '';
    const placeholder = elem.getAttribute('placeholder') || '';
    const label = findLabelText(elem);
    let sectionHint = findSectionHint(elem);
    const ariaLabel = elem.getAttribute('aria-label') || '';
    const required = elem.hasAttribute('required') || elem.getAttribute('aria-required') === 'true';
    const disabled = (elem as HTMLInputElement).disabled || elem.getAttribute('aria-disabled') === 'true';
    const readonly = (elem as HTMLInputElement).readOnly || elem.getAttribute('aria-readonly') === 'true';

    // Enhance section hint if inside an active dialog/modal (e.g. Gmail "New Message")
    const dialogParent = elem.closest<HTMLElement>('[role="dialog"], dialog, .M9, [aria-modal="true"], div[aria-label*="New Message" i], div[aria-label*="Compose" i]');
    if (dialogParent) {
      const dialogTitle = dialogParent.getAttribute('aria-label') || dialogParent.querySelector('h1, h2, h3, h4, [role="heading"], .aYF, .nH')?.textContent?.trim() || 'Active Modal/Dialog';
      sectionHint = sectionHint ? `${dialogTitle} > ${sectionHint}` : dialogTitle;
    }

    let value = readElementValue(elem);
    let checked: boolean | undefined = undefined;
    let options: Array<{ value: string; label: string; selected: boolean }> | undefined = undefined;

    if (tagName === 'input') {
      const input = elem as HTMLInputElement;
      if (type === 'checkbox' || type === 'radio') {
        checked = input.checked;
        value = input.value || (input.checked ? 'true' : 'false');
      }
    } else if (tagName === 'select') {
      const select = elem as HTMLSelectElement;
      options = Array.from(select.options).map((opt) => ({
        value: opt.value,
        label: opt.text.trim(),
        selected: opt.selected,
      }));
    }

    fields.push({
      refId,
      tagName,
      type,
      id,
      name,
      label,
      placeholder,
      value,
      checked,
      required,
      disabled,
      readonly,
      isVisible: visible,
      selector: `[data-autoform-ref="${refId}"]`,
      options,
      sectionHint,
      ariaLabel,
    });
  });

  // Collect action buttons (Next, Submit, Send, Continue, Back, Comment, Post, etc.)
  const rawButtonElements = Array.from(root.querySelectorAll<HTMLElement>(
    'button, input[type="submit"], input[type="button"], a[role="button"], [role="button"], ytd-button-renderer, yt-button-shape'
  ));

  // Prioritize buttons inside active dialog/modal first
  const buttonElements = rawButtonElements.sort((a, b) => {
    const aInDialog = a.closest('[role="dialog"], dialog, .M9, [aria-modal="true"], .modal') ? 100 : 0;
    const bInDialog = b.closest('[role="dialog"], dialog, .M9, [aria-modal="true"], .modal') ? 100 : 0;
    return bInDialog - aInDialog;
  });

  const buttons: Array<{ refId: string; text: string; type: string; isSubmit: boolean; isNext: boolean; isPrevious: boolean }> = [];

  buttonElements.forEach((btn) => {
    if (!isElementVisible(btn)) return;
    const text = (
      btn.textContent ||
      (btn as HTMLInputElement).value ||
      btn.getAttribute('aria-label') ||
      btn.getAttribute('data-tooltip') ||
      btn.getAttribute('title') ||
      ''
    ).trim();
    if (!text || text.length > 50) return;

    const lower = `${text} ${btn.getAttribute('data-tooltip') || ''} ${btn.getAttribute('title') || ''}`.toLowerCase();
    const isSubmit =
      lower.includes('submit') ||
      lower.includes('comment') ||
      lower.includes('post') ||
      lower.includes('reply') ||
      lower.includes('send') ||
      lower.includes('publish') ||
      lower.includes('tweet') ||
      lower.includes('finish') ||
      lower.includes('complete') ||
      lower.includes('apply');

    const isNext =
      lower.includes('next') ||
      lower.includes('continue') ||
      lower.includes('proceed') ||
      lower.includes('save & next') ||
      lower.includes('save and continue');

    const isPrevious = lower.includes('back') || lower.includes('prev') || lower.includes('previous');

    const refId = generateRefId(btn);
    buttons.push({
      refId,
      text,
      type: btn.getAttribute('type') || 'button',
      isSubmit,
      isNext,
      isPrevious,
    });
  });

  return {
    title: document.title,
    url: window.location.href,
    fields,
    stepIndicators: detectStepIndicators(),
    buttons: buttons.slice(0, 40),
  };
}

function setNativeValue(element: HTMLElement, value: string): void {
  const tagName = element.tagName.toLowerCase();
  const isContentEditable = element.isContentEditable || element.getAttribute('contenteditable') === 'true' || element.getAttribute('role') === 'textbox';

  // 1. YouTube / Rich Text Placeholder activation
  // If element is inside or adjacent to a placeholder (e.g. YouTube #simplebox-placeholder), activate it first
  if (isContentEditable || tagName === 'div') {
    const parentBox = element.closest('ytd-commentbox, ytd-comments-header-renderer, #simple-box, .comment-simplebox') || element.parentElement;
    if (parentBox) {
      const placeholder = parentBox.querySelector<HTMLElement>('#simplebox-placeholder, #placeholder, [id*="placeholder"]');
      if (placeholder && placeholder !== element) {
        placeholder.click();
        placeholder.focus();
      }
    }
  }

  element.focus();

  if (tagName === 'input') {
    const input = element as HTMLInputElement;
    const type = (input.getAttribute('type') || 'text').toLowerCase();

    if (type === 'checkbox') {
      const boolVal = value === 'true' || value === '1' || value === 'yes' || value === 'on';
      const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'checked');
      if (descriptor?.set) {
        descriptor.set.call(input, boolVal);
      } else {
        input.checked = boolVal;
      }
    } else if (type === 'radio') {
      const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'checked');
      if (descriptor?.set) {
        descriptor.set.call(input, true);
      } else {
        input.checked = true;
      }
    } else {
      const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      if (descriptor?.set) {
        descriptor.set.call(input, value);
      } else {
        input.value = value;
      }

      // For email inputs, comboboxes, and recipient fields (e.g. Gmail To / Cc / Bcc)
      // Dispatch Enter and Tab keys to trigger recipient chip creation
      const isRecipientInput =
        type === 'email' ||
        element.getAttribute('role') === 'combobox' ||
        (element.getAttribute('aria-label') || '').toLowerCase().includes('to') ||
        (element.getAttribute('aria-label') || '').toLowerCase().includes('recipient') ||
        element.hasAttribute('peoplekit-id') ||
        element.classList.contains('agP');

      if (isRecipientInput) {
        const keyInit = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
        input.dispatchEvent(new KeyboardEvent('keydown', keyInit));
        input.dispatchEvent(new KeyboardEvent('keypress', keyInit));
        input.dispatchEvent(new KeyboardEvent('keyup', keyInit));
      }
    }
  } else if (tagName === 'textarea') {
    const textarea = element as HTMLTextAreaElement;
    const descriptor = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
    if (descriptor?.set) {
      descriptor.set.call(textarea, value);
    } else {
      textarea.value = value;
    }
  } else if (tagName === 'select') {
    const select = element as HTMLSelectElement;
    let matchIndex = -1;
    const valLower = value.toLowerCase().trim();
    for (let i = 0; i < select.options.length; i++) {
      const opt = select.options[i];
      if (opt.value.toLowerCase().trim() === valLower || opt.text.toLowerCase().trim() === valLower) {
        matchIndex = i;
        break;
      }
    }
    if (matchIndex === -1) {
      for (let i = 0; i < select.options.length; i++) {
        const opt = select.options[i];
        if (opt.text.toLowerCase().includes(valLower) || valLower.includes(opt.text.toLowerCase())) {
          matchIndex = i;
          break;
        }
      }
    }

    if (matchIndex >= 0) {
      select.selectedIndex = matchIndex;
      const descriptor = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value');
      if (descriptor?.set) {
        descriptor.set.call(select, select.options[matchIndex].value);
      } else {
        select.value = select.options[matchIndex].value;
      }
    } else {
      select.value = value;
    }
  } else if (isContentEditable) {
    // Rich editor (YouTube #contenteditable-root, Gmail Message Body, Twitter/X, Discord, Slack, Reddit)
    // Select all existing content and replace via execCommand or textContent
    element.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }

    let insertedViaExec = false;
    try {
      insertedViaExec = document.execCommand('insertText', false, value);
    } catch {
      insertedViaExec = false;
    }

    if (!insertedViaExec || !element.innerText.includes(value.trim().slice(0, 10))) {
      element.innerText = value;
    }

    // Dispatch specialized InputEvent for frameworks like Draft.js, Slate, Lexical, Polymer
    try {
      const inputEvent = new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: value,
      });
      element.dispatchEvent(inputEvent);
    } catch {
      // Fallback to standard Event
    }
  } else {
    // Standard block element or custom input
    element.textContent = value;
  }

  // Dispatch full event sequence to satisfy React, Vue, Angular, Svelte, Polymer, Closure
  element.dispatchEvent(new Event('focus', { bubbles: true }));
  element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true }));
  element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
  element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.dispatchEvent(new Event('blur', { bubbles: true }));

  // Flash visual feedback highlight on filled element
  flashHighlight(element);
}

function flashHighlight(element: HTMLElement) {
  const originalOutline = element.style.outline;
  const originalTransition = element.style.transition;
  element.style.transition = 'outline 0.2s ease-in-out';
  element.style.outline = '2px solid #22c55e'; // Green highlight
  setTimeout(() => {
    element.style.outline = originalOutline;
    element.style.transition = originalTransition;
  }, 1200);
}

function findTargetElement(refId?: string, selector?: string): HTMLElement | null {
  if (refId && elementRefMap.has(refId)) {
    return elementRefMap.get(refId)!;
  }
  if (refId) {
    const target =
      document.querySelector<HTMLElement>(`[data-autoform-ref="${CSS.escape(refId)}"]`) ||
      document.getElementById(refId) ||
      document.querySelector<HTMLElement>(`[name="${CSS.escape(refId)}"]`);
    if (target) return target;
  }

  if (selector) {
    try {
      const target = document.querySelector<HTMLElement>(selector);
      if (target) return target;
    } catch {
      // Invalid selector syntax, continue to semantic fallback
    }

    const sLower = selector.toLowerCase();

    // 1. Email / "To" recipient fallback (Gmail, Yahoo, Outlook, contact forms)
    if (sLower.includes('to') || sLower.includes('recipient')) {
      const emailCandidates = [
        'input[aria-label*="To recipients" i]',
        'input[aria-label*="To" i]',
        '[role="combobox"][aria-label*="To" i]',
        '[role="combobox"][aria-label*="recipient" i]',
        'input[peoplekit-id]',
        'input.agP',
        'div[aria-label*="To recipients" i] input',
        'div[role="dialog"] input[type="text"]',
        'div[role="dialog"] [role="combobox"]',
        'input[name="to"]',
        'textarea[name="to"]',
        'input[type="email"]',
      ];
      for (const sel of emailCandidates) {
        try {
          const el = document.querySelector<HTMLElement>(sel);
          if (el && isElementVisible(el)) return el;
        } catch {}
      }
    }

    // 2. Subject field fallback
    if (sLower.includes('subject')) {
      const subjectCandidates = [
        'input[name="subjectbox"]',
        'input[name="subject"]',
        'input[aria-label*="Subject" i]',
        'input[placeholder*="Subject" i]',
        'div[role="dialog"] input[name*="subject" i]',
      ];
      for (const sel of subjectCandidates) {
        try {
          const el = document.querySelector<HTMLElement>(sel);
          if (el && isElementVisible(el)) return el;
        } catch {}
      }
    }

    // 3. Message Body / Content fallback
    if (sLower.includes('body') || sLower.includes('message') || sLower.includes('content') || sLower.includes('comment')) {
      const bodyCandidates = [
        'div[role="textbox"][aria-label*="Message Body" i]',
        'div[role="textbox"][aria-label*="Message" i]',
        'div[role="textbox"][aria-label*="Body" i]',
        'div[role="dialog"] div[contenteditable="true"]',
        'div[role="dialog"] [role="textbox"]',
        'div[contenteditable="true"][aria-label*="Message" i]',
        'div[contenteditable="true"]',
        'textarea[name="body"]',
        'textarea[name="message"]',
        '#contenteditable-root',
        'ytd-commentbox #contenteditable-root',
      ];
      for (const sel of bodyCandidates) {
        try {
          const el = document.querySelector<HTMLElement>(sel);
          if (el && isElementVisible(el)) return el;
        } catch {}
      }
    }
  }

  return null;
}

function fillFormFields(assignments: Array<{ refId?: string; selector?: string; value: string }>): FormFillResult {
  let successCount = 0;
  const errors: string[] = [];
  const verifications: FieldFillVerification[] = [];

  for (const item of assignments) {
    const target = findTargetElement(item.refId, item.selector);

    if (!target) {
      const err = `Field not found: ${item.refId || item.selector}`;
      errors.push(err);
      verifications.push({
        refId: item.refId || '',
        selector: item.selector,
        requestedValue: item.value,
        actualValue: '',
        verified: false,
        elementFound: false,
      });
      continue;
    }

    try {
      setNativeValue(target, item.value);

      // Verify the value in DOM immediately after setting
      const actualValue = readElementValue(target);

      // In Gmail and email clients, setting a recipient creates a chip and clears the input
      const parentContainer = target.closest('tr, td, .form-group, div.M9, div[role="dialog"], div[aria-label*="To" i]');
      const containerText = parentContainer ? (parentContainer.innerText || parentContainer.textContent || '') : '';
      const isRecipientChip = containerText.toLowerCase().includes(item.value.toLowerCase().trim().slice(0, 10));

      const isVerified =
        isRecipientChip ||
        (actualValue.length > 0 && (
          actualValue.toLowerCase().includes(item.value.toLowerCase().trim().slice(0, 15)) ||
          item.value.toLowerCase().includes(actualValue.toLowerCase().trim().slice(0, 15)) ||
          actualValue === item.value ||
          (target as HTMLInputElement).type === 'checkbox' ||
          (target as HTMLInputElement).type === 'radio'
        ));

      verifications.push({
        refId: item.refId || '',
        selector: item.selector,
        requestedValue: item.value,
        actualValue: isRecipientChip ? `[Recipient Chip Created: "${item.value}"]` : actualValue,
        verified: isVerified,
        elementFound: true,
      });

      if (isVerified) {
        successCount++;
      } else {
        errors.push(`Field ${item.refId || item.selector} was filled but DOM value remained empty/mismatched (Actual: "${actualValue.slice(0, 40)}")`);
      }
    } catch (e: any) {
      const errMsg = `Error setting field ${item.refId || item.selector}: ${e?.message || e}`;
      errors.push(errMsg);
      verifications.push({
        refId: item.refId || '',
        selector: item.selector,
        requestedValue: item.value,
        actualValue: '',
        verified: false,
        elementFound: true,
      });
    }
  }

  return { successCount, errors, verifications };
}

function clickElement(refId?: string, selector?: string, text?: string): { success: boolean; message: string } {
  let target: HTMLElement | null = null;

  if (refId && elementRefMap.has(refId)) {
    target = elementRefMap.get(refId)!;
  } else if (refId) {
    target = document.querySelector(`[data-autoform-ref="${CSS.escape(refId)}"]`);
  } else if (selector) {
    target = document.querySelector(selector);
  } else if (text) {
    const rawCandidates = Array.from(document.querySelectorAll<HTMLElement>(
      'button, a, input[type="submit"], input[type="button"], [role="button"], [role="link"], [contenteditable="true"], [role="textbox"], yt-formatted-string, #video-title, #placeholder-area, #simplebox-placeholder, [data-tooltip]'
    ));

    // Prioritize candidates inside an active modal / dialog first
    const candidates = rawCandidates.sort((a, b) => {
      const aInDialog = a.closest('[role="dialog"], dialog, .M9, [aria-modal="true"], .modal') ? 100 : 0;
      const bInDialog = b.closest('[role="dialog"], dialog, .M9, [aria-modal="true"], .modal') ? 100 : 0;
      return bInDialog - aInDialog;
    });

    const tLower = text.toLowerCase().trim();

    // 1. Exact match (highest priority — e.g. exact "Send" or "Comment" button)
    target = candidates.find(c => {
      const val = (c.textContent || (c as HTMLInputElement).value || c.getAttribute('aria-label') || c.getAttribute('data-tooltip') || c.getAttribute('title') || '').toLowerCase().trim();
      return val === tLower || val.startsWith(tLower);
    }) || null;

    // 2. Exact word boundary match
    if (!target) {
      try {
        const wordRegex = new RegExp(`(^|\\s|[^a-zA-Z0-9])${tLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|\\s|[^a-zA-Z0-9])`, 'i');
        target = candidates.find(c => {
          const val = (c.textContent || (c as HTMLInputElement).value || c.getAttribute('aria-label') || c.getAttribute('data-tooltip') || c.getAttribute('title') || '').trim();
          return wordRegex.test(val);
        }) || null;
      } catch {
        // regex error fallback
      }
    }

    // 3. Substring match, sorted by shortest text (most specific leaf element first, never a giant container!)
    if (!target) {
      const matches = candidates
        .map(c => {
          const val = (c.textContent || (c as HTMLInputElement).value || c.getAttribute('aria-label') || c.getAttribute('data-tooltip') || c.getAttribute('title') || '').toLowerCase().trim();
          return { elem: c, val, len: val.length };
        })
        .filter(item => item.val.includes(tLower))
        .sort((a, b) => a.len - b.len);
      if (matches.length > 0) {
        target = matches[0].elem;
      }
    }
  }

  if (!target) {
    return { success: false, message: `Element to click not found (refId: ${refId}, selector: ${selector}, text: ${text})` };
  }

  // If clicked on an inner element (like yt-formatted-string or span), find the clickable parent button/anchor
  const clickable = target.closest<HTMLElement>('a[href], button, [role="button"], [contenteditable="true"]') || target;

  clickable.scrollIntoView({ behavior: 'smooth', block: 'center' });
  flashHighlight(clickable);

  clickable.focus();
  clickable.click();

  return { success: true, message: `Clicked element successfully (${clickable.tagName.toLowerCase()}: "${(clickable.textContent || clickable.getAttribute('aria-label') || clickable.getAttribute('data-tooltip') || '').trim().slice(0, 40)}")` };
}

function scrollPage(direction: 'up' | 'down' | 'top' | 'bottom' | 'element', selector?: string): { success: boolean } {
  if (direction === 'element' && selector) {
    const el = document.querySelector(selector);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return { success: true };
    }
  }

  if (direction === 'top') {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (direction === 'bottom') {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  } else if (direction === 'down') {
    window.scrollBy({ top: window.innerHeight * 0.75, behavior: 'smooth' });
  } else if (direction === 'up') {
    window.scrollBy({ top: -window.innerHeight * 0.75, behavior: 'smooth' });
  }

  return { success: true };
}

// Listen for messages from the Side Panel / Extension
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  try {
    switch (request.action) {
      case 'INSPECT_PAGE_FORM': {
        const summary = inspectAllFormElements(request.selector);
        sendResponse({ success: true, data: summary });
        break;
      }

      case 'FILL_FORM_FIELDS': {
        const result = fillFormFields(request.assignments || []);
        sendResponse({ success: true, data: result });
        break;
      }

      case 'CLICK_ELEMENT': {
        const result = clickElement(request.refId, request.selector, request.text);
        sendResponse(result);
        break;
      }

      case 'SCROLL_PAGE': {
        const result = scrollPage(request.direction, request.selector);
        sendResponse(result);
        break;
      }

      case 'GET_PAGE_TEXT': {
        // 0. Extract active modal / dialog text (Gmail compose, popups, overlays)
        const activeModals = Array.from(document.querySelectorAll<HTMLElement>(
          'div[role="dialog"]:not([aria-hidden="true"]), dialog[open], .M9, div[aria-label*="New Message" i], div[aria-label*="Compose" i]'
        ));
        let modalExcerpt = '';
        if (activeModals.length > 0) {
          modalExcerpt = activeModals
            .map((m) => (m.innerText || m.textContent || '').trim())
            .filter((t) => t.length > 0)
            .join('\n\n');
        }

        // 1. Gather interactive / item links (especially video links, search results, nav links)
        const links: string[] = [];
        const seenLinks = new Set<string>();
        document.querySelectorAll<HTMLAnchorElement>('a[href], a#video-title, [role="link"]').forEach((a) => {
          const text = (a.textContent || a.getAttribute('aria-label') || a.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
          const href = a.getAttribute('href') || '';
          if (text && text.length > 2 && text.length < 100 && !seenLinks.has(text.toLowerCase())) {
            seenLinks.add(text.toLowerCase());
            if (links.length < 35) {
              const fullUrl = href.startsWith('http') ? href : window.location.origin + href;
              links.push(`- Link/Video: "${text}" (${fullUrl})`);
            }
          }
        });

        // 2. Gather key buttons & inputs
        const buttons: string[] = [];
        const seenButtons = new Set<string>();
        document.querySelectorAll<HTMLElement>('button, [role="button"], input[type="submit"], input[type="button"], ytd-button-renderer').forEach((b) => {
          const text = (b.textContent || b.getAttribute('aria-label') || (b as HTMLInputElement).value || '').replace(/\s+/g, ' ').trim();
          if (text && text.length > 1 && text.length < 40 && !seenButtons.has(text.toLowerCase())) {
            seenButtons.add(text.toLowerCase());
            if (buttons.length < 20) {
              buttons.push(`- Button: "${text}"`);
            }
          }
        });

        // 3. Clean excerpt of page content (up to 10,000 characters for rich model context)
        let mainText = '';
        const mainEl = document.querySelector('main, article, #content, [role="main"]') || document.body;
        if (mainEl) {
          mainText = (mainEl as HTMLElement).innerText || '';
        } else if (document.body) {
          mainText = document.body.innerText || '';
        }
        mainText = mainText.replace(/\n\s*\n\s*\n/g, '\n\n').slice(0, 10000);

        let formatted = `Title: ${document.title}\nURL: ${window.location.href}\n\n`;
        if (modalExcerpt) {
          formatted += `### Active Dialog / Compose Window Content:\n${modalExcerpt}\n\n`;
        }
        if (links.length > 0) {
          formatted += `### Key Links / Videos on Page:\n${links.join('\n')}\n\n`;
        }
        if (buttons.length > 0) {
          formatted += `### Interactive Buttons:\n${buttons.join('\n')}\n\n`;
        }
        formatted += `### Page Text Excerpt:\n${mainText}`;

        sendResponse({ success: true, text: formatted, title: document.title, url: window.location.href });
        break;
      }

      default:
        sendResponse({ success: false, error: `Unknown action: ${request.action}` });
    }
  } catch (err: any) {
    sendResponse({ success: false, error: err?.message || String(err) });
  }

  return true; // Keep message channel open for async response
});

console.log('[AutoForm AI] Content script loaded and active.');
