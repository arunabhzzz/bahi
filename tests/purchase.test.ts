import { it, expect } from "vitest";
import { setup } from "./helpers";
it("purchase has actual cost but no implied supplier payment and price updates preserve historical sale totals", () => {
  const { l, t, add, item } = setup();
  const sale = add("record_sale", {
    customer: "Ramesh",
    lines: [{ item: item.id, qty: 1000 }],
    paid: 0,
  });
  add("record_purchase", {
    lines: [{ item: item.id, qty: 3000, price: 4200 }],
  });
  add("set_price", { item: item.id, price: 6000, cost: 4200 });
  expect(l.state(t).items[0]).toMatchObject({
    stock: 12000,
    price: 6000,
    cost: 4200,
  });
  expect(l.state(t).cash).toBe(0);
  expect(l.state(t).events.find((e) => e.id === sale.id)!.data.total).toBe(
    5000,
  );
  expect(
    add("record_sale", {
      customer: "Ramesh",
      lines: [{ item: item.id, qty: 1000 }],
      paid: 0,
    }).data.total,
  ).toBe(6000);
});
