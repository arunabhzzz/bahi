import { it, expect, vi } from "vitest";
import { setup } from "./helpers";
import { dailySummary } from "../packages/analytics/src/summary";
it("chained corrections crossing midnight retain the original business date even for non-backdated sales", () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2026-01-01T23:50:00Z"));
    const { l, t, add, item } = setup();
    const sale = add("record_sale", {
      customer: "Ramesh",
      lines: [{ item: item.id, qty: 2000 }],
      paid: 0,
    });
    vi.setSystemTime(new Date("2026-01-02T00:10:00Z"));
    const correction = add("correct_entry", {
      receipt: sale.id,
      lines: [{ item: item.id, qty: 1000 }],
      paid: 0,
    });
    vi.setSystemTime(new Date("2026-01-02T00:20:00Z"));
    add("correct_entry", {
      receipt: correction.id,
      lines: [{ item: item.id, qty: 500 }],
      paid: 0,
    });
    expect(dailySummary(l.state(t), "2026-01-01").revenue).toBe(2500);
    expect(dailySummary(l.state(t), "2026-01-02").revenue).toBe(0);
    l.db.close();
  } finally {
    vi.useRealTimers();
  }
});
