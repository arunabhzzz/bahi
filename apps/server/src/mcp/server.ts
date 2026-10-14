import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Ledger } from "../../../../packages/domain/src/ledger";
import { SERVER_INSTRUCTIONS, toolDefinitions } from "./tools";

export function mcpServer(
  ledger: Ledger,
  token: string,
  trace: (name: string) => void,
) {
  const server = new McpServer(
    { name: "bahi-ledger", version: "2.0.0" },
    { instructions: SERVER_INSTRUCTIONS },
  );
  for (const tool of toolDefinitions(ledger, token))
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.schema as any,
        annotations: {
          title: tool.title,
          readOnlyHint: tool.readOnly,
          destructiveHint: false,
          idempotentHint: tool.readOnly || tool.name === "confirm_operation",
          openWorldHint: false,
        },
      },
      async (args: any) => {
        trace(tool.name);
        try {
          const data = tool.run(args ?? {});
          return {
            content: [{ type: "text" as const, text: JSON.stringify(data) }],
            structuredContent: data,
          };
        } catch (e) {
          return {
            content: [{ type: "text" as const, text: (e as Error).message }],
            isError: true,
          };
        }
      },
    );
  return server;
}
