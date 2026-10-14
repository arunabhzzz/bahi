import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { createApp } from "../apps/server/src/app";
import { setup } from "./helpers";

it("a failed confirm retry must not bind to a later unrelated preview", async () => {
  const { l, t } = setup();
  const server = createApp(l).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  const say = (text: string, requestId: string) =>
    fetch(url + "/api/command", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${t}`,
      },
      body: JSON.stringify({ text, requestId }),
    });
  try {
    const key = randomUUID();
    expect((await say("confirm", key)).status).toBe(400);
    expect(
      (await say("sell 1 kg sugar to Ramesh paid 0", randomUUID())).status,
    ).toBe(200);
    const version = l.state(t).version;
    const retry = await say("confirm", key);
    // The key represented a failed confirmation with no authorized payload.
    expect({ status: retry.status, version: l.state(t).version }).toEqual({
      status: 400,
      version,
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    l.db.close();
  }
}, 20000);

it("confirmation after an unseen replacement preview must not commit that replacement", async () => {
  const { l, t } = setup();
  const server = createApp(l).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  const say = (
    text: string,
    confirmationOperation?: string,
    requestId = randomUUID(),
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
    const shown = await (await say("sell 1 kg sugar to Ramesh paid 0")).json();
    // Model a dropped response: the server previews B, but the screen still shows A.
    const unseen = await say("sell 2 kg sugar to Ramesh paid 0");
    expect(unseen.status).toBe(200);
    // The fixed browser sends the displayed ID; an unseen replacement must be rejected.
    const version = l.state(t).version;
    const key = randomUUID();
    const confirmed = await say("confirm", shown.pending.id, key);
    expect(confirmed.status).toBe(400);
    expect((await confirmed.json()).error).toContain("Preview changed");
    expect(l.state(t).version).toBe(version);
    expect((await say("confirm", shown.pending.id, key)).status).toBe(400);
    expect(l.state(t).version).toBe(version);
    expect(
      l.state(t).events.some((event) => event.kind === "record_sale"),
    ).toBe(false);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    l.db.close();
  }
}, 20000);

it("restock history must retain a corrected sale's original effective date", () => {
  const { l, t, add } = setup();
  try {
    const item = add("add_item", {
      name: "Rice",
      unit: "kg",
      stock: 10000,
      price: 5000,
      cost: 4000,
      pack: 1000,
      leadDays: 30,
    });
    const oldDate = new Date(Date.now() - 30 * 86400000).toISOString();
    const sale = add("record_sale", {
      customer: "Ramesh",
      lines: [{ item: item.id, qty: 9000 }],
      paid: 0,
      effectiveAt: oldDate,
    });
    const correction = add("correct_entry", {
      receipt: sale.id,
      lines: [{ item: item.id, qty: 8000 }],
      paid: 0,
    });
    const chained = add("correct_entry", {
      receipt: correction.id,
      lines: [{ item: item.id, qty: 8000 }],
      paid: 0,
    });
    expect(chained.data.replacement.effectiveAt).toBe(oldDate);
    const plan = l.plan(t, {
      budget: 100000,
      reserve: 0,
      deliveryFee: 0,
      exclude: [],
      priority: [],
    });
    // The corrected sale is 30 days old, so it is not recent demand and the
    // remaining 2 kg are not reordered.
    const line = plan.lines.find((line: any) => line.item === item.id);
    expect(line).toBeUndefined();
    expect(correction.data.replacement.effectiveAt).toBe(oldDate);
  } finally {
    l.db.close();
  }
});
