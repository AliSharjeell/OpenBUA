import React, { useEffect, useState } from "react";
import { MCP_CONFIG_KEY, MCP_STATUS_KEY, type McpConfig, type McpClientType, type McpStatus } from "../mcp/external-model";

export function McpSettings() {
  const [selectedClient, setSelectedClient] = useState<McpClientType>("antigravity");
  const [config, setConfig] = useState<McpConfig>({ enabled: false, url: "http://127.0.0.1:32155", token: "", client: "antigravity" });
  const [status, setStatus] = useState<McpStatus>();
  const [error, setError] = useState("");

  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) return;
    void chrome.storage.local.get([MCP_CONFIG_KEY, MCP_STATUS_KEY]).then(value => {
      if (value[MCP_CONFIG_KEY]) {
        const cfg = value[MCP_CONFIG_KEY] as McpConfig;
        setConfig(cfg);
        setSelectedClient(cfg.client || "antigravity");
      }
      setStatus(value[MCP_STATUS_KEY]);
    });
    const changed = (values: Record<string, chrome.storage.StorageChange>) => {
      if (values[MCP_STATUS_KEY]) setStatus(values[MCP_STATUS_KEY].newValue);
      if (values[MCP_CONFIG_KEY]) {
        const cfg = values[MCP_CONFIG_KEY].newValue as McpConfig;
        if (cfg) {
          setConfig(cfg);
          setSelectedClient(cfg.client || "antigravity");
        }
      }
    };
    chrome.storage.onChanged.addListener(changed);
    return () => chrome.storage.onChanged.removeListener(changed);
  }, []);

  const activeClient = config.client || "antigravity";
  const activeClientName = activeClient === "antigravity" ? "Antigravity" : activeClient === "claude" ? "Claude" : "Codex";
  const selectedClientName = selectedClient === "antigravity" ? "Antigravity" : selectedClient === "claude" ? "Claude" : "Codex";
  const isSelectedActive = config.enabled && activeClient === selectedClient;
  const isClientConnected = Boolean(status?.mcpConnected);
  const connected = isSelectedActive && isClientConnected && Date.now() - (status?.lastSeen || 0) < 15000;

  async function connect(clientToConnect: McpClientType) {
    setError("");
    try {
      if (!/^http:\/\/127\.0\.0\.1:\d{4,5}$/.test(config.url) || !/^[a-f0-9]{64}$/.test(config.token)) {
        throw new Error("Enter a valid local 127.0.0.1 bridge URL and 64-char pairing token (from npm run mcp:pairing).");
      }
      const updated: McpConfig = { ...config, client: clientToConnect, enabled: true };
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        await chrome.storage.local.set({ [MCP_CONFIG_KEY]: updated });
      }
      setConfig(updated);

      if (typeof chrome !== "undefined" && chrome.runtime?.getURL && chrome.tabs) {
        const url = chrome.runtime.getURL("mcp-bridge.html");
        const existing = (await chrome.tabs.query({})).find(tab => tab.url === url);
        if (existing?.id) {
          await chrome.tabs.update(existing.id, { active: true });
        } else {
          await chrome.tabs.create({ url });
        }
      }
    } catch (err) {
      setError(String((err as Error).message));
    }
  }

  async function disconnect() {
    const updated: McpConfig = { ...config, enabled: false };
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.set({ [MCP_CONFIG_KEY]: updated });
    }
    setConfig(updated);
  }

  let statusText = "Off";
  if (isSelectedActive) {
    if (connected) statusText = `Connected (${selectedClientName})`;
    else if (config.enabled) statusText = status?.relayConnected ? `Waiting for ${selectedClientName}` : "Relay offline";
  } else if (config.enabled) {
    statusText = `Active with ${activeClientName}`;
  }

  return (
    <section className="space-y-3 rounded-2xl bg-zinc-900/90 border border-zinc-800 p-4 text-xs" aria-label="MCP settings">
      <div className="flex justify-between items-center gap-3">
        <strong className="text-sm text-zinc-100">External MCP Server</strong>
        <span className={connected ? "text-emerald-400 font-medium" : "text-zinc-400"}>
          {statusText}
        </span>
      </div>

      <div className="flex bg-zinc-950 p-1 rounded-xl border border-zinc-800 gap-1">
        <button
          type="button"
          onClick={() => setSelectedClient("antigravity")}
          className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-semibold transition ${
            selectedClient === "antigravity"
              ? "bg-[#007AFF] text-white shadow-xs"
              : "text-zinc-400 hover:text-white"
          }`}
        >
          Antigravity
        </button>
        <button
          type="button"
          onClick={() => setSelectedClient("codex")}
          className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-semibold transition ${
            selectedClient === "codex"
              ? "bg-[#007AFF] text-white shadow-xs"
              : "text-zinc-400 hover:text-white"
          }`}
        >
          Codex
        </button>
        <button
          type="button"
          onClick={() => setSelectedClient("claude")}
          className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-semibold transition ${
            selectedClient === "claude"
              ? "bg-[#007AFF] text-white shadow-xs"
              : "text-zinc-400 hover:text-white"
          }`}
        >
          Claude
        </button>
      </div>

      <p className="text-zinc-400 leading-relaxed text-[11px]">
        {selectedClient === "antigravity"
          ? "Let Google Antigravity drive browser perception, form filling, document editing, and navigation through MCP. Keep the bridge tab open while using it."
          : selectedClient === "claude"
          ? "Connect Claude Desktop directly to OpenBUA. Call openbua_* tools to interact with your live browser tab."
          : "Let Codex drive browser automation tools directly from your terminal or editor. Keep the bridge tab open while using it."}
      </p>

      <label className="block space-y-1">
        <span className="text-zinc-300">Local bridge URL</span>
        <input
          aria-label="MCP bridge URL"
          className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-1.5 text-zinc-100 text-xs focus:outline-hidden focus:border-[#007AFF]"
          value={config.url}
          onChange={event => setConfig({ ...config, url: event.target.value.trim() })}
        />
      </label>

      <label className="block space-y-1">
        <span className="text-zinc-300">Pairing token</span>
        <input
          type="password"
          autoComplete="off"
          aria-label="MCP pairing token"
          className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-1.5 text-zinc-100 text-xs focus:outline-hidden focus:border-[#007AFF]"
          value={config.token}
          onChange={event => setConfig({ ...config, token: event.target.value.trim() })}
        />
      </label>

      <p className="text-zinc-500 text-[10px] leading-relaxed">
        Run <code>npm run mcp:{selectedClient}</code> to configure {selectedClientName}, then <code>npm run mcp:pairing</code> to view your token.
      </p>

      {config.enabled && !status?.relayConnected && (
        <p className="text-amber-300 text-[11px]">
          Relay is offline. Run <code>npm run mcp:relay</code> or make an MCP tool call in {selectedClientName}.
        </p>
      )}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={() => void connect(selectedClient)}
          className="rounded-xl text-white px-3.5 py-1.5 text-xs font-semibold bg-[#007AFF] hover:bg-[#0066d6] transition active:scale-95 cursor-pointer"
        >
          Connect {selectedClientName}
        </button>
        {config.enabled && (
          <button
            type="button"
            onClick={() => void disconnect()}
            className="rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-3.5 py-1.5 text-xs font-semibold transition active:scale-95 cursor-pointer"
          >
            Disconnect
          </button>
        )}
      </div>

      {error && <p className="text-red-400 text-xs" role="alert">{error}</p>}
    </section>
  );
}
