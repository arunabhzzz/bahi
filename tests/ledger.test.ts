import { it, expect } from "vitest";
import { Ledger } from "../packages/domain/src/ledger";
it("persists shop scoped opening stock through confirmation and rejects stale or foreign approval", () => {
  const l = new Ledger(":memory:");
  const a = l.session(),
    b = l.session();
  const op = l.preview(a, "add_item", {
    name: "Sugar",
    unit: "kg",
    stock: 10000,
    price: 5000,
    cost: 4000,
    pack: 1000,
    leadDays: 1,
  });
  expect(l.state(a).items).toHaveLength(0);
  expect(() => l.confirm(b, op.id)).toThrow();
  const receipt = l.confirm(a, op.id);
  expect(l.confirm(a, op.id)).toEqual(receipt);
  expect(l.state(a).items[0].stock).toBe(10000);
  expect(l.state(b).items).toHaveLength(0);
  expect(() => l.db.prepare("DELETE FROM events").run()).toThrow();
});
