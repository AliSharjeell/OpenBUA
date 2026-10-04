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
    if (input.type === 'file') {
      const files = Array.from(input.files || []).map((f) => f.name).join(', ');
      return files || input.value || '';
    }
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
  // Clear all previous autoform attributes across the document to prevent stale ID collisions
  document.querySelectorAll('[data-autoform-ref]').forEach((el) => {
    el.removeAttribute('data-autoform-ref');
  });
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

  // Collect action buttons (Next, Submit, Send, Continue, Back, Comment, Post, etc.), tabs, and visible chat items
  const rawButtonElements = Array.from(root.querySelectorAll<HTMLElement>(
    'button, input[type="submit"], input[type="button"], a[role="button"], [role="button"], [role="tab"], tp-yt-paper-tab, yt-tab-shape, ytd-button-renderer, yt-button-shape, #pane-side [role="listitem"], #pane-side div[tabindex="-1"], div[data-testid*="chat-list-item"]'
  ));

  // Filter out elements inside search prediction dropdowns / hidden autocomplete popups and chat message bubbles
  const filteredButtonElements = rawButtonElements.filter((el) => {
    if (el.closest('.sbdd_a, .sbsb_a, [role="listbox"], #complete-list')) return false;

    // Filter out chat message bubbles, rows, and timestamps (WhatsApp, Telegram, Slack, Teams)
    if (el.closest('.message-in, .message-out, [data-id*="false_"], [data-id*="true_"], [data-pre-plain-text], .chat-message, [role="row"] .copyable-text')) {
      return false;
    }

    const t = (el.textContent || '').trim();
    if (/^\d{1,2}:\d{2}(?:\s*(?:am|pm))?$/i.test(t)) return false;
    if (t.startsWith('reaction ') && t.includes('View reactions')) return false;

    return true;
  });

  // Prioritize buttons inside active dialog/modal first
  const buttonElements = filteredButtonElements.sort((a, b) => {
    const aInDialog = a.closest('[role="dialog"], dialog, .M9, [aria-modal="true"], .modal') ? 100 : 0;
    const bInDialog = b.closest('[role="dialog"], dialog, .M9, [aria-modal="true"], .modal') ? 100 : 0;
    return bInDialog - aInDialog;
  });

  const buttons: Array<{ refId: string; text: string; type: string; isSubmit: boolean; isNext: boolean; isPrevious: boolean }> = [];

  buttonElements.forEach((btn) => {
    if (!isElementVisible(btn)) return;
    let text = (
      btn.textContent ||
      (btn as HTMLInputElement).value ||
      btn.getAttribute('aria-label') ||
      btn.getAttribute('data-tooltip') ||
      btn.getAttribute('title') ||
      ''
    ).trim();

    // If it's a chat contact list item, extract the contact name cleanly and bind refId directly to the contact title leaf element
    let targetEl: HTMLElement = btn;
    const isChatItem = Boolean(btn.closest('#pane-side, [data-testid*="chat-list"]'));
    if (isChatItem) {
      const contactTitleEl = btn.querySelector<HTMLElement>('span[title], div[title], [title]');
      const contactTitle = contactTitleEl?.getAttribute('title') || contactTitleEl?.textContent?.trim();
      if (contactTitle) {
        text = `Chat: ${contactTitle}`;
        if (contactTitleEl) {
          targetEl = contactTitleEl;
        }
      }
    }

    if (!text || text.length > 50) return;

    const lower = `${text} ${btn.getAttribute('data-tooltip') || ''} ${btn.getAttribute('title') || ''} ${btn.getAttribute('aria-label') || ''}`.toLowerCase();
    const isSubmit =
      !isChatItem &&
      (/\b(submit|send|comment|post|publish|tweet|finish|complete|apply)\b/i.test(lower) ||
        lower.includes('submit') ||
        lower.includes('send') ||
        lower.includes('post') ||
        lower.includes('publish') ||
        lower.includes('complete'));

    const isNext =
      !isChatItem &&
      (lower.includes('next') ||
        lower.includes('continue') ||
        lower.includes('proceed') ||
        lower.includes('save & next') ||
        lower.includes('save and continue'));

    const isPrevious = !isChatItem && (lower.includes('back') || lower.includes('prev') || lower.includes('previous'));

    const isTab = btn.getAttribute('role') === 'tab' ||
      btn.tagName.toLowerCase() === 'tp-yt-paper-tab' ||
      btn.tagName.toLowerCase() === 'yt-tab-shape' ||
      lower.includes('popular') ||
      lower.includes('latest') ||
      lower.includes('videos');

    const refId = generateRefId(targetEl);
    buttons.push({
      refId,
      text,
      type: isTab ? 'tab' : isChatItem ? 'chat-contact' : (btn.getAttribute('type') || 'button'),
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

function setNativeValue(
  element: HTMLElement,
  value: string,
  fileData?: { fileName: string; mimeType: string; dataUrl: string }
): void {
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

    if (type === 'file') {
      try {
        let fileObj: File | null = null;
        if (fileData?.dataUrl) {
          const parts = fileData.dataUrl.split(',');
          const mime = fileData.mimeType || 'application/octet-stream';
          const bstr = atob(parts[1] || '');
          let n = bstr.length;
          const u8arr = new Uint8Array(n);
          while (n--) {
            u8arr[n] = bstr.charCodeAt(n);
          }
          const defaultName = mime.startsWith('video/') ? 'video.mp4' : mime.startsWith('image/') ? 'image.png' : 'upload.pdf';
          fileObj = new File([u8arr], fileData.fileName || defaultName, { type: mime });
        } else if (value.startsWith('data:')) {
          const parts = value.split(',');
          const mimeMatch = parts[0]?.match(/:(.*?);/);
          const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
          const bstr = atob(parts[1] || '');
          let n = bstr.length;
          const u8arr = new Uint8Array(n);
          while (n--) {
            u8arr[n] = bstr.charCodeAt(n);
          }
          const defaultName = mime.startsWith('video/') ? 'video.mp4' : mime.startsWith('image/') ? 'image.png' : 'upload.pdf';
          fileObj = new File([u8arr], fileData?.fileName || defaultName, { type: mime });
        }

        if (fileObj) {
          const dt = new DataTransfer();
          dt.items.add(fileObj);
          input.files = dt.files;
          input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

          const dropzone =
            input.closest('.dropzone, [data-testid="dropzone"], [class*="upload"], [class*="drop"], [role="button"]') ||
            document.querySelector('[data-testid="dropzone"], div[data-dropzone="true"]') ||
            input.parentElement;
          if (dropzone && dropzone !== input) {
            try {
              dropzone.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, composed: true, dataTransfer: dt }));
              dropzone.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, composed: true, dataTransfer: dt }));
              dropzone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, composed: true, dataTransfer: dt }));
            } catch {}
          }
          return;
        }
      } catch (fileErr) {
        console.warn('[AutoForm AI] Error attaching file:', fileErr);
      }
    } else if (type === 'checkbox') {
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
      const ariaLabel = (element.getAttribute('aria-label') || '').toLowerCase();
      const isRecipientInput =
        !isContentEditable &&
        tagName === 'input' &&
        (type === 'email' ||
          element.getAttribute('role') === 'combobox' ||
          /\bto\b/i.test(ariaLabel) ||
          /\brecipients?\b/i.test(ariaLabel) ||
          element.hasAttribute('peoplekit-id') ||
          element.classList.contains('agP'));

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
    // Rich editor (WhatsApp Web Lexical, YouTube, Gmail, Twitter/X, Discord, Slack, Reddit)
    element.focus();

    // 1. Clear any existing content cleanly
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    try {
      document.execCommand('selectAll', false, undefined);
      document.execCommand('delete', false, undefined);
    } catch {}

    // 2. Insert text via browser's native text insertion command (single clean execution)
    let inserted = false;
    try {
      inserted = document.execCommand('insertText', false, value);
    } catch {}

    // Fallback only if execCommand completely failed and element has no children
    if (!inserted && !element.hasChildNodes()) {
      element.textContent = value;
    }

    // Always dispatch standard input/change events once
    element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    // Check if element contains an inner input or contenteditable
    const innerEditable = element.querySelector<HTMLElement>('input:not([type="hidden"]), textarea, [contenteditable="true"], [role="textbox"]');
    if (innerEditable && innerEditable !== element) {
      setNativeValue(innerEditable, value);
      return;
    }
    // Only set textContent if explicitly a textbox role or data-editable
    if (element.getAttribute('role') === 'textbox' || element.hasAttribute('data-editable')) {
      element.textContent = value;
    } else {
      throw new Error(`Target element <${element.tagName.toLowerCase()}> is not an input, textarea, or contenteditable editor.`);
    }
  }

  // Dispatch full event sequence to satisfy React, Vue, Angular, Svelte, Polymer, Closure
  if (!isContentEditable) {
    element.dispatchEvent(new Event('focus', { bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  // Flash visual feedback highlight on filled element
  flashHighlight(element);
}

function flashHighlight(element: HTMLElement) {
  // If element is an inline element or inner text element, find its visual container
  const visualEl = element.closest<HTMLElement>(
    '[role="listitem"], [role="row"], div[data-testid*="cell"], div[data-testid*="list-item"], div[data-testid*="chat-list-item"], a, button, [role="button"], [role="tab"], tp-yt-paper-tab, yt-tab-shape, ytd-compact-video-renderer, ytd-video-renderer, [role="dialog"], #pane-side div[tabindex="-1"], .form-group'
  ) || (element.parentElement && window.getComputedStyle(element).display === 'inline' ? element.parentElement : element);

  const originalOutline = visualEl.style.outline;
  const originalOutlineOffset = visualEl.style.outlineOffset;
  const originalBoxShadow = visualEl.style.boxShadow;
  const originalTransition = visualEl.style.transition;

  visualEl.style.transition = 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)';
  visualEl.style.outline = '3px solid #22c55e'; // Bright vibrant green highlight
  visualEl.style.outlineOffset = '-2px'; // Inset outline so it is NEVER clipped by parent overflow:hidden containers
  visualEl.style.boxShadow = '0 0 0 2px #22c55e, 0 0 16px rgba(34, 197, 94, 0.7)';

  setTimeout(() => {
    visualEl.style.outline = originalOutline;
    visualEl.style.outlineOffset = originalOutlineOffset;
    visualEl.style.boxShadow = originalBoxShadow;
    visualEl.style.transition = originalTransition;
  }, 1200);

  // Trigger smooth OpenBUA cursor animation on the visual element
  showAgentCursorClick(visualEl);
}

function simulateInteractiveClick(target: HTMLElement, container?: HTMLElement | null) {
  const primary = container || target;

  const rect = target.getBoundingClientRect();
  const fallbackRect = primary.getBoundingClientRect();
  const effectiveRect = (rect.width > 0 && rect.height > 0) ? rect : fallbackRect;

  const clientX = Math.round(effectiveRect.left + (effectiveRect.width > 0 ? effectiveRect.width / 2 : 10));
  const clientY = Math.round(effectiveRect.top + (effectiveRect.height > 0 ? effectiveRect.height / 2 : 10));

  const mouseInit: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    detail: 1,
    screenX: window.screenX + clientX,
    screenY: window.screenY + clientY,
    clientX,
    clientY,
    button: 0,
    buttons: 1,
  };

  const pointerInit: PointerEventInit = {
    ...mouseInit,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    width: 1,
    height: 1,
    pressure: 0,
  };

  const dispatchTarget = target || primary;

  // 1. Hover
  try {
    dispatchTarget.dispatchEvent(new PointerEvent('pointerover', { ...pointerInit, buttons: 0 }));
    dispatchTarget.dispatchEvent(new MouseEvent('mouseover', { ...mouseInit, buttons: 0 }));
    dispatchTarget.dispatchEvent(new PointerEvent('pointerenter', { ...pointerInit, bubbles: false, buttons: 0 }));
  } catch {}

  // 2. Press
  try {
    dispatchTarget.dispatchEvent(new PointerEvent('pointerdown', { ...pointerInit, buttons: 1, pressure: 0.5 }));
    dispatchTarget.dispatchEvent(new MouseEvent('mousedown', { ...mouseInit, buttons: 1 }));
  } catch {}

  // 3. Focus interactive container
  try {
    primary.focus();
  } catch {}

  // 4. Release
  try {
    dispatchTarget.dispatchEvent(new PointerEvent('pointerup', { ...pointerInit, buttons: 0, pressure: 0 }));
    dispatchTarget.dispatchEvent(new MouseEvent('mouseup', { ...mouseInit, buttons: 0 }));
  } catch {}

  // 5. Single atomic click activation
  // Calling primary.click() triggers the browser's native activation behavior AND fires a single bubbling click event.
  // We NEVER dispatch a synthetic click event before or after calling primary.click(), because that would fire 2-3 clicks,
  // causing toggle dropdowns (such as Gemini's model switcher) to immediately open and close!
  let activated = false;
  try {
    if (typeof primary.click === 'function') {
      primary.click();
      activated = true;
    }
  } catch {}

  if (!activated) {
    try {
      dispatchTarget.dispatchEvent(new MouseEvent('click', { ...mouseInit, buttons: 0 }));
    } catch {}
  }
}

const OPENBUA_CURSOR_BASE64 = 'data:image/png;base64,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';

let isCursorStylesInjected = false;
function ensureAgentCursorStyles() {
  if (isCursorStylesInjected || document.getElementById('openbua-cursor-styles')) return;
  const style = document.createElement('style');
  style.id = 'openbua-cursor-styles';
  style.textContent = `
    @keyframes openbuaCursorAnimation {
      0% {
        opacity: 0;
        transform: translate(-14px, -18px) scale(0.6);
      }
      22% {
        opacity: 1;
        transform: translate(0px, 0px) scale(1);
      }
      38% {
        transform: translate(0px, 2px) scale(0.82) rotate(-5deg);
        filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.7)) brightness(1.2);
      }
      54% {
        transform: translate(0px, -2px) scale(1.05) rotate(0deg);
        filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.45)) brightness(1);
      }
      70% {
        opacity: 1;
        transform: translate(0px, 0px) scale(1);
      }
      100% {
        opacity: 0;
        transform: translate(6px, -10px) scale(0.65);
      }
    }
    @keyframes openbuaRipple {
      0% {
        opacity: 0.9;
        transform: scale(0.5);
      }
      40% {
        opacity: 0.65;
        transform: scale(1.5);
      }
      100% {
        opacity: 0;
        transform: scale(2.4);
      }
    }
  `;
  (document.head || document.documentElement).appendChild(style);
  isCursorStylesInjected = true;
}

function showAgentCursorClick(element: HTMLElement) {
  setTimeout(() => {
    try {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;

      // Calculate natural target coordinates on the element (standard cursor size: 26px x 26px)
      const targetX = rect.left + Math.min(rect.width / 2, 28);
      const targetY = rect.top + Math.min(rect.height / 2, 20);

      ensureAgentCursorStyles();

      const container = document.createElement('div');
      container.className = 'openbua-cursor-indicator';
      container.style.cssText = [
        'position: fixed',
        `left: ${Math.round(targetX)}px`,
        `top: ${Math.round(targetY)}px`,
        'width: 0px',
        'height: 0px',
        'pointer-events: none',
        'z-index: 2147483647',
        'transform: translate(-50%, -50%)',
      ].join('; ');

      const ripple = document.createElement('div');
      ripple.className = 'openbua-cursor-ripple';
      ripple.style.cssText = [
        'position: absolute',
        'left: 0',
        'top: 0',
        'width: 26px',
        'height: 26px',
        'margin-left: -13px',
        'margin-top: -13px',
        'border-radius: 50%',
        'border: 2px solid #007AFF',
        'box-shadow: 0 0 10px rgba(0, 122, 255, 0.6), inset 0 0 6px rgba(0, 122, 255, 0.3)',
        'pointer-events: none',
        'animation: openbuaRipple 0.55s cubic-bezier(0.2, 0.8, 0.2, 1) forwards',
        'animation-delay: 0.18s',
        'opacity: 0',
      ].join('; ');

      const cursor = document.createElement('img');
      cursor.className = 'openbua-cursor-img';
      cursor.src = OPENBUA_CURSOR_BASE64;
      cursor.alt = 'OpenBUA Cursor';
      cursor.style.cssText = [
        'position: absolute',
        'left: 0',
        'top: 0',
        'width: 26px',
        'height: 26px',
        'margin-left: -13px',
        'margin-top: -13px',
        'filter: drop-shadow(0 3px 6px rgba(0, 0, 0, 0.5))',
        'pointer-events: none',
        'animation: openbuaCursorAnimation 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'will-change: transform, opacity',
      ].join('; ');

      container.appendChild(ripple);
      container.appendChild(cursor);
      (document.documentElement || document.body).appendChild(container);

      setTimeout(() => {
        container.remove();
      }, 850);
    } catch (err) {
      console.debug('[OpenBUA Cursor] Animation notice:', err);
    }
  }, 40);
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

async function fillFormFields(
  assignments: Array<{
    refId?: string;
    selector?: string;
    value: string;
    pressEnter?: boolean;
    fileData?: { fileName: string; mimeType: string; dataUrl: string };
  }>,
  pressEnterAll?: boolean
): Promise<FormFillResult> {
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
      setNativeValue(target, item.value, item.fileData);

      // Yield briefly to let rich-text frameworks (Lexical, React, ProseMirror, Slate) flush DOM reconciliations
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Verify the value in DOM after setting
      let actualValue = readElementValue(target);
      if (!actualValue && (target.isContentEditable || target.getAttribute('role') === 'textbox')) {
        actualValue = (target.innerText || target.textContent || '').trim();
        if (!actualValue) {
          const innerP = target.querySelector('p, span, .selectable-text');
          if (innerP) actualValue = (innerP.textContent || '').trim();
        }
      }
      // Clean zero-width whitespace and normalize
      actualValue = actualValue.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();

      // In Gmail and email clients, setting a recipient creates a chip and clears the input
      const targetAriaLabel = (target.getAttribute('aria-label') || '').toLowerCase();
      const isRecipientInput =
        !target.isContentEditable &&
        target.tagName.toLowerCase() === 'input' &&
        ((target.getAttribute('type') || '').toLowerCase() === 'email' ||
          target.getAttribute('role') === 'combobox' ||
          /\bto\b/i.test(targetAriaLabel) ||
          /\brecipients?\b/i.test(targetAriaLabel) ||
          Boolean(target.closest('div[aria-label*="To" i]:not([role="region"]), div.M9, .agP')));

      let isRecipientChip = false;
      if (isRecipientInput) {
        const parentContainer = target.closest('tr, td, .form-group, div.M9, div[role="dialog"], div[aria-label*="To" i]');
        const containerText = parentContainer ? (parentContainer.innerText || parentContainer.textContent || '') : '';
        isRecipientChip = containerText.toLowerCase().includes(item.value.toLowerCase().trim().slice(0, 10));
      }

      const cleanActual = actualValue.toLowerCase();
      const cleanRequested = item.value.replace(/[\u200B-\u200D\uFEFF]/g, '').trim().toLowerCase();

      // Check digits equality for formatted phone numbers, SSNs, credit cards, dates, zip codes
      const digitsActual = cleanActual.replace(/\D/g, '');
      const digitsRequested = cleanRequested.replace(/\D/g, '');
      const isDigitsMatch = digitsActual.length > 2 && digitsRequested.length > 2 && digitsActual === digitsRequested;

      // Select element verification: match by value, label, or valid selection
      let isSelectMatch = false;
      if (target.tagName.toLowerCase() === 'select') {
        const sel = target as HTMLSelectElement;
        const curOpt = sel.options[sel.selectedIndex];
        const curVal = (curOpt?.value || sel.value || '').toLowerCase().trim();
        const curText = (curOpt?.text || '').toLowerCase().trim();
        isSelectMatch =
          curVal === cleanRequested ||
          curText === cleanRequested ||
          curText.includes(cleanRequested) ||
          cleanRequested.includes(curText) ||
          curVal.includes(cleanRequested) ||
          cleanRequested.includes(curVal) ||
          (sel.selectedIndex > 0 && !cleanRequested.includes('select'));
      }

      const isFileInput = target.tagName.toLowerCase() === 'input' && (target as HTMLInputElement).type === 'file';
      const isFileAttached = isFileInput && ((target as HTMLInputElement).files?.length ?? 0) > 0;

      const isVerified =
        isFileAttached ||
        isRecipientChip ||
        isDigitsMatch ||
        isSelectMatch ||
        (cleanActual.length > 0 && (
          cleanActual.includes(cleanRequested.slice(0, 15)) ||
          cleanRequested.includes(cleanActual.slice(0, 15)) ||
          cleanActual === cleanRequested ||
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
        if (item.pressEnter || pressEnterAll) {
          try {
            target.focus();
            const eventInit: KeyboardEventInit = {
              key: 'Enter',
              code: 'Enter',
              keyCode: 13,
              which: 13,
              bubbles: true,
              cancelable: true,
              composed: true,
            };
            target.dispatchEvent(new KeyboardEvent('keydown', eventInit));
            target.dispatchEvent(new KeyboardEvent('keypress', eventInit));
            target.dispatchEvent(new KeyboardEvent('keyup', eventInit));

            setTimeout(() => {
              // 1. If target text is already cleared, Enter already sent the message! Never click anything.
              const remaining = (
                (target as HTMLInputElement).value !== undefined
                  ? (target as HTMLInputElement).value
                  : (target.innerText || target.textContent || '')
              ).replace(/[\u200B-\u200D\uFEFF]/g, '').trim();

              if (remaining.length === 0) {
                return; // Message already sent and compose box cleared
              }

              // 2. Only look for genuine Send buttons (NEVER match data-tab="11" or voice buttons)
              const sendBtn = document.querySelector<HTMLElement>(
                'button[aria-label*="Send" i], span[data-icon="send"], [data-icon="send"], button[data-testid*="send" i]'
              );
              if (!sendBtn) return;

              // 3. Absolute safety: NEVER click microphone, voice note, or PTT buttons!
              const isVoiceOrMic =
                Boolean(sendBtn.querySelector('[data-icon="ptt"], [data-icon="mic"], [aria-label*="voice" i], [aria-label*="record" i]')) ||
                sendBtn.matches('[data-icon="ptt"], [data-icon="mic"]') ||
                /\b(voice|record|ptt|mic|microphone)\b/i.test(sendBtn.getAttribute('aria-label') || '');

              if (isVoiceOrMic) return;

              const clickTarget = sendBtn.closest('button') || sendBtn;
              clickTarget.click();
            }, 100);
          } catch {}
        }
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
    try {
      target = document.querySelector(selector);
    } catch {}
    // If selector had an absolute URL e.g. a[href="https://www.youtube.com/@MrBeast"], also try relative pathname
    if (!target && /href=["']https?:\/\/[^/]+(\/[^"']+)["']/i.test(selector)) {
      const pathMatch = selector.match(/href=["']https?:\/\/[^/]+(\/[^"']+)["']/i);
      if (pathMatch) {
        try {
          target = document.querySelector(`a[href="${pathMatch[1]}"], a[href*="${pathMatch[1]}"]`);
        } catch {}
      }
    }
  } else if (text) {
    const rawCandidates = Array.from(document.querySelectorAll<HTMLElement>(
      'button, a, input[type="submit"], input[type="button"], [role="button"], [role="link"], [role="tab"], [role="listitem"], [role="row"], [role="treeitem"], [role="menuitem"], [role="option"], [role="menuitemradio"], [role="combobox"], [aria-haspopup], mat-select, bard-mode-switcher, tp-yt-paper-tab, yt-tab-shape, [contenteditable="true"], [role="textbox"], yt-formatted-string, #video-title, #placeholder-area, #simplebox-placeholder, ytd-channel-name, [data-tooltip], [data-testid*="cell"], [data-testid*="list-item"], [data-testid*="chat-list-item"], span[title], div[title], [aria-label], #pane-side div[tabindex="-1"], #pane-side span'
    )).filter((c) => {
      // Exclude search suggestions / autocomplete dropdowns so we never click search predictions accidentally
      return !c.closest('.sbdd_a, .sbsb_a, [role="listbox"], #complete-list');
    });

    // Prioritize candidates inside an active modal / dialog first
    const candidates = rawCandidates.sort((a, b) => {
      const aInDialog = a.closest('[role="dialog"], dialog, .M9, [aria-modal="true"], .modal') ? 100 : 0;
      const bInDialog = b.closest('[role="dialog"], dialog, .M9, [aria-modal="true"], .modal') ? 100 : 0;
      return bInDialog - aInDialog;
    });

    const tLower = text.toLowerCase().trim();
    const tNormalized = tLower.replace(/\s+/g, '');

    const getElemText = (c: HTMLElement): string => {
      return (
        c.innerText ||
        c.textContent ||
        (c as HTMLInputElement).value ||
        c.getAttribute('aria-label') ||
        c.getAttribute('data-tooltip') ||
        c.getAttribute('title') ||
        ''
      ).toLowerCase().trim();
    };

    // 1. Exact match (highest priority — e.g. exact "Send", "Flash", or "Gemini Flash")
    target = candidates.find(c => {
      const val = getElemText(c);
      const valNorm = val.replace(/\s+/g, '');
      return val === tLower || valNorm === tNormalized || val.startsWith(tLower) || valNorm.startsWith(tNormalized);
    }) || null;

    // 2. Exact word boundary match
    if (!target) {
      try {
        const wordRegex = new RegExp(`(^|\\s|[^a-zA-Z0-9])${tLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|\\s|[^a-zA-Z0-9])`, 'i');
        target = candidates.find(c => {
          const val = getElemText(c);
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
          const val = getElemText(c);
          const valNorm = val.replace(/\s+/g, '');
          return { elem: c, val, valNorm, len: val.length };
        })
        .filter(item => item.val.includes(tLower) || item.valNorm.includes(tNormalized))
        .sort((a, b) => a.len - b.len);
      if (matches.length > 0) {
        target = matches[0].elem;
      }
    }
  }

  if (!target) {
    return { success: false, message: `Element to click not found (refId: ${refId}, selector: ${selector}, text: ${text})` };
  }

  // Resolve clickable container (interactive row, listitem, button, link, or tab)
  const container = target.closest<HTMLElement>(
    'a[href], button, [role="button"], [role="tab"], [role="listitem"], [role="row"], [role="menuitem"], [role="option"], [role="treeitem"], div[data-testid*="cell"], div[data-testid*="list-item"], div[data-testid*="chat-list-item"], tp-yt-paper-tab, yt-tab-shape, ytd-compact-video-renderer, ytd-video-renderer, #pane-side div[tabindex="-1"], [contenteditable="true"]'
  );

  // If target itself is an outer row or list item container, resolve its inner primary interactive leaf (contact name, title, button)
  let leafTarget = target;
  if (target.matches('[role="listitem"], [role="row"], div[data-testid*="cell"], div[data-testid*="list-item"], #pane-side div[tabindex="-1"]')) {
    const innerLeaf = target.querySelector<HTMLElement>(
      'span[title], div[title], [title], a[href], button, [role="button"], [role="gridcell"], .title, [class*="title" i], [class*="name" i]'
    );
    if (innerLeaf && isElementVisible(innerLeaf)) {
      leafTarget = innerLeaf;
    }
  }

  const primaryTarget = container || target;
  try {
    primaryTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch {}

  // Visual highlight: highlight the full interactive container (chat row or button) so it is never clipped by overflow:hidden
  flashHighlight(primaryTarget);

  // Dispatch full interactive event sequence starting at the leaf element, bubbling through container
  simulateInteractiveClick(leafTarget, container);

  const label = (primaryTarget.textContent || primaryTarget.getAttribute('aria-label') || primaryTarget.getAttribute('data-tooltip') || target.getAttribute('title') || '').trim().slice(0, 40);
  return { success: true, message: `Clicked element successfully (${primaryTarget.tagName.toLowerCase()}: "${label}")` };
}

function resolveScrollableContainer(selector?: string): HTMLElement | Window {
  // 1. Explicit selector if provided
  if (selector) {
    try {
      const el = document.querySelector<HTMLElement>(selector);
      if (el) {
        const style = window.getComputedStyle(el);
        if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 10) {
          return el;
        }
        const scrollableChild = Array.from(el.querySelectorAll<HTMLElement>('*')).find((c) => {
          const s = window.getComputedStyle(c);
          return (s.overflowY === 'auto' || s.overflowY === 'scroll') && c.scrollHeight > c.clientHeight + 10;
        });
        if (scrollableChild) return scrollableChild;

        let p = el.parentElement;
        while (p && p !== document.body) {
          const s = window.getComputedStyle(p);
          if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && p.scrollHeight > p.clientHeight + 10) {
            return p;
          }
          p = p.parentElement;
        }
        return el;
      }
    } catch {}
  }

  // 2. WhatsApp Web active conversation messages panel (#main)
  const mainPane = document.querySelector<HTMLElement>('#main');
  if (mainPane && isElementVisible(mainPane)) {
    const whatsappSelectors = [
      '#main div[data-testid="conversation-panel-messages"]',
      '#main div[role="application"]',
      '#main .copyable-area > div[tabindex="0"]',
      '#main .copyable-area > div:nth-child(2)',
      '#main .copyable-area > div',
      '#main div[tabindex="0"]',
      '#main div[tabindex="-1"]',
    ];
    for (const sel of whatsappSelectors) {
      const el = document.querySelector<HTMLElement>(sel);
      if (el && el.scrollHeight > el.clientHeight + 20) {
        return el;
      }
    }
    const mainChildren = Array.from(mainPane.querySelectorAll<HTMLElement>('*'));
    for (const child of mainChildren) {
      if (child.scrollHeight > child.clientHeight + 30) {
        const style = window.getComputedStyle(child);
        if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
          return child;
        }
      }
    }
  }

  // 3. Focused element's scrollable container
  const activeEl = document.activeElement as HTMLElement | null;
  if (activeEl && activeEl !== document.body && activeEl !== document.documentElement) {
    let p: HTMLElement | null = activeEl;
    while (p && p !== document.body && p !== document.documentElement) {
      const s = window.getComputedStyle(p);
      if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && p.scrollHeight > p.clientHeight + 20) {
        return p;
      }
      p = p.parentElement;
    }
  }

  // 4. WhatsApp Web contact list (#pane-side)
  const paneSide = document.querySelector<HTMLElement>('#pane-side, div[data-testid="chat-list"]');
  if (paneSide && isElementVisible(paneSide) && paneSide.scrollHeight > paneSide.clientHeight + 20) {
    return paneSide;
  }

  // 5. Common web app chat and feed containers (Slack, Discord, Telegram, YouTube comments, modal dialogs)
  const commonAppSelectors = [
    'div[role="dialog"] [class*="scroll" i]',
    'div[role="dialog"]',
    '[data-qa="slack_kit_scrollbar"]',
    '[data-qa="message_pane"]',
    '[class*="messagesWrapper"]',
    '[class*="chatContent"]',
    '.messages-container',
    '#comments #contents',
    'ytd-item-section-renderer #contents',
    '[role="feed"]',
    '[role="log"]',
  ];
  for (const sel of commonAppSelectors) {
    try {
      const el = document.querySelector<HTMLElement>(sel);
      if (el && isElementVisible(el) && el.scrollHeight > el.clientHeight + 20) {
        return el;
      }
    } catch {}
  }

  // 6. Check if main document is scrollable (standard articles, blogs, search results)
  const docScrollable =
    document.documentElement.scrollHeight > window.innerHeight + 50 ||
    document.body.scrollHeight > window.innerHeight + 50;

  if (docScrollable) {
    return window;
  }

  // 7. Fallback: find the largest scrollable element on screen
  let largest: HTMLElement | null = null;
  let maxArea = 0;
  const candidates = Array.from(document.querySelectorAll<HTMLElement>('div, section, main, article'));
  for (const el of candidates) {
    if (el.scrollHeight > el.clientHeight + 40 && el.clientHeight > 150 && el.clientWidth > 150 && isElementVisible(el)) {
      const style = window.getComputedStyle(el);
      if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
        const area = el.clientHeight * el.clientWidth;
        if (area > maxArea) {
          maxArea = area;
          largest = el;
        }
      }
    }
  }

  if (largest) return largest;

  return window;
}

