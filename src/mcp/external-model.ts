import { appendTrace, modelRecord } from "./trace";

export const MCP_CONFIG_KEY = "openbua_mcp_config_v1";
export const MCP_STATUS_KEY = "openbua_mcp_status_v1";
export const MCP_CLIENTS = [
  {id:"antigravity",name:"Antigravity"},{id:"codex",name:"Codex"},{id:"claude",name:"Claude"},
  {id:"gemini",name:"Gemini CLI"},{id:"cursor",name:"Cursor"},{id:"vscode",name:"VS Code"},
  {id:"windsurf",name:"Windsurf"},{id:"cline",name:"Cline"},{id:"pi",name:"Pi / Reel Studio"},{id:"custom",name:"Any MCP client"},
] as const;
export type McpClientType = typeof MCP_CLIENTS[number]["id"];
export function mcpClientName(client:McpClientType,customName?:string) {
  return client==="custom" ? (customName?.trim() || "MCP client") : MCP_CLIENTS.find(item=>item.id===client)?.name || "MCP client";
}
export function mcpSetupCommand(client:McpClientType) {
  return ["antigravity","codex","claude"].includes(client) ? `npm run mcp:${client}` : "npm run mcp:config";
}
export function mcpClientConfig(serverPath:string, client:McpClientType) {
  const server={command:"node",args:[serverPath.trim()||"/absolute/path/to/OpenBUA/mcp/server.mjs"]};
  return client==="vscode" ? {servers:{openbua:{type:"stdio",...server}}} : {mcpServers:{openbua:server}};
}

export interface McpConfig {
  enabled: boolean;
  url: string;
  token: string;
  client?: McpClientType;
  clientName?: string;
  serverPath?: string;
}

export interface McpStatus {
  relayConnected: boolean;
  mcpConnected: boolean;
  codexConnected?: boolean;
  antigravityConnected?: boolean;
  claudeConnected?: boolean;
  lastSeen: number;
  bridgeTabId?: number;
}

export async function mcpConnection() {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    return { config: undefined, status: undefined, online: false, client: "antigravity" as McpClientType };
  }
  const saved = await chrome.storage.local.get([MCP_CONFIG_KEY, MCP_STATUS_KEY]);
  const config = saved[MCP_CONFIG_KEY] as McpConfig | undefined;
  const status = saved[MCP_STATUS_KEY] as McpStatus | undefined;
  const client: McpClientType = config?.client || "antigravity";
  const connected = Boolean(status?.mcpConnected || status?.codexConnected || status?.antigravityConnected || status?.claudeConnected);
  return {
    config,
    status,
    online: Boolean(config?.enabled && connected && Date.now() - (status?.lastSeen || 0) < 15000),
    client,
  };
}

export const codexConnection = mcpConnection;

export async function pendingModelRequests() {
  return (await modelRecord("list")).filter((request: any) => request.state === "pending" && request.expiresAt > Date.now());
}

export async function answerModelRequest(id: string, response: unknown, error?: string) {
  const request = await modelRecord("get", id);
  if (!request || request.state !== "pending" || request.expiresAt < Date.now()) {
    throw new Error("This model request has expired or was already answered.");
  }
  if (!error && response === undefined) throw new Error("Provide a response or an explicit error.");
  if (!error && request.format === "text" && typeof response !== "string") {
    throw new Error("This request requires a text response.");
  }
  if (!error && request.format === "json" && typeof response === "string") {
    JSON.parse(response);
  }
  await modelRecord("put", { ...request, state: error ? "failed" : "completed", response, error });
  await chrome.storage.local.set({ openbua_model_update_v1: { id, at: Date.now() } });
  await appendTrace({ scope: "external-model", type: "model.response", data: { id, response, error } });
  return { accepted: true, id };
}
