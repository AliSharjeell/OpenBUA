import { Type } from '@sinclair/typebox';
import { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { runDocsInspection, runDocsToggle } from './docs-editor';
import { captureTabScreenshot, clickAtPosition } from './browser-bridge';

async function observedResult(details: unknown): Promise<AgentToolResult> {
  const content: AgentToolResult['content'] = [{ type: 'text', text: JSON.stringify(details) }];
  try {
    const screenshot = await captureTabScreenshot();
    const match = screenshot.match(/^data:([^;]+);base64,(.+)$/);
    if (match) content.push({ type: 'image', mimeType: match[1], data: match[2] });
  } catch { content.push({ type: 'text', text: 'Screenshot unavailable. Capture one before further editing.' }); }
  return { content, details };
}

const InspectSchema = Type.Object({});
export const inspectDocsEditorTool: AgentTool<typeof InspectSchema> = {
  name: 'inspect_docs_editor', label: 'Inspect Docs Toolbar and Selection',
  description: 'Inspect Google Docs toolbar DOM: bold, italic, underline, list controls, paragraph style, font and size, with actual pressed/checked states and screenshot coordinates. Also returns visible selection text when exposed and a fresh screenshot. Use after selecting text and before changing formatting. Canvas body text is not a normal DOM text field.',
  parameters: InspectSchema,
  execute: async () => {
    try { return await observedResult(await runDocsInspection()); }
    catch (error) { return { content: [{ type: 'text', text: String(error) }], details: { success: false } }; }
  },
};

const FormatSchema = Type.Object({
  controlId: Type.Union(['boldButton', 'italicButton', 'underlineButton', 'bulletedListButton', 'numberedListButton'].map(id => Type.Literal(id))),
  enabled: Type.Boolean({ description: 'Desired state, not a blind toggle. Select the intended text first.' }),
});
export const setDocsFormattingTool: AgentTool<typeof FormatSchema> = {
  name: 'set_docs_formatting', label: 'Set Docs Formatting',
  description: 'Set bold, italic, underline or native list formatting to a desired on/off state using the DOM toolbar. Does nothing if already correct; refuses unknown/mixed states. Returns current toolbar and screenshot for verification. Use native bullets with text that has no literal bullet prefix. Paragraph style controls found by inspect_docs_editor can be opened using click_element and selected through their menus.',
  parameters: FormatSchema,
  execute: async (_id, params) => {
    try {
      const action = await runDocsToggle(params.controlId, params.enabled);
      return await observedResult({ action, editor: await runDocsInspection() });
    } catch (error) { return { content: [{ type: 'text', text: String(error) }], details: { success: false } }; }
  },
};

const Point = Type.Object({ x: Type.Number({ minimum: 0 }), y: Type.Number({ minimum: 0 }) });
const SelectSchema = Type.Object({ start: Point, end: Point });
export const selectDocsTextTool: AgentTool<typeof SelectSchema> = {
  name: 'select_docs_text', label: 'Select Docs Text Block',
  description: 'Select a visible Google Docs text chunk by clicking its start and Shift-clicking its end. Coordinates are pixels from the latest full screenshot, not CSS pixels. Returns selection DOM, formatting states and a screenshot: verify the highlighted range covers exactly the source heading, technologies and final bullet before clipboard_action copy. Both endpoints must be visible. For longer blocks, click the start, scroll, then click_at_position with shiftKey true at the end. Never copy/paste or replace until the highlighted range is visually verified.',
  parameters: SelectSchema,
  execute: async (_id, params) => {
    try {
      await runDocsInspection(); // Validate the active document before moving its caret.
      const start = await clickAtPosition({ ...params.start });
      if (!start.success) return await observedResult({ success: false, start });
      const end = await clickAtPosition({ ...params.end, shiftKey: true });
      return await observedResult({ dispatched: end.success, start, end, editor: await runDocsInspection(), note: 'Verify the highlighted range in the screenshot. Dispatch success does not establish selection correctness.' });
    } catch (error) { return { content: [{ type: 'text', text: String(error) }], details: { success: false } }; }
  },
};