function scrollPage(
  direction: 'up' | 'down' | 'top' | 'bottom' | 'element',
  selector?: string
): { success: boolean; message: string } {
  if (direction === 'element' && selector) {
    const el = document.querySelector<HTMLElement>(selector);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      flashHighlight(el);
      return { success: true, message: `Scrolled to element "${selector}"` };
    }
  }

  const container = resolveScrollableContainer(selector);

  if (container === window) {
    const amount = Math.round(window.innerHeight * 0.75);
    if (direction === 'top') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (direction === 'bottom') {
      window.scrollTo({ top: document.documentElement.scrollHeight || document.body.scrollHeight, behavior: 'smooth' });
    } else if (direction === 'down') {
      window.scrollBy({ top: amount, behavior: 'smooth' });
    } else if (direction === 'up') {
      window.scrollBy({ top: -amount, behavior: 'smooth' });
    }
    return { success: true, message: `Scrolled window ${direction} (${amount}px)` };
  }

  const el = container as HTMLElement;
  const amount = Math.max(350, Math.round(el.clientHeight * 0.75));
  const beforeTop = el.scrollTop;
  const delta = direction === 'up' || direction === 'top' ? -amount : amount;

  if (direction === 'top') {
    el.scrollTop = 0;
    try { el.scrollTo({ top: 0, behavior: 'smooth' }); } catch {}
  } else if (direction === 'bottom') {
    el.scrollTop = el.scrollHeight;
    try { el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); } catch {}
  } else if (direction === 'down') {
    const prev = el.scrollTop;
    try { el.scrollBy({ top: amount, behavior: 'smooth' }); } catch {}
    if (el.scrollTop === prev) {
      el.scrollTop += amount;
    }
  } else if (direction === 'up') {
    const prev = el.scrollTop;
    try { el.scrollBy({ top: -amount, behavior: 'smooth' }); } catch {}
    if (el.scrollTop === prev) {
      el.scrollTop = Math.max(0, el.scrollTop - amount);
    }
  }

  // Crucial for WhatsApp Web and virtualized lists: dispatch scroll, wheel, and key events
  el.dispatchEvent(new Event('scroll', { bubbles: true, cancelable: false }));

  try {
    const rect = el.getBoundingClientRect();
    const wheelEvent = new WheelEvent('wheel', {
      deltaY: delta,
      deltaMode: 0,
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: Math.round(rect.left + Math.min(rect.width / 2, 200)),
      clientY: Math.round(rect.top + Math.min(rect.height / 2, 200)),
    });
    el.dispatchEvent(wheelEvent);
  } catch {}

  try {
    const key = direction === 'top' ? 'Home' : direction === 'bottom' ? 'End' : direction === 'up' ? 'PageUp' : 'PageDown';
    el.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key, code: key, bubbles: true, cancelable: true }));
  } catch {}

  flashHighlight(el);

  const containerLabel = el.id ? `#${el.id}` : (el.getAttribute('data-testid') || el.tagName.toLowerCase());
  return {
    success: true,
    message: `Scrolled <${containerLabel}> ${direction} (scrollTop: ${Math.round(beforeTop)} -> ${Math.round(el.scrollTop)}, max: ${el.scrollHeight})`,
  };
}

