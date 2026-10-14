import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { createApp } from "../apps/server/src/app";
import { setup } from "./helpers";

it("explicit authorization survives lost cache and rejects changed retry bindings", async () => {
  const { l, t } = setup();
  const server = createApp(l).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  const say = (
    text: string,
    requestId = randomUUID(),
    confirmationOperation?: string,
  ) =>
    fetch(url + "/api/command", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${t}`,
      },
      body: JSON.stringify({ text, requestId, confirmationOperation }),
    });
  try {
    const preview = await (
      await say("sell 1 kg sugar to Ramesh paid 0")
    ).json();
    const key = randomUUID();
    const first = await say("confirm", key, preview.pending.id);
    expect(first.status).toBe(200);
    const saved = await first.json();
    const next = await (await say("sell 2 kg sugar to Ramesh paid 0")).json();
    const version = l.state(t).version;
    expect((await say("confirm", key, next.pending.id)).status).toBe(409);
    expect((await say("confirm", key)).status).toBe(409);
    l.db
      .prepare("UPDATE requests SET response=NULL WHERE id=? AND token=?")
      .run(key, t);
    const retry = await say("confirm", key, preview.pending.id);
    expect(retry.status).toBe(200);
    expect((await retry.json()).receipt).toEqual(saved.receipt);
    expect(l.state(t).version).toBe(version);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    l.db.close();
  }
}, 20000);
