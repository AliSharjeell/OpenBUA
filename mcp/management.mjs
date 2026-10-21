const object = (properties = {}, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const string = { type: "string" }, number = { type: "number" }, boolean = { type: "boolean" };
const tool = (name, description, properties, required, readOnly = false) => ({
  name: `openbua_${name}`,
  description,
  inputSchema: object(properties, required),
  annotations: { readOnlyHint: readOnly, destructiveHint: false }
});

export const managementTools = [
  tool("status", "Connection and bridge status between MCP client, relay and Chrome extension.", {}, [], true),
  tool("tabs", "List all browser tabs with id, title, url, active state, and windowId.", {}, [], true),
  tool("reload_bridge", "Refresh the OpenBUA bridge tab in Chrome to reload an updated build without restarting the browser.", {}, []),
  tool("activity", "Read durable execution trace and console logs.", { after: number, limit: number }, [], true),
];
