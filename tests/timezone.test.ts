import { it, expect } from "vitest";
import { setup } from "./helpers";
import { dailySummary } from "../packages/analytics/src/summary";
it("summary uses configured shop timezone at local midnight", () => {
  const { l, t, add, item } = setup();
  add("configure_shop", {
    name: "Synthetic Store",
    currency: "INR",
    timezone: "Asia/Kolkata",
  });
  add("record_sale", {
    customer: "Ramesh",
    lines: [{ item: item.id, qty: 1000 }],
    paid: 0,
    effectiveAt: "2026-01-01T20:00:00Z",
  });
  expect(dailySummary(l.state(t), "2026-01-02").revenue).toBe(5000);
  expect(dailySummary(l.state(t), "2026-01-01").revenue).toBe(0);
  expect(dailySummary(l.state(t), "2026-01-02").timezone).toBe("Asia/Kolkata");
});