export interface CaptchaDetectionResult {
  detected: boolean;
  type?: 'cloudflare' | 'recaptcha' | 'hcaptcha' | 'arkose' | 'bing_bot' | 'generic';
  title?: string;
  selector?: string;
}

export function detectCaptchaChallenge(): CaptchaDetectionResult {
  const isElementVisible = (el: Element | null): boolean => {
    if (!el) return false;
    if (!(el instanceof HTMLElement)) return true;
    const style = window.getComputedStyle(el);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.opacity === '0' ||
      style.visibility === 'collapse'
    ) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width <= 5 || rect.height <= 5) return false;
    return true;
  };

  const isInvisibleBadge = (el: Element | null): boolean => {
    if (!el) return false;
    if (el.closest('.grecaptcha-badge, [data-size="invisible"]')) return true;
    if (el.getAttribute('data-size') === 'invisible') return true;
    return false;
  };

  const title = (document.title || '').trim().toLowerCase();
  const bodyText = (document.body ? document.body.innerText || '' : '').toLowerCase().slice(0, 3000);

  // 1. Cloudflare Turnstile & Interactive Challenge
  const cfChallengeRunning = document.querySelector('#challenge-running, #challenge-stage');
  const cfTurnstileFrame = document.querySelector('iframe[src*="challenges.cloudflare.com"]');
  if (
    title.includes('just a moment...') ||
    title.includes('attention required! | cloudflare') ||
    (cfChallengeRunning && isElementVisible(cfChallengeRunning)) ||
    (cfTurnstileFrame && isElementVisible(cfTurnstileFrame)) ||
    (bodyText.includes('checking your browser') && bodyText.includes('cloudflare') && bodyText.length < 1000)
  ) {
    return {
      detected: true,
      type: 'cloudflare',
      title: document.title,
      selector: '#challenge-form, #challenge-stage, iframe[src*="challenges.cloudflare.com"]',
    };
  }

  // 2. Google reCAPTCHA (only active challenge bframe or visible checkbox, never invisible v3 badges)
  const recaptchaBframe = document.querySelector('iframe[src*="recaptcha/api2/bframe"], iframe[src*="recaptcha/enterprise/bframe"]');
  const recaptchaAnchor = document.querySelector('iframe[src*="recaptcha/api2/anchor"], iframe[src*="recaptcha/enterprise/anchor"]');
  if (
    (recaptchaBframe && isElementVisible(recaptchaBframe)) ||
    (recaptchaAnchor && isElementVisible(recaptchaAnchor) && !isInvisibleBadge(recaptchaAnchor))
  ) {
    return {
      detected: true,
      type: 'recaptcha',
      title: document.title,
      selector: 'iframe[src*="recaptcha"]',
    };
  }

  // 3. hCaptcha
  const hcaptchaBox = document.querySelector('iframe[src*="hcaptcha.com/box"], iframe[src*="hcaptcha.com"][title*="challenge" i]');
  const hcaptchaAnchor = document.querySelector('iframe[src*="hcaptcha.com"]');
  if (
    (hcaptchaBox && isElementVisible(hcaptchaBox)) ||
    (hcaptchaAnchor && isElementVisible(hcaptchaAnchor) && !isInvisibleBadge(hcaptchaAnchor))
  ) {
    return {
      detected: true,
      type: 'hcaptcha',
      title: document.title,
      selector: 'iframe[src*="hcaptcha.com"]',
    };
  }

  // 4. Arkose Labs / FunCaptcha
  const arkoseFrame = document.querySelector('#fc-iframe-wrap iframe, iframe[src*="arkoselabs"]');
  if (arkoseFrame && isElementVisible(arkoseFrame)) {
    return {
      detected: true,
      type: 'arkose',
      title: document.title,
      selector: '#fc-iframe-wrap iframe, iframe[src*="arkoselabs"]',
    };
  }

  // 5. Bing Bot Challenge (visible challenge only, no generic challenge form actions)
  const bingCaptcha = document.querySelector('#b_captcha');
  if (
    (bingCaptcha && isElementVisible(bingCaptcha)) ||
    (bodyText.includes('please solve this puzzle') && bodyText.includes('person') && bodyText.length < 800) ||
    (bodyText.includes('verify that you are human') && (bodyText.includes('bing') || title.includes('bing')) && bodyText.length < 800)
  ) {
    return {
      detected: true,
      type: 'bing_bot',
      title: document.title,
      selector: '#b_captcha',
    };
  }

  // 6. Generic Anti-Bot Challenge (must be dedicated interstitial page with short content)
  if (
    title === 'robot check' ||
    title.includes('robot check') ||
    title === 'security check' ||
    title === 'human verification' ||
    title === 'bot verification' ||
    ((bodyText.includes('verify you are human') || bodyText.includes('confirm you are not a robot')) && bodyText.length < 500 && !document.querySelector('main, article'))
  ) {
    return {
      detected: true,
      type: 'generic',
      title: document.title,
      selector: 'body',
    };
  }

  return { detected: false };
}

