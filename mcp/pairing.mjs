import { loadConfig } from "./config.mjs";

const config = loadConfig();
console.log(`Local bridge URL: ${config.url}\nPairing token: ${config.token}\n\nPaste these into OpenBUA Settings → External MCP Server, then click Connect. Keep the bridge tab open.`);
