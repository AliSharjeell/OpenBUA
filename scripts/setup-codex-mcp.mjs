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
const codexConfigDir = path.join(os.homedir(), ".codex");
const codexConfigPath = path.join(codexConfigDir, "config.json");

let codexConfig = {};
if (fs.existsSync(codexConfigPath)) {
  try {
    codexConfig = JSON.parse(fs.readFileSync(codexConfigPath, "utf8"));
  } catch (err) {
    console.warn("Notice: Parsing existing codex config failed; initializing fresh.");
  }
}

if (!codexConfig.mcpServers || typeof codexConfig.mcpServers !== "object") {
  codexConfig.mcpServers = {};
}

codexConfig.mcpServers.openbua = {
  command: "node",
  args: [serverScript],
};

fs.mkdirSync(codexConfigDir, { recursive: true });
fs.writeFileSync(codexConfigPath, JSON.stringify(codexConfig, null, 2), "utf8");

console.log("==================================================");
console.log("✅ OpenBUA MCP Server configured for Codex!");
console.log("==================================================");
console.log(`Codex config updated: ${codexConfigPath}`);
console.log(`Server command: node "${serverScript}"`);
console.log(`Local bridge URL: ${bridgeConfig.url}`);
console.log("==================================================");
