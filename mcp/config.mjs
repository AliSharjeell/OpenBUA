import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

export function loadConfig() {
  const file = process.env.OPENBUA_MCP_CONFIG || path.join(os.homedir(), ".openbua", "bridge.json");
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({ port: 32155, token: crypto.randomBytes(32).toString("hex") }, null, 2),
      { mode: 0o600, flag: "wx" }
    );
  }
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Number.isInteger(value.port) || value.port < 1024 || value.port > 65535 || !/^[a-f0-9]{64}$/.test(value.token)) {
    throw new Error("Invalid OpenBUA local bridge configuration in " + file);
  }
  return { ...value, file, url: `http://127.0.0.1:${value.port}` };
}
