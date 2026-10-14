import { it, expect } from "vitest";
import { Ledger } from "../packages/domain/src/ledger";
import { seedDemo, DEMO_PRODUCTS, DEMO_CUSTOMERS } from "../apps/server/src/seed";

it("seeds five weeks of synthetic history through the normal preview/confirm path", () => {
  const l = new Ledger(":memory:"),
    t = l.session();
  const s = seedDemo(l, t);
  expect(s.shop.timezone).toBe("Asia/Kolkata");
  expect(s.items.map((i) => i.name)).toEqual(DEMO_PRODUCTS.map((p) => p.name));
  expect(s.customers.map((c) => c.name)).toEqual(DEMO_CUSTOMERS);
  const sales = s.events.filter((e) => e.kind === "record_sale");
  expect(sales.length).toBeGreaterThan(250);
  expect(sales.some((e) => e.data.customer && e.data.paid < e.data.total)).toBe(true);
  expect(s.events.some((e) => e.kind === "record_payment")).toBe(true);
  expect(s.events.some((e) => e.kind === "record_purchase")).toBe(true);
  // nothing in the future, every item still in stock or at zero, never negative
  expect(sales.every((e) => Date.parse(e.data.effectiveAt) <= Date.now())).toBe(true);
  expect(s.items.every((i) => i.stock >= 0)).toBe(true);
  expect(s.items.find((i) => i.name === "Sugar")!.stock).toBeGreaterThan(3000);
  expect(() => seedDemo(l, t)).toThrow(/empty/);
  const p = l.plan(t, { budget: 200000, reserve: 50000, deliveryFee: 0, exclude: [], priority: [] });
  expect(p.total).toBeLessThanOrEqual(150000);
  expect(p.lines.some((line) => line.evidence.length > 5)).toBe(true);
});
