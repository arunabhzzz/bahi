import { it, expect } from "vitest";
import { setup } from "./helpers";
import { dailySummary } from "../packages/analytics/src/summary";
it("daily UTC summary excludes historical seeds, includes correction deltas on original dates and repayment cash separately", () => {
  const { l, t, add, item } = setup();
  add("record_sale", {
    customer: "Ramesh",
    lines: [{ item: item.id, qty: 1000 }],
    paid: 0,
    effectiveAt: "2026-01-01T12:00:00Z",
  });
  const sale = add("record_sale", {
    customer: "Ramesh",
    lines: [{ item: item.id, qty: 2000 }],
    paid: 3000,
  });
  add("correct_entry", {
    receipt: sale.id,
    lines: [{ item: item.id, qty: 1000 }],
    paid: 3000,
  });
  add("record_payment", { customer: "Ramesh", amount: 1000 });
  const s = dailySummary(l.state(t));
  expect(s.revenue).toBe(5000);
  expect(s.saleCash).toBe(3000);
  expect(s.repaymentCash).toBe(1000);
  expect(s.cashReceived).toBe(4000);
  expect(s.evidence.length).toBe(3);
  expect(s.timezone).toBe("UTC");
});
