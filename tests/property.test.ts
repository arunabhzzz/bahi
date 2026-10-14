import { it, expect } from "vitest";
import fc from "fast-check";
import { setup } from "./helpers";
it("reconciles inventory, receivables and revenue over generated confirmed sales and purchase sequences", () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.record({
          purchase: fc.boolean(),
          qty: fc.integer({ min: 1, max: 4 }),
        }),
        { minLength: 1, maxLength: 30 },
      ),
      (steps) => {
        const { l, t, add, item } = setup();
        let stock = 10000,
          revenue = 0;
        for (const step of steps) {
          const qty = step.qty * 1000;
          if (step.purchase) {
            add("record_purchase", {
              lines: [{ item: item.id, qty, price: 4000 }],
            });
            stock += qty;
          } else if (qty <= stock) {
            add("record_sale", {
              customer: "Ramesh",
              lines: [{ item: item.id, qty }],
              paid: 0,
            });
            stock -= qty;
            revenue += step.qty * 5000;
          }
          const state = l.state(t);
          expect(state.items[0].stock).toBe(stock);
          expect(state.revenue).toBe(revenue);
          expect(state.customers[0].balance).toBe(revenue);
          expect(
            state.receivables.reduce((n, r) => n + r.amount - r.received, 0),
          ).toBe(revenue);
        }
        l.db.close();
      },
    ),
    { numRuns: 100, seed: 2810 },
  );
});
it("concurrent last-stock previews admit only one commit and do not double-deplete stock", () => {
  const { l, t, item } = setup();
  const a = l.preview(t, "record_sale", {
      customer: "Ramesh",
      lines: [{ item: item.id, qty: 10000 }],
      paid: 0,
    }),
    b = l.preview(t, "record_sale", {
      customer: "Ramesh",
      lines: [{ item: item.id, qty: 10000 }],
      paid: 0,
    });
  l.confirm(t, a.id);
  expect(() => l.confirm(t, b.id)).toThrow(/State changed/);
  expect(l.state(t).items[0].stock).toBe(0);
  expect(l.state(t).revenue).toBe(50000);
});
