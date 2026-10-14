import { it, expect } from "vitest";
import fc from "fast-check";
import { setup } from "./helpers";
import { planRestock } from "../packages/analytics/src/restock-plan";
it("plans packs within explicit budget and reserve without writes and refuses missing costs/fees", () => {
  const { l, t } = setup();
  const s = l.state(t);
  s.items[0].stock = 0;
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 100000 }),
      fc.integer({ min: 0, max: 100000 }),
      (budget, reserve) => {
        if (reserve > budget) return;
        const plan = planRestock(s, {
          budget,
          reserve,
          deliveryFee: 0,
          exclude: [],
          priority: [],
        });
        expect(plan.total + reserve).toBeLessThanOrEqual(budget);
        for (const line of plan.lines) expect(line.qty % 1000).toBe(0);
      },
    ),
  );
  const p = planRestock(s, {
    budget: 20000,
    reserve: 5000,
    deliveryFee: 0,
    exclude: [],
    priority: [],
  });
  expect(p.lines[0].qty).toBeGreaterThan(0);
  expect(l.state(t).version).toBe(s.version);
  s.items[0].cost = null;
  expect(() =>
    planRestock(s, {
      budget: 20000,
      reserve: 0,
      deliveryFee: 0,
      exclude: [],
      priority: [],
    }),
  ).toThrow(/cost/);
  expect(() =>
    planRestock(s, {
      budget: 20000,
      reserve: 0,
      deliveryFee: null,
      exclude: [],
      priority: [],
    }),
  ).toThrow(/fee/);
});
