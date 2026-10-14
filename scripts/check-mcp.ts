/**
 * Read-only check of a deployed MCP endpoint, the way Alexa+ (or any MCP
 * client) will reach it.
 *   BAHI_URL=https://your-host BAHI_TOKEN=<connector token> npm run check:mcp
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const base = process.env.BAHI_URL;
const token = process.env.BAHI_TOKEN;
if (!base || !token) throw Error("Set BAHI_URL and BAHI_TOKEN");
const client = new Client({ name: "bahi-check", version: "2.0.0" });
await client.connect(
  new StreamableHTTPClientTransport(new URL(base.replace(/\/$/, "") + "/mcp"), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }),
);
const { tools } = await client.listTools();
console.log(`Connected. ${tools.length} tools: ${tools.map((t) => t.name).join(", ")}`);
for (const [name, args] of [
  ["who_owes", {}],
  ["low_stock_forecast", {}],
  ["explain_sales_change", { date: "tuesday" }],
] as const) {
  const r: any = await client.callTool({ name, arguments: args });
  console.log(`${name}: ${r.isError ? "ERROR " + r.content[0].text : r.structuredContent.say}`);
}
await client.close();
