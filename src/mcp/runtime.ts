import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Value } from "@sinclair/typebox/value";
import { createAgentTools } from "../agent/tools";
import { loadSettings } from "../services/storage";
import { appendTrace, readTrace, redact } from "./trace";
import { mcpConnection } from "./external-model";

type Operation = {
  id: string;
  state: "running" | "completed" | "failed";
  result?: any;
  error?: string;
  controller: AbortController;
};

export class McpRuntime {
  private tools: AgentTool<any>[] = createAgentTools("mcp_session");
  private operations = new Map<string, Operation>();
  private controls: Promise<unknown> = Promise.resolve();

  async command(op: string, args: any = {}): Promise<any> {
    const independent = new Set(["status", "tabs", "activity"]);
    if (independent.has(op)) return this.dispatch(op, args);
    const result = this.controls.catch(() => {}).then(() => this.dispatch(op, args));
    this.controls = result.catch(() => {});
    return result;
  }

  private async dispatch(op: string, args: any): Promise<any> {
    if (op === "status") {
      const connection = await mcpConnection();
      return {
        connection: { online: connection.online, client: connection.client },
        settings: await loadSettings().catch(() => null),
      };
    }

    if (op === "tabs") {
      if (typeof chrome === "undefined" || !chrome.tabs) return [];
      return chrome.tabs.query({});
    }

    if (op === "activity") {
      return readTrace(args);
    }

    if (op === "reload_bridge") {
      return {
        reloading: true,
        message: "Bridge refresh acknowledged. Bridge tab will reload.",
      };
    }

    if (op === "tool") {
      const tool = this.tools.find(t => t.name === args.name);
      if (!tool) {
        throw new Error(`Tool not found in OpenBUA catalog: ${args.name}`);
      }
      const params = args.params || {};
      if (!Value.Check(tool.parameters, params)) {
        throw new Error(`Invalid arguments for tool ${tool.name}. Please follow its schema.`);
      }

      const callId = crypto.randomUUID();
      const controller = new AbortController();
      const call = {
        id: callId,
        toolName: tool.name,
        args: params,
        status: "running" as const,
        timestamp: Date.now(),
      };

      await appendTrace({ scope: "mcp", type: "tool.start", data: call });

      try {
        const result = await (tool.execute as any)(callId, params, controller.signal);
        await appendTrace({ scope: "mcp", type: "tool.end", data: { id: callId, status: "success", result: redact(result) } });
        return result;
      } catch (error: any) {
        await appendTrace({ scope: "mcp", type: "tool.end", data: { id: callId, status: "error", error: String(error?.message || error) } });
        throw error;
      }
    }

    throw new Error(`Unknown MCP operation: ${op}`);
  }
}
