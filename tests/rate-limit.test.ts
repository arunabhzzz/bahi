import { it, expect } from "vitest";
import { createApp } from "../apps/server/src/app";
import { Ledger } from "../packages/domain/src/ledger";
it("limits synthetic session creation and refuses client-supplied shop scope", async () => {
  const l = new Ledger(":memory:"),
    app = createApp(l, { sessionLimit: 2 }),
    server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const post = (data: any) =>
      fetch(url + "/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
    expect((await post({ seed: false, shop: "forged" })).status).toBe(400);
    expect((await post({ seed: false })).status).toBe(200);
    expect((await post({ seed: false })).status).toBe(429);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    l.db.close();
  }
});
