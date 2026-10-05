import { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { getActiveTab } from './browser-bridge';

const blocked = (message: string): AgentToolResult => ({
  content: [{ type: 'text', text: message }], details: { success: false, dispatched: false, blocked: true, message },
});

export interface DocsEditPolicy { cloneRequired: boolean; taskEpoch: number }

// Per tool-set/session and per document: observations never replenish undo credit.
export function protectDocsEdits(tools: AgentTool<any>[], policy?: DocsEditPolicy): AgentTool<any>[] {
  let epoch = policy?.taskEpoch;
  const documents = new Map<string, { observed: boolean; undoAvailable: boolean; copied: boolean; cloned: boolean; pendingPaste: boolean; pasteAttempted: boolean; pasteFailed: boolean }>();
  const relevant = new Set(['type_text', 'press_key_combination', 'click_at_position', 'click_element',
    'scroll_page', 'capture_tab_screenshot', 'inspect_docs_editor', 'find_docs_text', 'select_docs_text',
    'set_docs_formatting', 'docs_clipboard', 'confirm_docs_clone', 'clipboard_action']);
  return tools.map(tool => !relevant.has(tool.name) ? tool : {
    ...tool,
    execute: async (...args: Parameters<typeof tool.execute>) => {
      const tab = await getActiveTab();
      if (!tab?.id || !/^https:\/\/docs\.google\.com\/document\//.test(tab.url || '')) return tool.execute(...args);
      if (epoch !== policy?.taskEpoch) { documents.clear(); epoch = policy?.taskEpoch; }
      const key = `${tab.id}:${(tab.url || '').split('#')[0]}`;
      let state = documents.get(key);
      if (!state) { state = { observed: false, undoAvailable: false, copied: false, cloned: false, pendingPaste: false, pasteAttempted: false, pasteFailed: false }; documents.set(key, state); }
      const params = args[1] as Record<string, any>;
      if (tool.name === 'confirm_docs_clone') {
        if (!state.pendingPaste || !state.observed) return blocked('No clone confirmation recorded. Inspect a fresh screenshot of a dispatched paste first.');
        state.cloned = params.outcome === 'duplicated';
        state.pendingPaste = params.outcome === 'merged';
        state.pasteFailed = params.outcome === 'no_change' || params.outcome === 'wrong_location';
      }
      if (policy?.cloneRequired && tool.name === 'docs_clipboard' && params.action === 'paste' && state.pasteAttempted) {
        return blocked('No second paste dispatched. Inspect and report the previous paste with confirm_docs_clone. If no duplicate appeared, stop and report the clipboard failure instead of pasting repeatedly or editing the original.');
      }
      const inputKey = String(params.key || '').toLowerCase();
      if (tool.name === 'clipboard_action' || (tool.name === 'press_key_combination' && params.ctrlKey && ['c', 'v', 'x', 'd'].includes(inputKey))) {
        return blocked('No clipboard shortcut dispatched. Use docs_clipboard for Docs copy, cut or paste and inspect the returned screenshot. Synthetic shortcuts do not prove a clipboard operation, and Ctrl+D is not block duplication.');
      }
      if (policy?.cloneRequired && !state.cloned && tool.name === 'type_text') {
        return blocked('No text inserted. This task asks to match existing formatting. Locate the source with find_docs_text, select its complete project block with select_docs_text, verify the highlight, docs_clipboard copy, place and inspect the destination caret, then docs_clipboard paste. Verify the clone before replacing individual text runs. Do not build a mixed-format project by typing into its title paragraph.');
      }
      if (policy?.cloneRequired && tool.name === 'docs_clipboard' && params.action === 'paste' && !state.copied) {
        return blocked('No paste dispatched. Copy the verified source project block using docs_clipboard first, rather than pasting unknown clipboard contents.');
      }
      const undo = tool.name === 'press_key_combination' && params.ctrlKey && String(params.key).toLowerCase() === 'z' && !params.shiftKey;
      if (undo) {
        if (!state.observed) return blocked('No Undo dispatched. Inspect the current document screenshot first.');
        if (!state.undoAvailable) return blocked('No Undo dispatched. There is no unused undo allowance for an edit from this run. Repeated Undo can erase unrelated history. Compare before/after screenshots: text present before this run is pre-existing, not evidence that the latest insert landed. Select and verify only the specific incorrect text if cleanup is required.');
        state.undoAvailable = false; // Reserve before awaiting: a batch cannot issue multiple undos.
        state.observed = false;
      }
      const deletes = tool.name === 'press_key_combination' && ['backspace', 'delete'].includes(inputKey);
      if ((tool.name === 'type_text' || tool.name === 'docs_clipboard' || deletes) && !state.observed) {
        return blocked('No edit dispatched. Capture or inspect the document AFTER the most recent caret/selection movement and verify the intended location before typing or pasting. A successful coordinate click does not prove caret placement.');
      }
      const moves = ['click_at_position', 'click_element', 'scroll_page', 'select_docs_text', 'press_key_combination'].includes(tool.name) || (tool.name === 'docs_clipboard' && params.action !== 'copy');
      if (moves) state.observed = false;
      if (tool.name === 'docs_clipboard' && params.action === 'paste') state.pasteAttempted = true;
      const result = await tool.execute(...args);
      const details = result.details as Record<string, any> | undefined;
      if (result.content.some(item => item.type === 'image')) state.observed = true;
      if (tool.name === 'type_text' && details?.inserted !== false && !details?.error && (details?.success || details?.chars > 0)) {
        state.observed = false;
        state.undoAvailable = true;
        // Old typing implementations check substring presence, not an actual edit.
        // Never let pre-existing text or an input buffer masquerade as confirmation.
        return {
          content: [{ type: 'text', text: 'Text input was dispatched to Google Docs. Insertion, location and formatting are UNVERIFIED: existing DOM text and the hidden input buffer cannot prove this edit landed. Capture a fresh screenshot and compare it with the image BEFORE this call. Do not retry or undo because a previously existing string is still visible. At most one Undo is allowed for this edit after inspection.' }],
          details: { ...details, success: false, dispatched: true, verified: false, placementVerified: false },
        };
      }
      if (tool.name === 'docs_clipboard' && params.action === 'copy') {
        state.copied = Boolean(details?.action?.clipboardVerified);
        state.cloned = false;
        state.pendingPaste = false;
      }
      if (tool.name === 'docs_clipboard' && params.action === 'paste') {
        state.pendingPaste = Boolean(details?.action?.dispatched);
        state.cloned = false;
        if (!state.pendingPaste) state.pasteAttempted = false; // No event sent: fixing focus can retry safely.
        else state.undoAvailable = true;
      }
      if (policy?.cloneRequired && state.observed) {
        let nextAction: string;
        if (state.pasteFailed) nextAction = 'No complete duplicate was confirmed. Keep the original unchanged and report the clipboard failure. Do not repeat paste or edit the original as if it were a clone.';
        else if (state.pendingPaste && tool.name === 'confirm_docs_clone' && params.outcome === 'merged') nextAction = 'The pasted copy exists but its boundary is joined. Place and inspect the caret exactly between the pasted final paragraph and the original heading, press Enter once, inspect again, then confirm_docs_clone. Do not add Enter when no new copy is visible.';
        else if (state.pendingPaste) nextAction = 'Next: inspect this screenshot and call confirm_docs_clone. Report duplicated only if a second complete block and the preserved original are visible; otherwise report no_change, merged or wrong_location. Do not edit the source or retry paste.';
        else if (state.cloned) nextAction = 'Next: select_docs_text for one text run in the pasted clone, inspect its highlight, then type_text its replacement without paragraph breaks.';
        else if (tool.name === 'docs_clipboard' && params.action === 'copy' && state.copied) nextAction = 'Next: click_at_position at the start of the source heading to insert above it, then inspect the destination caret before docs_clipboard paste.';
        else if (state.copied) nextAction = 'Next: if the destination caret is correct in this image, call docs_clipboard paste. Otherwise correct its location and inspect again.';
        else if (tool.name === 'select_docs_text' && details?.dispatched) nextAction = 'Next: if the highlight covers the complete source project, call docs_clipboard copy. Otherwise correct the selection.';
        else nextAction = 'Next: read the screenshot attached to this result. If the complete source project is visible, call select_docs_text now using its start/end image pixels. If not, scroll_page to reveal it. Empty DOM labels do not require another find_docs_text query. Do not reason about Enter or formatting inheritance.';
        return { content: [...result.content, { type: 'text', text: nextAction }], details: { ...details, nextAction } };
      }
      return result;
    },
  });
}
