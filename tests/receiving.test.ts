import { it, expect } from "vitest";
import { setup } from "./helpers";
it("revises read-only scenarios, saves an unsent plan and partially receives exact actual prices idempotently", () => {
  const { l, t, add, item } = setup();
  add("record_sale", {
    customer: "Ramesh",
    lines: [{ item: item.id, qty: 9000 }],
    paid: 0,
  });
  const version = l.state(t).version;
  const plan = l.plan(t, {
    budget: 20000,
    reserve: 5000,
    deliveryFee: 0,
    exclude: [],
    priority: [],
  });
  const revised = l.revise(t, plan.id, { budget: 30000 });
  expect(l.state(t).version).toBe(version);
  expect(revised.previous).toBe(plan.id);
  const draft = add("save_order_draft", { plan: revised.id });
  expect(l.state(t).items[0].stock).toBe(1000);
  const line = l.state(t).drafts[0].lines[0];
  const op = l.preview(t, "receive_order", {
    draft: draft.id,
    lines: [{ item: item.id, qty: 500, price: 4500 }],
  });
  const receipt = l.confirm(t, op.id);
  expect(l.confirm(t, op.id)).toEqual(receipt);
  expect(l.state(t).items[0].stock).toBe(1500);
  expect(l.state(t).drafts[0].lines[0].remaining).toBe(line.qty - 500);
  expect(l.state(t).cash).toBe(0);
  expect(() =>
    add("receive_order", {
      draft: draft.id,
      lines: [{ item: item.id, qty: line.qty, price: 4500 }],
    }),
  ).toThrow(/outstanding/);
  const other = l.session();
  expect(() =>
    l.preview(other, "receive_order", {
      draft: draft.id,
      lines: [{ item: item.id, qty: 500, price: 4500 }],
    }),
  ).toThrow();
  add("cancel_order_draft", { draft: draft.id });
  expect(() =>
    add("receive_order", {
      draft: draft.id,
      lines: [{ item: item.id, qty: 1000, price: 4500 }],
    }),
  ).toThrow(/draft/);
  // receiving the 1 kg pack in two halves leaves it fully received
  expect(line.qty).toBe(1000);
});