async function uploadFileToElement(
  refId?: string,
  selector?: string,
  fileData?: { fileName: string; mimeType: string; dataUrl: string }
): Promise<{ success: boolean; message: string; fileName?: string }> {
  if (!fileData || !fileData.dataUrl) {
    return { success: false, message: 'No file data or dataUrl provided for upload.' };
  }

  let target: HTMLElement | null = findTargetElement(refId, selector);

  // If no target element or target is not file input, look for input[type="file"] on page
  if (!target || target.tagName.toLowerCase() !== 'input' || (target as HTMLInputElement).type !== 'file') {
    if (target) {
      const innerInput = target.querySelector<HTMLInputElement>('input[type="file"]');
      if (innerInput) {
        target = innerInput;
      }
    }

    if (!target || target.tagName.toLowerCase() !== 'input') {
      // Check for media tab on Reddit / social post builders
      const isVideoOrImage =
        fileData.mimeType?.startsWith('video/') ||
        fileData.mimeType?.startsWith('image/') ||
        /\.(mp4|webm|mov|mkv|avi|m4v|png|jpg|jpeg|webp)$/i.test(fileData.fileName);
      if (isVideoOrImage) {
        const tabBtns = Array.from(
          document.querySelectorAll<HTMLElement>('button[role="tab"], [role="tab"], button')
        );
        const mediaTab = tabBtns.find((b) => {
          const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
          return (
            txt.includes('images & video') ||
            txt.includes('image & video') ||
            txt.includes('media') ||
            txt === 'images' ||
            txt === 'video'
          );
        });
        if (mediaTab && mediaTab.getAttribute('aria-selected') !== 'true') {
          try {
            mediaTab.click();
            await new Promise((r) => setTimeout(r, 400));
          } catch {}
        }
      }

      const fileInputCandidate = document.querySelector<HTMLInputElement>(
        'input[type="file"], [data-testid="dropzone"] input, .dropzone input'
      );
      if (fileInputCandidate) {
        target = fileInputCandidate;
      }
    }
  }

  if (!target) {
    return {
      success: false,
      message: 'Could not find any file input (<input type="file">) or dropzone on the page.',
    };
  }

  try {
    setNativeValue(target, fileData.fileName, fileData);
    flashHighlight(target);

    const input = target as HTMLInputElement;
    const count = input.files?.length || 0;
    return {
      success: true,
      message: `Successfully attached "${fileData.fileName}" to ${target.tagName.toLowerCase()}${input.name ? `[name="${input.name}"]` : ''} (${count} file(s) attached in DOM).`,
      fileName: fileData.fileName,
    };
  } catch (err: any) {
    return { success: false, message: `Failed to attach file: ${err?.message || err}` };
  }
}

