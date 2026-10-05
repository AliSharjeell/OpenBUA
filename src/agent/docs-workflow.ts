export const DOCS_EDITOR_INSTRUCTIONS = `
23. DOCUMENT EDITORS:
Google Docs body text is usually canvas-rendered; toolbar controls are normal DOM.
Do not fill hidden contenteditables to edit the document. Hidden input buffers and
sidebar outlines do not prove caret location or insertion.

MATCH AN EXISTING PROJECT'S FORMATTING: follow exactly one workflow.
1. find_docs_text once for the existing heading. It returns a screenshot even when
   matches is empty. Read that image. Empty labels mean use the image, not repeat
   the lookup with a longer query. If the source is offscreen, scroll and inspect.
2. Once heading through final bullet are visible, immediately call select_docs_text
   with start/end pixels read from the screenshot. Inspect the returned highlight.
   You do not need to reason about Enter, paragraph splitting or bold inheritance.
3. docs_clipboard copy. Keep the original entry intact when adding another project.
4. click_at_position at the source heading's start to insert above it, then inspect
   the new caret screenshot. docs_clipboard paste and inspect the complete clone.
5. Replace individual text runs of the clone using select_docs_text then type_text.
   Preserve paragraph breaks, title style, native list markers and bold label runs.
   Replace technology names separately from the bold Technologies: label. Do not
   replace the whole clone with multiline plain text or type literal bullet dots.
6. Verify all new text, formatting, placement and preserved original in screenshots.

Each tool result names the next useful action. Call that tool instead of restating
the workflow. Unknown coordinates require another visual observation or a concrete
blocker; never invented coordinates or writing into a different section.

OTHER EDITS: inspect, place/select the intended text, inspect the fresh caret/range,
then type and inspect again. Screenshot coordinates are image pixels; tools convert
device pixel ratio. After scrolling, zooming or edits, use a fresh screenshot.
inspect_docs_editor reports actual toolbar states; set_docs_formatting requests an
explicit on/off state. Open style menus using click_element and inspect afterward.
Null states are unknown/mixed. Native lists need text without literal bullet dots.

Canvas typing is unverified until compared with the BEFORE screenshot. Pre-existing
text is not proof of a new insert or grounds for undoing old document history.
At most one Undo for the current edit is allowed after inspection. Never repeatedly
undo because an old string remains visible. Stop if no new edit can be identified.
Paragraph spacing is not a blank line to delete. Do not join/split lines to fix it.
Rename the document through its normal title input, not the canvas body.
`;
