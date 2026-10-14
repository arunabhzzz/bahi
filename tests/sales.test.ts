import { it, expect } from "vitest";
import { setup } from "./helpers";
it("records a mixed cash and credit sale atomically, then allocates payment and rejects excess", () => {
  const { l, t, add, item } = setup();
  const receipt = add("record_sale", {
    customer: "Ramesh",
    lines: [{ item: item.id, qty: 2000 }],
    paid: 3000,
  });
  expect(receipt.data.total).toBe(10000);
  expect(l.state(t).items[0].stock).toBe(8000);
  expect(l.state(t).customers[0].balance).toBe(7000);
  add("record_payment", { customer: "Ramesh", amount: 2000 });
  expect(l.state(t).customers[0].balance).toBe(5000);
  expect(() =>
    add("record_payment", { customer: "Ramesh", amount: 5001 }),
  ).toThrow(/Overpayment/);
  expect(() =>
    add("record_sale", {
      customer: "Ramesh",
      lines: [{ item: item.id, qty: 9000 }],
      paid: 0,
    }),
  ).toThrow(/stock/);
  expect(l.state(t).cash).toBe(5000);
  expect(l.state(t).revenue).toBe(10000);
});
