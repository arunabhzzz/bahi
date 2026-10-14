import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { Ledger } from "../packages/domain/src/ledger";
import { createApp } from "../apps/server/src/app";
it("conversation retry keys retrieve committed receipts and reject changed payloads, including lost response cache", async () => {
  const l = new Ledger(":memory:"),
    app = createApp(l),
    server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const t = (
      await (
        await fetch(url + "/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: '{"seed":true}',
        })
      ).json()
    ).token;
    const say = (text: string, requestId: string) =>
      fetch(url + "/api/command", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${t}`,
        },
        body: JSON.stringify({ text, requestId }),
      });
    const preview = await say("sell 1 kg sugar to Ramesh paid 0", randomUUID());
    expect(preview.status).toBe(200);
    const key = randomUUID();
    const first = await say("confirm", key);
    expect(first.status).toBe(200);
    const saved = await first.json();
    const count = l.state(t).version;
    expect((await (await say("confirm", key)).json()).receipt.id).toBe(
      saved.receipt.id,
    );
    expect((await say("stock", key)).status).toBe(409);
    l.db.prepare("UPDATE requests SET response=NULL WHERE id=?").run(key);
    expect((await (await say("confirm", key)).json()).receipt.id).toBe(
      saved.receipt.id,
    );
    expect(l.state(t).version).toBe(count);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    l.db.close();
  }
}, 20000);
