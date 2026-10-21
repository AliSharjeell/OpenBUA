import { build } from "esbuild";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const result = await build({
  entryPoints: [root + "src/mcp/catalog.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  plugins: [
    {
      name: "asset-url",
      setup(build) {
        build.onResolve({ filter: /\?url$/ }, args => ({ path: args.path, namespace: "asset-url" }));
        build.onLoad({ filter: /.*/, namespace: "asset-url" }, () => ({ contents: 'export default ""', loader: "js" }));
      },
    },
  ],
  logLevel: "silent",
});

const { toolCatalog } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
await fs.writeFile(new URL("tool-catalog.json", import.meta.url), JSON.stringify(toolCatalog(), null, 2) + "\n");
console.error(`Updated OpenBUA MCP catalog: ${toolCatalog().length} tools.`);
