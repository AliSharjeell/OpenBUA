# Forms and live agent UI

OpenBUA's form workflow uses labeled DOM controls first, batches known values, and verifies the committed result. It distinguishes typed autocomplete text from an actual selection, retains option references across inspectors, and recognizes selected widgets whose search input clears. Exact valid native text fields are skipped when already correct. A failed identical action on an unchanged form is blocked so the model must inspect validation or change its approach.

Upload verification treats visible upload errors as failures even if the filename is present. `retry_unavailable_page` reloads a proven network/server error once, preserving ordinary filled forms. Required missing facts use the real `request_user_input` tool: a compact card pauses the run until answered or skipped. Answers resume the tool; they are not fabricated or automatically accepted. These cards belong to the current run and do not survive an extension reload.

## MiniMax Flash setup

In Settings, choose BYOK > Anthropic, click **MiniMax Flash · low**, enter your own MiniMax key, and save. The preset uses `https://api.minimax.io/anthropic` and `MiniMax-M3.1-Flash`. Low effort is applied consistently to browser decisions, OCR, and generated chat titles. You can explicitly select another effort level. Unrelated providers do not receive MiniMax options, and switching from a different Anthropic endpoint clears its old key.

The stream adapter preserves complete thinking blocks and signatures with tool history. MiniMax's [official Anthropic API documentation](https://platform.minimax.io/docs/api-reference/text-anthropic-api) describes `output_config.effort` and thinking-block continuity. No shared provider key is included in these changes.

## Chat controls

- Pixel loaders offer Drive, Dots, Orbit and optional Surfer styles, with actual elapsed time. Reduced motion disables animation. Surfer loads the supplied remote video only when selected.
- Expandable activity notes and tool rows use real model outputs and tool results. Tool details redact credential-shaped properties.
- Answers display actual streamed text and link sources extracted from the response, without simulated research or progress.
- Task rows reflect parallel Chrome workers' stored states for the current session and window.
- The rounded composer supports attachment uploads and references, `/fill`, `/inspect`, `/verify`, `/summarize`, configured model selection, and browser speech recognition where supported. Dictation never inserts sample text.

## Verification

`npm run test:forms` covers provider defaults and endpoints, unchanged-failure guards, native-field no-ops, delayed dropdowns, committed selection after search reset, real question/answer lifecycle, and two-turn MiniMax streaming payloads. Provider responses are mocked; this does not establish live MiniMax latency or universal form success.

With `npm run dev` running, `npm run test:agent-ui` exercises the actual ChatView model/source/command controls and question-answer continuation, plus loader styles, reduced motion, sources, tool expansion and narrow layouts. It writes screenshots to `.tmp-visual-agent-ui/`.

The browser tests require Playwright and Chromium. Set `OPENBUA_PLAYWRIGHT_MODULE` to your installed module and `OPENBUA_CHROME_PATH` to Chrome's executable if needed. Existing DOM, autocomplete, attachment, upload, MCP and production-artifact tests remain available. Load the rebuilt `dist/` directory in Chrome or reload the existing unpacked extension after building.

