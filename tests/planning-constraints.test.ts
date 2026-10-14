import { it, expect } from "vitest";
import { setup } from "./helpers";
it("planner does not silently ignore unknown exclusion or priority names and saved drafts reserve outstanding needs", () => {
  const { l, t, add, item } = setup();
  add("record_sale", {
    customer: "Ramesh",
    lines: [{ item: item.id, qty: 9000 }],
    paid: 0,
  });
  const c = {
    budget: 20000,
    reserve: 5000,
    deliveryFee: 0,
    exclude: [],
    priority: [],
  };
  expect(() => l.plan(t, { ...c, exclude: ["Sugr"] })).toThrow(/Unknown/);
  expect(() => l.plan(t, { ...c, priority: ["Rce"] })).toThrow(/Unknown/);
  const plan = l.plan(t, c);
  add("save_order_draft", { plan: plan.id });
  expect(l.plan(t, c).lines).toHaveLength(0);
});
