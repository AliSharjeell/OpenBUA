import { McpRuntime } from "./runtime";
import { MCP_CONFIG_KEY, MCP_STATUS_KEY, mcpClientName, type McpConfig } from "./external-model";
import { appendTrace, installTraceCapture, redact } from "./trace";

installTraceCapture("mcp-bridge");

const runtime = new McpRuntime();
const clientId = crypto.randomUUID();
let tab: chrome.tabs.Tab | undefined;
try {
  tab = await chrome.tabs.getCurrent();
} catch {}

const connection = document.getElementById("connection")!;
const detail = document.getElementById("detail")!;
let running = true;
const activeCommands = new Set<string>();

window.addEventListener("pagehide", () => {
  running = false;
});

async function request(config: McpConfig, path: string, body?: unknown) {
  const response = await fetch(config.url + path, {
    method: body === undefined ? "GET" : "POST",
    signal: AbortSignal.timeout(15000),
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      "X-OpenBUA-Client": clientId,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    throw new Error(response.status === 401 ? "Pairing token was rejected. Update it in OpenBUA Settings." : `Local bridge returned ${response.status}.`);
  }
  return response.json();
}

async function execute(config: McpConfig, command: any) {
  if (activeCommands.has(command.id)) return;
  activeCommands.add(command.id);

  const observe = !["activity", "status"].includes(command.op);
  if (observe) await appendTrace({ scope: "mcp", type: "command.start", data: command });

  let response: any;
  try {
    response = { id: command.id, value: redact(await runtime.command(command.op, command.args)) };
  } catch (error: any) {
    response = { id: command.id, error: String(error?.message || error) };
  }

  if (observe) await appendTrace({ scope: "mcp", type: "command.end", data: response });

  try {
    await request(config, "/extension/result", response);
    if (command.op === "reload_bridge" && response.value?.reloading === true) {
      location.reload();
    }
  } catch (error: any) {
    detail.textContent = `Response delivery failed: ${String(error?.message || error)}`;
  }
}

while (running) {
  let delay = 0;
  const config = (await chrome.storage.local.get(MCP_CONFIG_KEY))[MCP_CONFIG_KEY] as McpConfig | undefined;
  const clientType = config?.client || "antigravity";
  const clientName = mcpClientName(clientType, config?.clientName);

  const heading = document.getElementById("bridge-heading") || document.querySelector("h1");
  if (heading) heading.textContent = `OpenBUA + ${clientName}`;
  document.title = `OpenBUA · ${clientName} bridge`;

  try {
    if (!config?.enabled) {
      delay = 1000;
      connection.textContent = `${clientName} MCP mode is off. Connect it in OpenBUA Settings.`;
      await chrome.storage.local.set({
        [MCP_STATUS_KEY]: {
          relayConnected: false,
          mcpConnected: false,
          lastSeen: 0,
          bridgeTabId: tab?.id,
        },
      });
    } else {
      if (!/^http:\/\/127\.0\.0\.1:\d{4,5}$/.test(config.url)) {
        throw new Error("Use a local 127.0.0.1 bridge URL.");
      }
      const response = await request(config, "/extension/poll");
      const clientConnected = Boolean(response.mcpConnected);

      await chrome.storage.local.set({
        [MCP_STATUS_KEY]: {
          relayConnected: true,
          mcpConnected: clientConnected,
          lastSeen: Date.now(),
          bridgeTabId: tab?.id,
        },
      });

      connection.textContent = clientConnected
        ? `Connected — ${clientName} controls OpenBUA`
        : `Bridge ready — waiting for ${clientName} MCP server`;

      for (const cmd of response.commands || []) {
        void execute(config, cmd);
      }
    }
  } catch (error: any) {
    delay = 1500;
    connection.textContent = `Bridge disconnected: ${String(error?.message || error)}`;
    await chrome.storage.local.set({
      [MCP_STATUS_KEY]: {
        relayConnected: false,
        mcpConnected: false,
        lastSeen: 0,
        bridgeTabId: tab?.id,
      },
    });
  }

  await new Promise(resolve => setTimeout(resolve, delay));
}
