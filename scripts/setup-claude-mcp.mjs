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

function getClaudeConfigPath() {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "Claude", "claude_desktop_config.json");
  } else if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  } else {
    return path.join(os.homedir(), ".config", "Claude", "claude_desktop_config.json");
  }
}

const claudeConfigPath = getClaudeConfigPath();
const claudeConfigDir = path.dirname(claudeConfigPath);

let claudeConfig = {};
if (fs.existsSync(claudeConfigPath)) {
  try {
    claudeConfig = JSON.parse(fs.readFileSync(claudeConfigPath, "utf8"));
  } catch (err) {
    console.warn("Notice: Parsing existing claude_desktop_config.json failed; initializing fresh.");
  }
}

if (!claudeConfig.mcpServers || typeof claudeConfig.mcpServers !== "object") {
  claudeConfig.mcpServers = {};
}

claudeConfig.mcpServers.openbua = {
  command: "node",
  args: [serverScript],
};

fs.mkdirSync(claudeConfigDir, { recursive: true });
fs.writeFileSync(claudeConfigPath, JSON.stringify(claudeConfig, null, 2), "utf8");

console.log("==================================================");
console.log("✅ OpenBUA MCP Server configured for Claude Desktop!");
console.log("==================================================");
console.log(`Claude Desktop config updated: ${claudeConfigPath}`);
console.log(`Server command: node "${serverScript}"`);
console.log(`Local bridge URL: ${bridgeConfig.url}`);
console.log("==================================================");
