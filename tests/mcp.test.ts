import { it, expect } from "vitest";
import { createApp } from "../apps/server/src/app";
import { Ledger } from "../packages/domain/src/ledger";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
it("official SDK negotiates 2025-11-25 lists and calls tools over authenticated StreamableHTTP", async () => {
  const l = new Ledger(":memory:"),
    token = l.session();
  const app = createApp(l);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    expect((await fetch(url + "/mcp", { method: "POST" })).status).toBe(401);
    expect(
      (
        await fetch(url + "/mcp", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            Origin: "https://evil.example",
          },
        })
      ).status,
    ).toBe(403);
    const initialization = await fetch(url + "/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "negotiation-fixture", version: "1.0.0" },
        },
      }),
    });
    expect((await initialization.json()).result.protocolVersion).toBe(
      "2025-11-25",
    );
    const c = new Client({ name: "bahi-integration", version: "1.0.0" });
    await c.connect(
      new StreamableHTTPClientTransport(new URL(url + "/mcp"), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name)).toEqual(
      expect_all(["record_sale", "correct_entry", "explain_sales_change", "plan_restock", "confirm_operation"], tools.map((t) => t.name)),
    );
    expect(new Set(tools.map((t) => t.description)).size).toBe(tools.length);
    const r = await c.callTool({ name: "check_stock", arguments: {} });
    expect(r.isError).not.toBe(true);
    expect((r.structuredContent as any).items).toEqual([]);
    const bad = await c.callTool({ name: "record_sale", arguments: { items: [{ item: "sugar", quantity: 1 }] } });
    expect(bad.isError).toBe(true);
    expect((bad.content as any)[0].text).toMatch(/don't have an item/);
    expect(app.locals.protocols).toContain("2025-11-25");
    await c.close();
    const get = await fetch(url + "/mcp", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "text/event-stream",
      },
    });
    expect(get.status).toBe(405);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    l.db.close();
  }
}, 15000);

function expect_all(wanted: string[], names: string[]) {
  for (const w of wanted) if (!names.includes(w)) throw Error(`missing tool ${w}`);
  return names;
}