// ---------------------------------------------------------------------------
// Chunked file transfer
//
// Large media (videos) cannot be handed to a page in one message: Chrome
// serializes every message and rejects oversized payloads. Instead the extension
// streams the file as bounded base64 chunks, which we buffer here and
// reassemble into a real File on commit. Nothing is ever base64-encoded as one
// giant string on either side.
// ---------------------------------------------------------------------------

interface PendingFileTransfer {
  fileName: string;
  mimeType: string;
  totalChunks: number;
  chunks: (string | undefined)[];
  startedAt: number;
}

function getTransferStore(): Map<string, PendingFileTransfer> {
  const w = window as any;
  if (!w.__OPENBUA_FILE_TRANSFERS__) w.__OPENBUA_FILE_TRANSFERS__ = new Map();
  return w.__OPENBUA_FILE_TRANSFERS__ as Map<string, PendingFileTransfer>;
}

function base64ChunkToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function beginFileTransfer(
  transferId: string,
  fileName: string,
  mimeType: string,
  totalChunks: number
): { success: boolean; message: string } {
  const store = getTransferStore();
  // Drop stale transfers so an abandoned upload cannot pin memory forever.
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [key, tx] of store) {
    if (tx.startedAt < cutoff) store.delete(key);
  }
  store.set(transferId, { fileName, mimeType, totalChunks, chunks: new Array(totalChunks), startedAt: Date.now() });
  return { success: true, message: `Receiving "${fileName}" in ${totalChunks} chunk(s).` };
}

