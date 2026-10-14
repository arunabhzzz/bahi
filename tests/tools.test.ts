import { it, expect } from "vitest";
import { Ledger } from "../packages/domain/src/ledger";
import { seedDemo } from "../apps/server/src/seed";
import { toolDefinitions } from "../apps/server/src/mcp/tools";

// Calls tools exactly as the MCP server does (schema-validate, then run),
// without needing the SDK transport.
function shop(seed = true) {
  const l = new Ledger(":memory:"),
    t = l.session();
  if (seed) seedDemo(l, t);
  const defs = Object.fromEntries(toolDefinitions(l, t).map((d) => [d.name, d]));
  const call = (name: string, args: any = {}) => defs[name].run(defs[name].schema.parse(args));
  return { l, t, defs, call };
}

it("every tool has its own description and strict input schema", () => {
  const { defs } = shop(false);
  const descriptions = Object.values(defs).map((d) => d.description);
  expect(new Set(descriptions).size).toBe(descriptions.length);
  for (const d of Object.values(defs)) {
    expect(d.description.length).toBeGreaterThan(40);
    expect(() => d.schema.parse({ shop: "forged" })).toThrow();
  }
  expect(Object.keys(defs)).toContain("explain_sales_change");
  expect(Object.keys(defs)).toContain("correct_entry");
});

it("takes spoken names, rupees and natural units, previews in words, and saves only on confirm", () => {
  const { l, t, call } = shop();
  const before = l.state(t);
  const sugar = before.items.find((i) => i.name === "Sugar")!;
  const ramesh = before.customers.find((c) => c.name === "Ramesh")!.balance;
  const p = call("record_sale", {
    customer: "ramesh",
    items: [{ item: "cheeni", quantity: 2 }, { item: "egg", quantity: 1, unit: "dozen" }],
    paid: 50,
  });
  expect(p.needsConfirmation).toBe(true);
  expect(p.say).toMatch(/^Sale to Ramesh: 2 kg Sugar ₹96, 12 pieces Eggs ₹84\. Total ₹180; paid ₹50, ₹130 on credit/);
  expect(l.state(t).version).toBe(before.version);
  const r = call("confirm_operation", { operation: p.operation });
  expect(r.say).toMatch(/Recorded\. Sugar now/);
  expect(call("confirm_operation", { operation: p.operation }).receipt.id).toBe(r.receipt.id);
  const after = l.state(t);
  expect(after.items.find((i) => i.name === "Sugar")!.stock).toBe(sugar.stock - 2000);
  expect(after.customers.find((c) => c.name === "Ramesh")!.balance).toBe(ramesh + 13000);
});

it("gives change instead of rejecting a round-note payment", () => {
  const { call } = shop();
  const p = call("record_sale", { items: [{ item: "sugar", quantity: 2 }], paid: 100 });
  expect(p.say).toMatch(/Total ₹96, paid in full\. Give ₹4 change\./);
});

it("explains problems in words the assistant can say back", () => {
  const { call } = shop();
  expect(() => call("record_sale", { items: [{ item: "oil", quantity: 1 }] })).toThrow(/could be Mustard Oil or Hair Oil/);
  expect(() => call("record_sale", { items: [{ item: "mustard oil", quantity: 1, unit: "kg" }] })).toThrow(/sold by the piece/);
  expect(() => call("record_sale", { items: [{ item: "eggs", quantity: 1.5 }] })).toThrow(/whole pieces/);
  expect(() => call("record_payment", { customer: "Suresh", amount: 10 })).toThrow(/owes nothing/);
  expect(() => call("record_purchase", { items: [{ item: "sugar", quantity: 3, totalCost: 100 }] })).toThrow(/price per kg/);
});

it("reads are short and spoken, not a dump of the ledger", () => {
  const { call } = shop();
  const owes = call("who_owes");
  expect(owes.say).toMatch(/owe you ₹[\d,]+: Farooq ₹/);
  expect(JSON.stringify(owes).length).toBeLessThan(2000);
  expect(call("check_stock", { item: "chawal" }).say).toMatch(/^Rice: \d+ kg in stock, selling at ₹60 per kg\.$/);
  expect(call("who_owes", { customer: "farooq" }).say).toMatch(/^Farooq owes ₹/);
  expect(call("explain_sales_change", { date: "tuesday" }).say).toMatch(/Ramesh/);
  expect(call("recent_entries", { limit: 3 }).entries).toHaveLength(3);
});

it("corrects the latest sale by voice-style arguments", () => {
  const { l, t, call } = shop();
  const sale = call("record_sale", { customer: "Ramesh", items: [{ item: "sugar", quantity: 3 }] });
  call("confirm_operation", { operation: sale.operation });
  const fix = call("correct_entry", { items: [{ item: "sugar", quantity: 2 }] });
  expect(fix.say).toMatch(/from 3 kg Sugar ₹144 to Ramesh, ₹144 to 2 kg Sugar ₹96 to Ramesh, ₹96\. Ramesh's credit goes down ₹48/);
  call("confirm_operation", { operation: fix.operation });
  const who = call("correct_entry", { customer: "Meena" });
  expect(who.say).toMatch(/Ramesh's credit goes down ₹96\. Meena's credit goes up ₹96/);
  call("discard_operation", { operation: who.operation });
  expect(() => call("confirm_operation", { operation: who.operation })).toThrow(/expired/);
  expect(() => call("correct_entry", {})).toThrow(/What should change/);
  expect(l.state(t).events.at(-1)!.kind).toBe("correct_entry");
});

it("plans restock in rupees and can revise and save the plan", () => {
  const { call } = shop();
  const plan = call("plan_restock", { budget: 2000, reserve: 500 });
  expect(plan.total + plan.reserve).toBeLessThanOrEqual(200000);
  expect(plan.say).toMatch(/assuming no delivery charge/);
  expect(plan.lines.some((l: any) => ["Ghee", "Hair Oil"].includes(l.name))).toBe(false);
  const revised = call("revise_plan", { plan: plan.id, budget: 2500, exclude: ["biscuits"] });
  expect(revised.constraints.budget).toBe(250000);
  expect(revised.constraints.exclude).toEqual(["Biscuits"]);
  const draft = call("save_order_draft", { plan: revised.id });
  expect(draft.say).toMatch(/Nothing is sent to the supplier/);
});
