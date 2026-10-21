import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema, ListPromptsRequestSchema, GetPromptRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.mjs";
import { managementTools } from "./management.mjs";

const config = loadConfig();
const clientId = crypto.randomUUID();
const catalog = JSON.parse(await fs.readFile(new URL("tool-catalog.json", import.meta.url), "utf8"));
const logDirectory = process.env.OPENBUA_MCP_LOG_DIR || path.join(os.homedir(), ".openbua", "mcp-logs");
await fs.mkdir(logDirectory, { recursive: true });
const logFile = path.join(logDirectory, `${new Date().toISOString().replace(/[:.]/g, "-")}-${clientId}.jsonl`);

const instructions = `Antigravity, Codex, or Claude is the OpenBUA agent in this session.
OpenBUA is a fast, accurate browser-use agent for web navigation, form filling, document editing, and interaction.
Key principles:
1. DOM-FIRST: Always use openbua_inspect_page_controls as your primary perception tool. It returns exact labeled refs, selectors, states, bounding rects, occlusion hit-tests, and question groups.
2. FORM FILLING: Use openbua_fill_form_fields with refIds or selectors. Setting radio buttons and checkboxes automatically clicks them to trigger frameworks (React/Vue/Angular), and form fields are automatically verified.
3. VISUAL FALLBACK: Use openbua_capture_tab_screenshot only when DOM inspection cannot reach a canvas element or visual layout confirmation is needed. Coordinates from the original image can be passed directly to openbua_click_at_position; it converts to CSS viewport pixels and rejects stale views.
4. CANVAS EDITING: In Google Docs, Figma, Canva, or canvas-rendered editors, use openbua_click_at_position to position the caret, then openbua_type_text to insert text.
5. NAVIGATION: Use openbua_list_browser_tabs, openbua_switch_browser_tab, and openbua_navigate_browser_tab to manage browser tabs.`;

async function http(endpoint, body) {
  const response = await fetch(config.url + endpoint, {
    signal: AbortSignal.timeout(endpoint === "/health" ? 1000 : endpoint === "/client" ? 3000 : 50000),
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`OpenBUA relay returned ${response.status}.`);
  const value = await response.json();
  if (value.error) throw new Error(value.error);
  return value;
}

async function ensureRelay() {
  try {
    const health = await http("/health");
    if (health.service !== "openbua-relay") throw new Error("Unexpected local service.");
    return;
  } catch {}
  const child = spawn(process.execPath, [fileURLToPath(new URL("relay.mjs", import.meta.url))], {
    detached: true,
    windowsHide: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 125));
    try {
      if ((await http("/health")).service === "openbua-relay") return;
    } catch {}
  }
  throw new Error("Could not start the authenticated OpenBUA local relay. Check the port in ~/.openbua/bridge.json.");
}

await ensureRelay();

function scrub(value) {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /^(api.?key|authorization|token|password|secret)$/i.test(key) ? "[redacted]" : scrub(item),
      ])
    );
  }
  if (typeof value === "string") {
    return value.replace(/\b(?:tp-[a-z0-9]{20,}|sk-[a-zA-Z0-9_-]{16,})\b/g, "[redacted]");
  }
  return value;
}

async function command(op, args = {}) {
  await fs.appendFile(logFile, JSON.stringify(scrub({ at: Date.now(), type: "call", op, args })) + "\n");
  try {
    const result = await http("/command", { op, args, clientId });
    await fs.appendFile(logFile, JSON.stringify(scrub({ at: Date.now(), type: "result", op, result })) + "\n");
    return result.value;
  } catch (error) {
    await fs.appendFile(logFile, JSON.stringify({ at: Date.now(), type: "error", op, error: error.message }) + "\n");
    throw error;
  }
}

function asMcp(value) {
  const content = [];
  const seenImages = new Set();

  function convert(item) {
    if (Array.isArray(item)) return item.map(convert);
    if (item && typeof item === "object") {
      if (item.type === "image" && typeof item.data === "string") {
        if (!seenImages.has(item.data)) {
          seenImages.add(item.data);
          content.push({ type: "image", data: item.data, mimeType: item.mimeType || "image/jpeg" });
        }
        return { type: "image", mimeType: item.mimeType, note: "Actual image attached to this MCP result." };
      }
      return Object.fromEntries(
        Object.entries(item).map(([key, val]) => {
          if (key === "images" && Array.isArray(val)) {
            for (const url of val) {
              const match = typeof url === "string" && url.match(/^data:([^;]+);base64,(.+)$/s);
              if (match) convert({ type: "image", mimeType: match[1], data: match[2] });
            }
            return [key, val.map((_, index) => `Attached image ${index + 1}`)];
          }
          return [key, convert(val)];
        })
      );
    }
    return item;
  }

  const safe = convert(scrub(value));
  content.unshift({ type: "text", text: JSON.stringify(safe ?? null, null, 2) });
  return {
    content,
    isError: value?.state === "failed" || Boolean(value?.error) || value?.details?.success === false || Boolean(value?.isError),
  };
}

const tools = [
  ...managementTools,
  ...catalog.map(tool => ({
    name: `openbua_${tool.name}`,
    description: tool.description,
    inputSchema: tool.inputSchema,
  })),
];

const server = new Server({ name: "openbua", version: "1.0.0" }, { capabilities: { tools: {}, prompts: {} }, instructions });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async request => {
  try {
    if (!tools.some(tool => tool.name === request.params.name)) {
      throw new Error(`Unknown OpenBUA tool: ${request.params.name}`);
    }
    const name = request.params.name.slice("openbua_".length);
    const args = request.params.arguments || {};
    if (name === "status") {
      return asMcp({
        relay: await http("/health"),
        extension: await command("status"),
        localTranscript: logFile,
      });
    }
    if (name === "tabs") {
      return asMcp(await command("tabs"));
    }
    if (name === "reload_bridge") {
      return asMcp(await command("reload_bridge"));
    }
    if (name === "activity") {
      return asMcp(await command("activity", args));
    }
    const generic = catalog.some(tool => tool.name === name);
    const value = generic ? await command("tool", { name, params: args }) : await command(name, args);
    return asMcp(value);
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: error.message }] };
  }
});

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: [
    {
      name: "openbua_agent",
      description: "Drive OpenBUA using Antigravity, Codex, or Claude to inspect and interact with the browser.",
    },
  ],
}));

server.setRequestHandler(GetPromptRequestSchema, async request => {
  if (request.params.name !== "openbua_agent") throw new Error("Unknown prompt.");
  return { messages: [{ role: "user", content: { type: "text", text: instructions } }] };
});

let heartbeat;
server.oninitialized = () => {
  void http("/client", { id: clientId });
  heartbeat = setInterval(() => void http("/client", { id: clientId }).catch(() => {}), 3000);
  heartbeat.unref();
};
server.onclose = () => {
  clearInterval(heartbeat);
  void http("/client", { id: clientId, remove: true }).catch(() => {});
};

await server.connect(new StdioServerTransport());
