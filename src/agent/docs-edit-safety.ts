import { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { getActiveTab } from './browser-bridge';

const blocked = (message: string): AgentToolResult => ({
  content: [{ type: 'text', text: message }], details: { success: false, dispatched: false, blocked: true },
});

// Per tool-set/session and per document: observations never replenish undo credit.
export function protectDocsEdits(tools: AgentTool<any>[]): AgentTool<any>[] {
  const documents = new Map<string, { observed: boolean; undoAvailable: boolean }>();
  const relevant = new Set(['type_text', 'press_key_combination', 'click_at_position', 'click_element',
    'scroll_page', 'capture_tab_screenshot', 'inspect_docs_editor', 'find_docs_text', 'select_docs_text',
    'set_docs_formatting', 'docs_clipboard', 'clipboard_action']);
  return tools.map(tool => !relevant.has(tool.name) ? tool : {
    ...tool,
    execute: async (...args: Parameters<typeof tool.execute>) => {
      const tab = await getActiveTab();
      if (!tab?.id || !/^https:\/\/docs\.google\.com\/document\//.test(tab.url || '')) return tool.execute(...args);
      const key = `${tab.id}:${(tab.url || '').split('#')[0]}`;
      let state = documents.get(key);
      if (!state) { state = { observed: false, undoAvailable: false }; documents.set(key, state); }
      const params = args[1] as Record<string, any>;
      const undo = tool.name === 'press_key_combination' && params.ctrlKey && String(params.key).toLowerCase() === 'z' && !params.shiftKey;
      if (undo) {
        if (!state.observed) return blocked('No Undo dispatched. Inspect the current document screenshot first.');
        if (!state.undoAvailable) return blocked('No Undo dispatched. There is no unused undo allowance for an edit from this run. Repeated Undo can erase unrelated history. Compare before/after screenshots: text present before this run is pre-existing, not evidence that the latest insert landed. Select and verify only the specific incorrect text if cleanup is required.');
        state.undoAvailable = false; // Reserve before awaiting: a batch cannot issue multiple undos.
        state.observed = false;
      }
      if ((tool.name === 'type_text' || (tool.name === 'docs_clipboard' && params.action !== 'copy')) && !state.observed) {
        return blocked('No edit dispatched. Capture or inspect the document AFTER the most recent caret/selection movement and verify the intended location before typing or pasting. A successful coordinate click does not prove caret placement.');
      }
      const moves = ['click_at_position', 'click_element', 'scroll_page', 'select_docs_text', 'press_key_combination'].includes(tool.name);
      if (moves) state.observed = false;
      const result = await tool.execute(...args);
      const details = result.details as Record<string, any> | undefined;
      if (result.content.some(item => item.type === 'image')) state.observed = true;
      if (tool.name === 'type_text' && details?.inserted !== false && !details?.error) {
        state.observed = false;
        state.undoAvailable = true;
        // Old typing implementations check substring presence, not an actual edit.
        // Never let pre-existing text or an input buffer masquerade as confirmation.
        return {
          content: [{ type: 'text', text: 'Text input was dispatched to Google Docs. Insertion, location and formatting are UNVERIFIED: existing DOM text and the hidden input buffer cannot prove this edit landed. Capture a fresh screenshot and compare it with the image BEFORE this call. Do not retry or undo because a previously existing string is still visible. At most one Undo is allowed for this edit after inspection.' }],
          details: { ...details, success: false, dispatched: true, verified: false, placementVerified: false },
        };
      }
      if (tool.name === 'docs_clipboard' && params.action !== 'copy' && details?.action?.commandAccepted) state.undoAvailable = true;
      return result;
    },
  });
}
