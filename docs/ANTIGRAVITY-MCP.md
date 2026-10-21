# Antigravity + OpenBUA MCP Setup Guide

OpenBUA exposes its full suite of 40+ browser automation, DOM inspection, and form-filling tools directly to Google Antigravity via the Model Context Protocol (MCP).

## Quick Setup

Run the setup script from the repository root:

```bash
node scripts/setup-antigravity-mcp.mjs
```

This registers `openbua` into `~/.gemini/config/mcp_config.json`:

```json
{
  "mcpServers": {
    "openbua": {
      "command": "node",
      "args": ["<path-to-repo>/mcp/server.mjs"]
    }
  }
}
```

## Connecting the Bridge

1. Load the OpenBUA extension into Chrome (`chrome://extensions` -> Load unpacked -> select `dist`).
2. In the OpenBUA Sidepanel, open **Settings → MCP**.
3. Select **Antigravity** and click **Connect Bridge**.
4. A dedicated bridge tab (`mcp-bridge.html`) opens and connects to the local relay on `http://127.0.0.1:32155`.
5. In Antigravity, call `openbua_inspect_page_controls`, `openbua_fill_form_fields`, `openbua_click_element`, and other tools to autonomously interact with the user's browser.
