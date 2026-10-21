import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createRelay } from "../mcp/relay.mjs";

const token = crypto.randomBytes(32).toString("hex");
const relay = createRelay({ token, pollWaitMs: 25 });
const port = await relay.listen();
const url = `http://127.0.0.1:${port}`;
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "openbua-mcp-test-"));
await fs.writeFile(path.join(directory, "config.json"), JSON.stringify({ port, token }));

const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const extensionHeaders = { ...headers, Origin: `chrome-extension://${"a".repeat(32)}`, "X-OpenBUA-Client": "test-browser" };
const api = async (route, body, extra = {}) => {
  const response = await fetch(url + route, {
    headers: { ...headers, ...extra },
    method: body === undefined ? "GET" : "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, value: await response.json() };
};

let pump = true;
let pendingPump;
const client = new Client({ name: "openbua-test", version: "1" });
let stderr = "";

try {
  assert.equal((await fetch(url + "/health")).status, 401);
  assert.equal((await fetch(url + "/health", { headers: { ...headers, Origin: "https://attacker.example" } })).status, 403);
  assert.equal((await api("/health")).value.extensionConnected, false);

  await api("/extension/poll", undefined, extensionHeaders);
  assert.equal((await api("/extension/poll", undefined, { ...extensionHeaders, "X-OpenBUA-Client": "other-browser" })).status, 409);

  const task = api("/command", { op: "tool", args: { name: "click_element", params: { selector: "#submit" } } });
  await new Promise(resolve => setTimeout(resolve, 50));
  const commands = (await api("/extension/poll", undefined, extensionHeaders)).value.commands;
  assert.equal(commands.length, 1);
  assert.equal(commands[0].op, "tool");
  assert.equal((await api("/extension/poll", undefined, extensionHeaders)).value.commands.length, 0, "Delivered actions are never replayed");

  await api("/extension/result", { id: commands[0].id, value: { dispatched: true } }, extensionHeaders);
  assert.equal((await task).value.value.dispatched, true);

  await api("/client", { id: "departing-client" });
  const abandoned = api("/command", { op: "tool", clientId: "departing-client", args: { name: "click_element" } });
  await new Promise(resolve => setTimeout(resolve, 30));
  await api("/client", { id: "departing-client", remove: true });
  assert.match((await abandoned).value.error, /disconnected/);
  assert.equal((await api("/extension/poll", undefined, extensionHeaders)).value.commands.length, 0, "Disconnected clients cannot leave browser actions queued");

  pendingPump = (async () => {
    while (pump) {
      const { value } = await api("/extension/poll", undefined, extensionHeaders);
      for (const command of value.commands || []) {
        const val = command.op === "tool"
          ? { received: command.op, name: command.args?.name, params: command.args?.params }
          : { received: command.op, args: command.args };
        await api("/extension/result", { id: command.id, value: val }, extensionHeaders);
      }
      await new Promise(resolve => setTimeout(resolve, 35));
    }
  })();

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve("mcp/server.mjs")],
    env: { ...process.env, OPENBUA_MCP_CONFIG: path.join(directory, "config.json"), OPENBUA_MCP_LOG_DIR: directory },
    stderr: "pipe",
  });
  transport.stderr.on("data", chunk => {
    stderr += chunk;
  });
  await client.connect(transport);

  const tools = (await client.listTools()).tools;
  const native = JSON.parse(await fs.readFile("mcp/tool-catalog.json", "utf8"));
  for (const tool of native) {
    assert.ok(tools.find(item => item.name === "openbua_" + tool.name), `Tool openbua_${tool.name} must exist in MCP tools`);
  }
  assert.ok(tools.length >= 40, `Expected at least 40 tools, got ${tools.length}`);

  const called = await client.callTool({ name: "openbua_get_page_content", arguments: {} });
  const result = JSON.parse(called.content[0].text);
  assert.deepEqual(result, { received: "tool", name: "get_page_content", params: {} });

  assert.match((await client.getPrompt({ name: "openbua_agent" })).messages[0].content.text, /DOM-FIRST/);
  assert.equal((await client.callTool({ name: "openbua_nonexistent", arguments: {} })).isError, true);
  assert.ok(!stderr.includes(token));

  console.log(`OpenBUA MCP tests passed: ${tools.length} tools, stdio transport, pairing auth, origin restrictions and exactly-once delivery.`);
} finally {
  await client.close().catch(() => {});
  pump = false;
  await pendingPump?.catch(() => {});
  await relay.close();
  if (path.dirname(directory) === os.tmpdir() && path.basename(directory).startsWith("openbua-mcp-test-")) {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