function pushFileChunk(
  transferId: string,
  index: number,
  data: string
): { success: boolean; message: string; received: number } {
  const tx = getTransferStore().get(transferId);
  if (!tx) {
    return { success: false, message: 'No active file transfer for this chunk.', received: 0 };
  }
  if (index < 0 || index >= tx.totalChunks) {
    return { success: false, message: `Chunk index ${index} out of range.`, received: 0 };
  }
  tx.chunks[index] = data;
  const received = tx.chunks.reduce<number>((n, c) => (c !== undefined ? n + 1 : n), 0);
  return { success: true, message: `Chunk ${index + 1}/${tx.totalChunks} received.`, received };
}

function commitFileTransfer(
  transferId: string,
  refId?: string,
  selector?: string,
  dropEvents = true
): Promise<{ success: boolean; message: string; fileName?: string; attached?: boolean; bytes?: number }> {
  const store = getTransferStore();
  const tx = store.get(transferId);
  if (!tx) {
    return Promise.resolve({ success: false, message: 'No active file transfer to commit.' });
  }

  const missing = tx.chunks.findIndex((c) => c === undefined);
  if (missing >= 0) {
    store.delete(transferId);
    return Promise.resolve({
      success: false,
      message: `File transfer incomplete: chunk ${missing + 1} of ${tx.totalChunks} never arrived.`,
    });
  }

  return (async (): Promise<{
    success: boolean;
    message: string;
    fileName?: string;
    attached?: boolean;
    bytes?: number;
  }> => {
    try {
      const parts = tx.chunks.map((c) => base64ChunkToBytes(c as string));
      const total = parts.reduce((sum, p) => sum + p.length, 0);
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const part of parts) {
        merged.set(part, offset);
        offset += part.length;
      }
      store.delete(transferId);

      const file = new File([merged], tx.fileName, {
        type: tx.mimeType || 'application/octet-stream',
      });

      const result = await attachFileToComposer(file, refId, selector, dropEvents);
      return {
        success: result.success,
        message: result.message,
        fileName: tx.fileName,
        attached: result.attached,
        bytes: total,
      };
    } catch (err: any) {
      store.delete(transferId);
      return { success: false, message: `Failed to build file from transfer: ${err?.message || err}` };
    }
  })();
}

// ---------------------------------------------------------------------------
// Choosing the right file input
//
// Sites like WhatsApp Web keep several hidden <input type="file"> elements, one
// per attachment-menu entry (Camera, Photos & Videos, Document). Taking the
// first in DOM order almost always lands on the media input, whose `accept`
// attribute excludes documents. The file is then set on the input, the app
// renders a convincing preview, and only afterwards does the app reject it with
// "file is not supported" - which looks exactly like a broken file.
//
// So pick the input whose `accept` attribute actually permits the file, and if
// none does, open the attachment menu and select the right entry first.
// ---------------------------------------------------------------------------

/** True when an input's `accept` attribute permits this file. */
function acceptAllowsFile(accept: string | null, file: File): boolean {
  const raw = (accept || '').trim().toLowerCase();
  // No accept attribute, "*" or "*/*" means unconstrained.
  if (!raw || raw === '*' || raw.split(',').some((t) => t.trim() === '*/*')) return true;

  const type = (file.type || '').toLowerCase();
  const name = (file.name || '').toLowerCase();
  const main = type.split('/')[0] || '';

  return raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .some((token) => {
      if (token === type && type) return true; // "application/pdf"
      if (token === `${main}/*` && main) return true; // "video/*"
      if (token.startsWith('.') && name.endsWith(token)) return true; // ".pdf"
      return false;
    });
}

/**
 * Rank a candidate input. Returns -1 when `accept` explicitly excludes the
 * file, so such inputs are only ever used as a last resort.
 */
function scoreFileInput(input: HTMLInputElement, file: File, inDialog: boolean): number {
  const accept = input.getAttribute('accept');
  const raw = (accept || '').trim().toLowerCase();
  const tokens = raw.split(',').map((t) => t.trim()).filter(Boolean);

  let score: number;
  if (!raw) {
    // Unconstrained: this is the generic document picker. Exactly right for
    // documents, and harmless for media too.
    score = 800;
  } else if (tokens.some((t) => t === '*/*')) {
    score = 600;
  } else if (acceptAllowsFile(accept, file)) {
    // Explicitly names this type, e.g. accept*="application/pdf".
    score = 1000;
  } else {
    return -1;
  }

  if (inDialog) score += 50;
  if (input.multiple) score += 25;
  return score;
}

function isFileVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width > 1 && rect.height > 1) return true;
  // File inputs are frequently visually hidden yet still the live control.
  return el.offsetParent !== null;
}

/** Best-scoring file input on the page, or null when nothing accepts the file. */
function bestFileInputFor(file: File): { input: HTMLInputElement | null; score: number } {
  const candidates = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'));
  let best: HTMLInputElement | null = null;
  let bestScore = -1;

  for (const el of candidates) {
    const dialog = el.closest('[role="dialog"], dialog, [aria-modal="true"]');
    const inDialog = Boolean(dialog) && isFileVisible(dialog as HTMLElement);
    const score = scoreFileInput(el, file, inDialog);
    if (score > bestScore) {
      best = el;
      bestScore = score;
    }
  }
  return { input: best, score: bestScore };
}

/** Click the first element matching a selector whose own text matches. */
function clickByText(root: ParentNode, selector: string, keywords: string[]): boolean {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>(selector));
  for (const node of nodes) {
    const haystack = [
      node.innerText,
      node.textContent,
      node.getAttribute('aria-label'),
      node.getAttribute('title'),
      node.getAttribute('data-testid'),
      node.getAttribute('data-tooltip'),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (haystack && keywords.some((k) => haystack.includes(k))) {
      try {
        node.click();
        return true;
      } catch {
        /* try the next candidate */
      }
    }
  }
  return false;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Open the attachment menu and choose the entry that matches this file's kind,
 * mirroring what a human does before the picker appears.
 */
async function openAttachmentMenuForFile(file: File): Promise<boolean> {
  const isMedia = file.type.startsWith('video/') || file.type.startsWith('image/');
  const options = isMedia
    ? ['photos & videos', 'photos and videos', 'photo & video', 'image & video', 'images & video', 'media', 'gallery']
    : ['document', 'file'];

  // Some apps render the menu entries inline; try the entry directly first.
  if (clickByText(document, '[data-testid], [role="menuitem"], button, [role="button"], span, div[title]', options)) {
    await wait(700);
    return true;
  }

  // Otherwise open the menu, then pick the entry.
  const triggers = [
    '[title="Attach"]',
    '[aria-label="Attach"]',
    '[data-testid="attach"]',
    '[data-icon="attach"]',
    'button[aria-label*="Attach" i]',
    '[role="button"][aria-label*="attach" i]',
  ];
  let opened = false;
  for (const selector of triggers) {
    const el = document.querySelector<HTMLElement>(selector);
    if (el) {
      el.click();
      opened = true;
      break;
    }
  }
  if (!opened) {
    opened = clickByText(
      document,
      'button, [role="button"], [aria-label], [title]',
      ['attach', 'attachment', 'add a file', 'paperclip']
    );
  }
  if (!opened) return false;

  await wait(500);
  const picked = clickByText(document, '[data-testid], [role="menuitem"], button, [role="button"], span, div', options);
  await wait(800);
  return picked || opened;
}

/**
 * Attach a File to the right file input and fire the events that React/Vue/Svelte
 * composers listen for. Prefers the file input inside the visible modal, then
 * whichever input's `accept` attribute actually permits the file.
 */
async function attachFileToComposer(
  file: File,
  refId?: string,
  selector?: string,
  dropEvents = true
): Promise<{ success: boolean; message: string; attached: boolean }> {
  let input: HTMLInputElement | null = null;
  let explicit = false;

  if (refId) {
    input =
      document.querySelector<HTMLInputElement>(`[data-autoform-ref="${CSS.escape(refId)}"]`) ||
      (document.getElementById(refId) as HTMLInputElement | null);
    if (input && input.type !== 'file') {
      const inner = input.querySelector<HTMLInputElement>('input[type="file"]');
      input = inner || input;
    }
    explicit = Boolean(input);
  }
  if (!input && selector) {
    try {
      input = document.querySelector<HTMLInputElement>(selector);
      explicit = Boolean(input);
    } catch {
      input = null;
    }
  }

  if (!input) {
    const best = bestFileInputFor(file);
    input = best.input;
  }

  // Nothing on the page accepts this file yet: open the attachment menu so the
  // right entry (Document vs Photos & Videos) reveals its own input.
  let warnedAboutAccept = false;
  if (!explicit && input && !acceptAllowsFile(input.getAttribute('accept'), file)) {
    const best = bestFileInputFor(file);
    if (best.score < 0 || !best.input) {
      await openAttachmentMenuForFile(file);
      const retry = bestFileInputFor(file);
      if (retry.input) {
        input = retry.input;
      } else {
        warnedAboutAccept = true;
      }
    } else {
      input = best.input;
    }
  }

  if (!input) {
    // Last resort: platform media tabs (Reddit "Images & Video", etc.) that only
    // reveal their input once the media tab is opened.
    if (file.type.startsWith('video/') || file.type.startsWith('image/')) {
      const tabButton = Array.from(
        document.querySelectorAll<HTMLElement>('button[role="tab"], [role="tab"], button')
      ).find((b) => {
        const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
        return (
          txt.includes('images & video') ||
          txt.includes('image & video') ||
          txt === 'media' ||
          txt === 'images' ||
          txt === 'video'
        );
      });
      if (tabButton && tabButton.getAttribute('aria-selected') !== 'true') {
        tabButton.click();
        await wait(400);
      }
    }
    input = bestFileInputFor(file).input;
  }

  if (!input) {
    return {
      success: false,
      attached: false,
      message: `No usable file input found for "${file.name}" (${file.type || 'unknown type'}). Open the chat or composer, click the attach button and choose the right option, then try again.`,
    };
  }

  const acceptAttr = input.getAttribute('accept') || '';
  const acceptsThisFile = acceptAllowsFile(acceptAttr, file);
  if (!acceptsThisFile) {
    warnedAboutAccept = true;
  }

  try {
    const transfer = new DataTransfer();
    transfer.items.add(file);

    // Assign via the native setter so React's value tracker does not swallow
    // the change (React overrides the `value`/`files` property descriptor).
    try {
      const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'files');
      if (descriptor?.set) {
        descriptor.set.call(input, transfer.files);
      } else {
        input.files = transfer.files;
      }
    } catch {
      input.files = transfer.files;
    }

    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

    if (dropEvents) {
      const dropzone =
        input.closest('[data-dropzone], [data-testid="dropzone"], .dropzone, [class*="dropzone"]') ||
        input.parentElement;
      if (dropzone && dropzone !== input) {
        for (const type of ['dragenter', 'dragover', 'drop']) {
          try {
            dropzone.dispatchEvent(
              new DragEvent(type, { bubbles: true, cancelable: true, composed: true, dataTransfer: transfer })
            );
          } catch {
            /* DragEvent unsupported */
          }
        }
      }
    }

    try {
      flashHighlight(input);
    } catch {
      /* non-fatal */
    }

    const attached = Boolean(input.files && input.files.length > 0);
    const scope = acceptAttr ? `accept="${acceptAttr}"` : 'no accept attribute';

    // This is the WhatsApp "file is not supported" trap: the file is on the
    // input and a preview renders, but the app validates against accept and
    // throws the file away. Say so plainly instead of reporting success.
    const acceptWarning = warnedAboutAccept
      ? ` WARNING: the file input (${scope}) does not accept ${file.type || file.name}. ` +
        `This site keeps separate inputs per attachment option and will likely reject this file as "not supported" even though a preview rendered. ` +
        `Open the attach menu, choose "${file.type.startsWith('video/') || file.type.startsWith('image/') ? 'Photos & Videos' : 'Document'}", and attach again.`
      : '';

    return {
      success: true,
      attached,
      message: attached
        ? `Attached "${file.name}" (${file.size} bytes, ${file.type}) to the file input (${scope}).${acceptWarning}`
        : `Set "${file.name}" on the file input but the page reported no file.${acceptWarning}`,
    };
  } catch (err: any) {
    return { success: false, attached: false, message: `Failed to attach file: ${err?.message || err}` };
  }
}

