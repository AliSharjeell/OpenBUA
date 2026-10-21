import { createAgentTools } from "../agent/tools";

export function toolCatalog() {
  const tools = createAgentTools("mcp_catalog");
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.parameters,
  }));
}
