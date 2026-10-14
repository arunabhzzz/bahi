import { it, expect } from "vitest";
import { Ledger } from "../packages/domain/src/ledger";
import { setup } from "./helpers";
it("requires whole stock and pack units for pieces and rejects oversized financial previews before approval", () => {
  const l = new Ledger(":memory:"),
    t = l.session();
  expect(() =>
    l.preview(t, "add_item", {
      name: "Oil",
      unit: "piece",
      stock: 1500,
      price: 100,
      cost: 50,
      pack: 1000,
      leadDays: 1,
    }),
  ).toThrow(/Whole/);
  expect(() =>
    l.preview(t, "add_item", {
      name: "Oil",
      unit: "piece",
      stock: 1000,
      price: 100,
      cost: 50,
      pack: 1500,
      leadDays: 1,
    }),
  ).toThrow(/Whole/);
  const { l: s, t: st, item } = setup();
  s.confirm(
    st,
    s.preview(st, "set_price", {
      item: item.id,
      price: 100_000_000,
      cost: 4000,
    }).id,
  );
  expect(() =>
    s.preview(st, "record_sale", {
      customer: "Ramesh",
      lines: [{ item: item.id, qty: 2000 }],
      paid: 0,
    }),
  ).toThrow(/limit/);
});