// Listen for messages from the Side Panel / Extension
if (!(window as any).__OPENBUA_CONTENT_SCRIPT_INITIALIZED__) {
  (window as any).__OPENBUA_CONTENT_SCRIPT_INITIALIZED__ = true;

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  try {
    switch (request.action) {
      case 'CHECK_CAPTCHA': {
        const captchaResult = detectCaptchaChallenge();
        sendResponse({ success: true, data: captchaResult });
        break;
      }
      case 'INSPECT_PAGE_FORM': {
        const summary = inspectAllFormElements(request.selector);
        sendResponse({ success: true, data: summary });
        break;
      }

      case 'FILL_FORM_FIELDS': {
        fillFormFields(request.assignments || [], request.pressEnter)
          .then((result) => {
            sendResponse({ success: true, data: result });
          })
          .catch((err) => {
            sendResponse({ success: false, error: err?.message || String(err) });
          });
        break;
      }

      case 'UPLOAD_FILE_TO_ELEMENT': {
        uploadFileToElement(request.refId, request.selector, request.fileData)
          .then((result) => {
            sendResponse(result);
          })
          .catch((err) => {
            sendResponse({ success: false, message: err?.message || String(err) });
          });
        break;
      }

      // Chunked media transfer: BEGIN -> N chunks -> COMMIT. Used for anything
      // too large to send in a single message (videos, big images).
      case 'PREPARE_FILE_UPLOAD': {
        sendResponse(
          beginFileTransfer(request.transferId, request.fileName, request.mimeType, request.totalChunks)
        );
        break;
      }

      case 'FILE_UPLOAD_CHUNK': {
        sendResponse(pushFileChunk(request.transferId, request.index, request.data));
        break;
      }

      case 'COMMIT_FILE_UPLOAD': {
        commitFileTransfer(
          request.transferId,
          request.refId,
          request.selector,
          request.dropEvents !== false
        )
          .then(sendResponse)
          .catch((err) => {
            sendResponse({ success: false, message: err?.message || String(err) });
          });
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
        // 0. Extract active, truly visible modal / dialog text (Gmail compose, popups, overlays)
        // Must be genuinely visible on screen and sufficiently sized to avoid hidden YouTube TV-sync dialogs or invisible analytics overlays
        const activeModals = Array.from(document.querySelectorAll<HTMLElement>(
          'div[role="dialog"]:not([aria-hidden="true"]), dialog[open], .M9, div[aria-label*="New Message" i], div[aria-label*="Compose" i]'
        )).filter((m) => {
          if (!isElementVisible(m)) return false;
          const rect = m.getBoundingClientRect();
          if (rect.width < 50 || rect.height < 50) return false;
          if (rect.bottom < 0 || rect.right < 0 || rect.top > (window.innerHeight || document.documentElement.clientHeight)) return false;
          const text = (m.innerText || m.textContent || '').toLowerCase();
          if (text.includes('watch history and influence tv recommendations')) return false;
          return true;
        });
        let modalExcerpt = '';
        if (activeModals.length > 0) {
          modalExcerpt = activeModals
            .map((m) => (m.innerText || m.textContent || '').trim())
            .filter((t) => t.length > 0)
            .join('\n\n');
        }

        // Helper to check ad URLs and tracking bloat
        const isAdUrl = (url: string) => {
          const u = url.toLowerCase();
          return (
            u.includes('googleadservices.com') ||
            u.includes('doubleclick.net') ||
            u.includes('/pagead/') ||
            u.includes('aclk?') ||
            u.includes('adclick') ||
            u.includes('ad_type=')
          );
        };

        // 1. Gather interactive / item links (especially video links, search results, nav links)
        const links: string[] = [];
        const seenLinks = new Set<string>();
        document.querySelectorAll<HTMLAnchorElement>('a[href], a#video-title, [role="link"]').forEach((a) => {
          const text = (a.textContent || a.getAttribute('aria-label') || a.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
          const href = a.getAttribute('href') || '';
          if (!href || isAdUrl(href)) return;
          if (text && text.length > 2 && text.length < 100 && !seenLinks.has(text.toLowerCase())) {
            seenLinks.add(text.toLowerCase());
            if (links.length < 35) {
              let fullUrl = href.startsWith('http') ? href : window.location.origin + href;
              if (isAdUrl(fullUrl)) return;
              if (fullUrl.length > 250 && fullUrl.includes('?')) {
                try {
                  const parsed = new URL(fullUrl);
                  if (parsed.hostname.includes('youtube.com')) {
                    const v = parsed.searchParams.get('v');
                    if (v) fullUrl = `${parsed.origin}/watch?v=${v}`;
                  }
                } catch {}
              }
              links.push(`- Link/Video: "${text}" (${fullUrl})`);
            }
          }
        });

        // 1b. Gather visible tabs (YouTube channel tabs, nav tabs, etc.)
        const tabs: string[] = [];
        const seenTabs = new Set<string>();
        document.querySelectorAll<HTMLElement>('[role="tab"], tp-yt-paper-tab, yt-tab-shape, [role="tablist"] [role="tab"]').forEach((t) => {
          if (!isElementVisible(t)) return;
          const text = (t.textContent || t.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
          if (text && text.length > 1 && text.length < 50 && !seenTabs.has(text.toLowerCase())) {
            seenTabs.add(text.toLowerCase());
            if (tabs.length < 15) {
              tabs.push(`- Tab: "${text}"`);
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

        // 2b. Extract active chat conversation messages (WhatsApp Web, Slack, Telegram, Discord)
        let chatExcerpt = '';
        const mainPane = document.querySelector<HTMLElement>('#main');

        if (mainPane) {
          // WhatsApp Web active chat window detected
          try {
            // Auto-click "scroll to bottom" button if unread / new messages arrived below viewport
            const scrollDownBtn = mainPane.querySelector<HTMLElement>(
              'button[aria-label*="down" i], button[aria-label*="scroll" i], button[aria-label*="unread" i], [data-testid="down-context"], [data-icon="down"]'
            );
            if (scrollDownBtn) {
              try { scrollDownBtn.click(); } catch {}
            }

            // Ensure messages panel scroll container is scrolled to the bottom to mount virtualized rows
            const whatsappScrollSels = [
              '#main div[data-testid="conversation-panel-messages"]',
              '#main div[role="application"]',
              '#main .copyable-area > div[tabindex="0"]',
              '#main .copyable-area > div:nth-child(2)',
              '#main .copyable-area > div',
            ];
            for (const sel of whatsappScrollSels) {
              const el = document.querySelector<HTMLElement>(sel);
              if (el && el.scrollHeight > el.clientHeight + 20) {
                if (el.scrollHeight - el.scrollTop - el.clientHeight > 150) {
                  el.scrollTop = el.scrollHeight;
                }
                break;
              }
            }
          } catch {}

          // Extract Chat Title / Partner Name from header
          const headerEl = mainPane.querySelector('header');
          const titleEl = headerEl?.querySelector('span[title], [dir="auto"], div[role="button"] span');
          const chatTitle = (titleEl?.getAttribute('title') || titleEl?.textContent || '').trim() || 'Chat Contact';

          // Collect message bubbles (avoiding parent-child duplicate selection)
          let candidateBubbles = Array.from(mainPane.querySelectorAll<HTMLElement>(
            '.message-in, .message-out'
          ));
          if (candidateBubbles.length === 0) {
            candidateBubbles = Array.from(mainPane.querySelectorAll<HTMLElement>(
              'div[role="row"], [data-testid="msg-container"]'
            ));
          }

          // Filter out elements that enclose other candidate elements (prevents row wrapping .message-in duplication)
          const distinctBubbles = candidateBubbles.filter((bubble) => {
            return !candidateBubbles.some((other) => other !== bubble && bubble.contains(other));
          });

          interface ParsedMessage {
            direction: 'incoming' | 'outgoing';
            author: string;
            time: string;
            text: string;
            status: string;
          }

          const parsedList: ParsedMessage[] = [];

          distinctBubbles.forEach((bubble) => {
            const isIncoming = bubble.classList.contains('message-in') ||
              !!bubble.closest('.message-in') ||
              bubble.getAttribute('data-id')?.startsWith('false_') ||
              (!bubble.classList.contains('message-out') && !bubble.closest('.message-out') && !bubble.getAttribute('data-id')?.startsWith('true_') && !!bubble.querySelector('.message-in'));
            const isOutgoing = bubble.classList.contains('message-out') ||
              !!bubble.closest('.message-out') ||
              bubble.getAttribute('data-id')?.startsWith('true_');

            const direction: 'incoming' | 'outgoing' = isOutgoing ? 'outgoing' : 'incoming';

            const copyable = bubble.querySelector<HTMLElement>('.copyable-text[data-pre-plain-text]') ||
              (bubble.hasAttribute('data-pre-plain-text') ? bubble : null);
            const pre = copyable?.getAttribute('data-pre-plain-text') || '';

            let author = isOutgoing ? 'You' : chatTitle;
            let time = '';

            if (pre) {
              const preMatch = pre.match(/\[(\d{1,2}:\d{2}(?:\s*[ap]m)?)[^\]]*\]\s*([^:]+):/i);
              if (preMatch) {
                time = preMatch[1];
                if (!isOutgoing) {
                  author = preMatch[2].trim() || chatTitle;
                }
              }
            }

            if (!time) {
              const metaEl = bubble.querySelector<HTMLElement>('[data-testid="msg-meta"], .x1c4vz4f, span[dir="auto"]');
              const metaText = metaEl?.textContent?.trim() || '';
              const timeMatch = metaText.match(/\b\d{1,2}:\d{2}(?:\s*[ap]m)?\b/i);
              if (timeMatch) time = timeMatch[0];
            }

            if (!isOutgoing && author === chatTitle) {
              const authorEl = bubble.querySelector<HTMLElement>('[data-testid="author"], span._ao3e, span[color]');
              if (authorEl && authorEl.textContent?.trim()) {
                author = authorEl.textContent.trim();
              }
            }

            const textEl = bubble.querySelector<HTMLElement>(
              '.selectable-text.copyable-text, .selectable-text, [data-testid="selectable-text"], span[dir="ltr"], span[dir="rtl"]'
            );
            let text = (textEl ? (textEl.innerText || textEl.textContent || '') : (bubble.innerText || bubble.textContent || '')).trim();
            text = text.replace(/\n\d{1,2}:\d{2}(?:\s*[ap]m)?(?:\s*✔+)?$/i, '').trim();

            if (!text) {
              if (bubble.querySelector('[data-testid="audio-play"], [data-icon="audio-play"]')) {
                text = '[Voice Message / Audio Note]';
              } else if (bubble.querySelector('img[src*="blob:"], [data-testid="image-thumb"]')) {
                text = '[Image / Photo Attachment]';
              } else if (bubble.querySelector('[data-testid="document-thumb"], [data-icon="document"]')) {
                text = '[Document Attachment]';
              } else if (bubble.querySelector('[data-testid="sticker"]')) {
                text = '[Sticker]';
              }
            }

            let status = '';
            if (isOutgoing) {
              const isRead = !!bubble.querySelector('[data-icon="msg-dblcheck-ack"], [data-testid="msg-dblcheck-ack"]');
              const isDelivered = !isRead && !!bubble.querySelector('[data-icon="msg-dblcheck"], [data-testid="msg-dblcheck"]');
              status = isRead ? ' [Read]' : isDelivered ? ' [Delivered]' : ' [Sent]';
            }

            if (text) {
              const prev = parsedList[parsedList.length - 1];
              if (!prev || prev.text !== text || prev.direction !== direction) {
                parsedList.push({ direction, author, time, text, status });
              }
            }
          });

          if (parsedList.length > 0) {
            const formattedMsgs = parsedList.slice(-25).map((m) => {
              const timeTag = m.time ? `[${m.time}] ` : '';
              const dirTag = m.direction === 'outgoing' ? '[Outgoing (You)]' : `[Incoming from ${m.author}]`;
              return `${timeTag}${dirTag}: ${m.text}${m.status}`;
            });

            const lastMsg = parsedList[parsedList.length - 1];
            const isWaitingForUs = lastMsg.direction === 'incoming';

            chatExcerpt = `Active WhatsApp Chat: "${chatTitle}"\n` +
              formattedMsgs.join('\n') +
              `\n\n>>> CURRENT CHAT STATE with "${chatTitle}":\n` +
              `- Latest Message: [${lastMsg.direction.toUpperCase()} from ${lastMsg.author}${lastMsg.time ? ` at ${lastMsg.time}` : ''}]: "${lastMsg.text}"\n` +
              `- Status: ${isWaitingForUs ? 'WAITING FOR YOUR REPLY (Friend has replied! Formulate your response now)' : 'WAITING FOR CONTACT TO REPLY (You sent the last message. Use wait_seconds before checking again)'}`;
          }
        } else {
          // Generic chat container (Slack, Telegram, Discord, web chat)
          const genericChatNodes = Array.from(document.querySelectorAll<HTMLElement>(
            '[role="log"] [role="row"], [data-qa="message_content"], .message-list-item, [data-testid*="message" i]'
          ));
          if (genericChatNodes.length > 0) {
            const lines = genericChatNodes
              .map((n) => (n.innerText || n.textContent || '').trim())
              .filter(Boolean);
            if (lines.length > 0) {
              chatExcerpt = lines.slice(-25).join('\n');
            }
          }
        }

        // 3. Clean excerpt of page content (up to 10,000 characters for rich model context)
        let mainText = '';
        const mainEl = document.querySelector('#main, main, article, #content, [role="main"]') || document.body;
        if (mainEl) {
          mainText = (mainEl as HTMLElement).innerText || '';
        } else if (document.body) {
          mainText = document.body.innerText || '';
        }
        mainText = mainText.replace(/\n\s*\n\s*\n/g, '\n\n').slice(0, 10000);

        let formatted = `Title: ${document.title}\nURL: ${window.location.href}\n\n`;
        if (chatExcerpt) {
          formatted += `### Active Chat Conversation Messages:\n${chatExcerpt}\n\n`;
        }
        if (modalExcerpt) {
          formatted += `### Active Dialog / Compose Window Content:\n${modalExcerpt}\n\n`;
        }
        if (tabs.length > 0) {
          formatted += `### Tabs on Page:\n${tabs.join('\n')}\n\n`;
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
}

console.log('[AutoForm AI] Content script loaded and active.');

// Detect Arc Browser via injected CSS custom properties
try {
  const rootStyle = getComputedStyle(document.documentElement);
  const isArc = !!(
    rootStyle.getPropertyValue('--arc-palette-title') ||
    rootStyle.getPropertyValue('--arc-palette-subtitle') ||
    rootStyle.getPropertyValue('--arc-background-simple-color') ||
    (window as any).arc
  );
  if (isArc) {
    chrome.storage?.local?.set({ isArcBrowser: true });
    chrome.runtime?.sendMessage?.({ type: 'ARC_BROWSER_DETECTED' }).catch(() => {});
  }
} catch {}

