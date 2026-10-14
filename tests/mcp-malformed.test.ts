import { it, expect } from "vitest";
import { Ledger } from "../packages/domain/src/ledger";
import { createApp } from "../apps/server/src/app";
it("malformed MCP initialization reaches SDK validation rather than throwing in trace collection", async () => {
  const l = new Ledger(":memory:"),
    token = l.session(),
    app = createApp(l),
    server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const response = await fetch(url + "/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1 }),
    });
    expect(response.status).toBeLessThan(500);
    const body = await response.json();
    expect(body.error).toBeTruthy();
    expect(l.state(token).version).toBe(0);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    l.db.close();
  }
});
