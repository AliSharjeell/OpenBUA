import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../mcp/config.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(path.join(__dirname, ".."));
const serverScript = path.join(repoRoot, "mcp", "server.mjs");

const bridgeConfig = loadConfig();
const geminiConfigDir = path.join(os.homedir(), ".gemini", "config");
const mcpConfigPath = path.join(geminiConfigDir, "mcp_config.json");

let mcpConfig = { mcpServers: {} };
if (fs.existsSync(mcpConfigPath)) {
  try {
    mcpConfig = JSON.parse(fs.readFileSync(mcpConfigPath, "utf8"));
  } catch (err) {
    console.warn("Notice: Parsing existing mcp_config.json failed; initializing fresh configuration.");
    mcpConfig = { mcpServers: {} };
  }
}

if (!mcpConfig.mcpServers || typeof mcpConfig.mcpServers !== "object") {
  mcpConfig.mcpServers = {};
}

mcpConfig.mcpServers.openbua = {
  command: "node",
  args: [serverScript],
};

fs.mkdirSync(geminiConfigDir, { recursive: true });
fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2), "utf8");

console.log("==================================================");
console.log("✅ OpenBUA MCP Server configured for Antigravity!");
console.log("==================================================");
console.log(`Global config updated: ${mcpConfigPath}`);
console.log(`Server command: node "${serverScript}"`);
console.log(`Local bridge URL: ${bridgeConfig.url}`);
console.log(`Pairing token: ${bridgeConfig.token}`);
console.log("--------------------------------------------------");
console.log("Next steps:");
console.log("1. In OpenBUA extension, go to Settings → MCP");
console.log("2. Select 'Antigravity' and click 'Connect Bridge'");
console.log("3. In Antigravity, OpenBUA tools (openbua_inspect_page_controls, openbua_click_element, etc.) are available!");
console.log("==================================================");
