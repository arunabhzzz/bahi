import { it, expect } from "vitest";
import { setup } from "./helpers";
it("allocates customer repayments to oldest outstanding receipts and blocks corrections requiring invoice refunds", () => {
  const { l, t, add, item } = setup();
  const first = add("record_sale", {
    customer: "Ramesh",
    lines: [{ item: item.id, qty: 1000 }],
    paid: 0,
  });
  const second = add("record_sale", {
    customer: "Ramesh",
    lines: [{ item: item.id, qty: 1000 }],
    paid: 0,
  });
  const payment = add("record_payment", { customer: "Ramesh", amount: 6000 });
  expect(payment.data.allocations).toEqual([
    { receipt: first.id, amount: 5000 },
    { receipt: second.id, amount: 1000 },
  ]);
  expect(l.state(t).receivables.find((r) => r.id === second.id)!.received).toBe(
    1000,
  );
  expect(() =>
    add("correct_entry", {
      receipt: first.id,
      lines: [{ item: item.id, qty: 500 }],
      paid: 0,
    }),
  ).toThrow(/refund/);
});
