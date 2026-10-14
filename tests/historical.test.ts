import { it, expect } from "vitest";
import { setup } from "./helpers";
it("correction preserves original historical line prices after catalogue changes", () => {
  const { l, t, add, item } = setup();
  const sale = add("record_sale", {
    customer: "Ramesh",
    lines: [{ item: item.id, qty: 2000 }],
    paid: 0,
  });
  add("set_price", { item: item.id, price: 8000, cost: 4000 });
  const repaired = add("correct_entry", {
    receipt: sale.id,
    lines: [{ item: item.id, qty: 1000 }],
    paid: 0,
  });
  expect(repaired.data.replacement.total).toBe(5000);
  expect(l.state(t).revenue).toBe(5000);
});
