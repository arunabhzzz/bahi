import { it, expect } from "vitest";
import { createApp } from "../apps/server/src/app";
import { Ledger } from "../packages/domain/src/ledger";

it("the simulator drives a full shop conversation through real MCP, isolated per session", async () => {
  const l = new Ledger(":memory:"),
    app = createApp(l),
    server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  const session = async () => {
    const r = await fetch(url + "/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"seed":true}',
    });
    return (await r.json()).token;
  };
  try {
    const token = await session(),
      other = await session();
    const say = async (text: string) => {
      const r = await fetch(url + "/api/command", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text }),
      });
      const data = await r.json();
      expect(r.status, data.error).toBe(200);
      return data;
    };
    const sugar = (t = token) => l.state(t).items.find((i) => i.name === "Sugar")!.stock;
    const owes = (name: string) => l.state(token).customers.find((c) => c.name === name)!.balance;
    const start = sugar(),
      ramesh = owes("Ramesh");
    const preview = await say("Sold 2 kg cheeni to Ramesh, he paid 30");
    expect(preview.message).toMatch(/^Sale to Ramesh: 2 kg Sugar ₹96/);
    expect(sugar()).toBe(start);
    const sale = await say("haan");
    expect(sale.receipt.kind).toBe("record_sale");
    expect(sugar()).toBe(start - 2000);
    await say("no, that was 1 kg");
    await say("yes");
    expect(sugar()).toBe(start - 1000);
    expect(owes("Ramesh")).toBe(ramesh + 1800);
    await say("Ramesh paid 18");
    await say("yes");
    expect(owes("Ramesh")).toBe(ramesh);
    const why = await say("Why were sales down on Tuesday?");
    expect(why.message).toMatch(/Ramesh, who usually spends/);
    expect(why.insight.chart.labels.length).toBeGreaterThan(0);
    const p = await say("plan budget 2000 reserve 500 fee 0");
    await say("leave out biscuits");
    const revise = await say("budget 2500");
    expect(revise.plan.previous).not.toBe(p.plan.id);
    await say("save draft");
    const saved = await say("yes");
    expect(saved.context.plan).toBeUndefined();
    expect(l.state(token).drafts[0].id).toBe(saved.receipt.id);
    expect(sugar(other)).toBe(l.state(other).items.find((i) => i.name === "Sugar")!.stock);
    expect(l.state(other).drafts).toHaveLength(0);
    expect(app.locals.trace.filter((x: any) => x.name === "confirm_operation")).toHaveLength(4);
    expect(app.locals.protocols).toContain("2025-11-25");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    l.db.close();
  }
}, 30000);
