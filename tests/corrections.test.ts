import { it, expect } from "vitest";
import { setup } from "./helpers";

it("corrects a cash sale's quantity and records the cash handed back", () => {
  const { l, t, add, item } = setup();
  const sale = add("record_sale", { customer: null, lines: [{ item: "sugar", qty: 2000 }] });
  expect(sale.data.paid).toBe(10000);
  const fix = add("correct_entry", { lines: [{ item: "Sugar", qty: 1000 }] });
  expect(fix.data.receipt).toBe(sale.id);
  expect(fix.data.cashDelta).toBe(-5000);
  const s = l.state(t);
  expect(s.items[0].stock).toBe(9000);
  expect(s.revenue).toBe(5000);
  expect(s.cash).toBe(5000);
  expect(item.id).toBe(s.items[0].id);
});

it("moves a credit sale to the right customer and turns credit into cash or back", () => {
  const { l, t, add } = setup();
  add("add_customer", { name: "Meena" });
  add("record_sale", { customer: "ramesh", lines: [{ item: "Sugar", qty: 2000 }], paid: 3000 });
  add("correct_entry", { customer: "Meena" });
  let s = l.state(t);
  expect(s.customers.find((c) => c.name === "Ramesh")!.balance).toBe(0);
  expect(s.customers.find((c) => c.name === "Meena")!.balance).toBe(7000);
  expect(s.receivables.filter((r) => r.amount - r.received > 0).map((r) => r.customer)).toEqual(["Meena"]);
  // It was actually a walk-in who paid in full
  add("correct_entry", { customer: null });
  s = l.state(t);
  expect(s.customers.every((c) => c.balance === 0)).toBe(true);
  expect(s.cash).toBe(10000);
  // ...no, it was Ramesh on credit after all
  add("correct_entry", { customer: "Ramesh", paid: 0 });
  s = l.state(t);
  expect(s.customers.find((c) => c.name === "Ramesh")!.balance).toBe(10000);
  expect(s.cash).toBe(0);
  add("record_payment", { customer: "Ramesh", amount: 4000 });
  expect(() => add("correct_entry", { customer: "Meena" })).toThrow(/already repaid/);
});

it("cancels a sale completely and returns its stock", () => {
  const { l, t, add } = setup();
  add("record_sale", { customer: "Ramesh", lines: [{ item: "Sugar", qty: 3000 }], paid: 5000 });
  const fix = add("correct_entry", { lines: [], paid: 0 });
  expect(fix.data.cashDelta).toBe(-5000);
  const s = l.state(t);
  expect(s.items[0].stock).toBe(10000);
  expect(s.revenue).toBe(0);
  expect(s.cash).toBe(0);
  expect(s.customers[0].balance).toBe(0);
});

it("corrects and cancels a payment, re-allocating it to bills", () => {
  const { l, t, add } = setup();
  add("record_sale", { customer: "Ramesh", lines: [{ item: "Sugar", qty: 2000 }], paid: 0 });
  add("record_payment", { customer: "Ramesh", amount: 3000 });
  add("correct_payment", { amount: 2000 });
  let s = l.state(t);
  expect(s.customers[0].balance).toBe(8000);
  expect(s.cash).toBe(2000);
  expect(s.receivables.reduce((n, r) => n + r.received, 0)).toBe(2000);
  add("correct_payment", { amount: 0 });
  s = l.state(t);
  expect(s.customers[0].balance).toBe(10000);
  expect(s.receivables.reduce((n, r) => n + r.received, 0)).toBe(0);
  expect(() => add("correct_payment", { amount: 20000 })).toThrow(/only owed/);
});

it("rejects future-dated entries and allows back-dated ones", () => {
  const { l, t } = setup();
  const future = new Date(Date.now() + 86400000).toISOString();
  expect(() =>
    l.preview(t, "record_sale", { customer: null, lines: [{ item: "Sugar", qty: 1000 }], effectiveAt: future }),
  ).toThrow(/future/);
  const past = new Date(Date.now() - 86400000).toISOString();
  expect(l.preview(t, "record_sale", { customer: null, lines: [{ item: "Sugar", qty: 1000 }], effectiveAt: past }).data.effectiveAt).toBe(past);
});

it("a pending preview survives unrelated entries but not changes that alter it", () => {
  const { l, t, add } = setup();
  const pay = l.preview(t, "add_customer", { name: "Meena" });
  const sale = l.preview(t, "record_sale", { customer: null, lines: [{ item: "Sugar", qty: 1000 }] });
  add("record_purchase", { lines: [{ item: "Sugar", qty: 1000, price: 4000 }] });
  expect(l.confirm(t, pay.id).kind).toBe("add_customer");
  add("set_price", { item: "Sugar", price: 6000 });
  expect(() => l.confirm(t, sale.id)).toThrow(/State changed/);
});
