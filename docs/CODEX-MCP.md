# Codex + OpenBUA MCP Setup Guide

OpenBUA connects to OpenAI Codex via the Model Context Protocol (MCP) to automate browser tasks, form filling, and DOM interaction.

## Quick Setup

Run the setup script:

```bash
node scripts/setup-codex-mcp.mjs
```

This registers `openbua` into `~/.codex/config.json`.

## Connecting the Bridge

1. Open the OpenBUA extension sidepanel in Chrome.
2. Go to **Settings → MCP**.
3. Select **Codex** and click **Connect Bridge**.
4. Keep the bridge tab open while running tasks in Codex.
