# Claude Desktop + OpenBUA MCP Setup Guide

OpenBUA connects to Claude Desktop via the Model Context Protocol (MCP) to automate browser interaction, form filling, and DOM manipulation.

## Quick Setup

Run the setup script:

```bash
node scripts/setup-claude-mcp.mjs
```

This registers `openbua` into Claude Desktop's configuration (`%APPDATA%\Claude\claude_desktop_config.json` on Windows).

## Connecting the Bridge

1. Open the OpenBUA extension sidepanel in Chrome.
2. Go to **Settings → MCP**.
3. Select **Claude** and click **Connect Bridge**.
4. Restart Claude Desktop. The OpenBUA tools (`openbua_inspect_page_controls`, `openbua_fill_form_fields`, etc.) will be available in Claude Desktop.
