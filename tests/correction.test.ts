import { it, expect } from "vitest";
import { setup } from "./helpers";
it("correction preserves history, reverses stock/revenue, rejects refund ambiguity after repayments", () => {
  const { l, t, add, item } = setup();
  const sale = add("record_sale", {
    customer: "Ramesh",
    lines: [{ item: item.id, qty: 2000 }],
    paid: 3000,
  });
  const correction = add("correct_entry", {
    receipt: sale.id,
    lines: [{ item: item.id, qty: 1000 }],
    paid: 3000,
  });
  expect(correction.data.original.id).toBe(sale.id);
  expect(l.state(t).items[0].stock).toBe(9000);
  expect(l.state(t).customers[0].balance).toBe(2000);
  expect(l.state(t).revenue).toBe(5000);
  expect(
    l.state(t).events.filter((e) => e.kind === "record_sale"),
  ).toHaveLength(1);
  expect(() =>
    add("correct_entry", {
      receipt: sale.id,
      lines: [{ item: item.id, qty: 1000 }],
      paid: 3000,
    }),
  ).toThrow(/already/);
  add("record_payment", { customer: "Ramesh", amount: 2000 });
  expect(() =>
    add("correct_entry", {
      receipt: correction.id,
      lines: [{ item: item.id, qty: 500 }],
      paid: 1000,
    }),
  ).toThrow(/refund/);
});
