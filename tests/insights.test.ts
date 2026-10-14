import { it, expect } from "vitest";
import { Ledger } from "../packages/domain/src/ledger";
import { seedDemo } from "../apps/server/src/seed";
import {
  creditRisk,
  dailySummary,
  deadStock,
  explainSalesChange,
  lowStockForecast,
  salesReport,
} from "../packages/analytics/src/insights";
import { addDays, resolveDay } from "../packages/analytics/src/facts";

// The planted demo story must be found whatever weekday the demo runs on.
for (let back = 0; back < 7; back++)
  it(`finds the planted Tuesday dip when today is ${back} day(s) earlier`, () => {
    const now = Date.now() - back * 86400000;
    const l = new Ledger(":memory:"),
      t = l.session();
    const s = seedDemo(l, t, now);
    const why = explainSalesChange(s, { date: "tuesday", now });
    expect(why.changePct!).toBeLessThan(-20);
    expect(why.say).toMatch(/Ramesh, who usually spends about ₹1,350 on Tuesdays, didn't buy anything/);
    expect(why.say).toMatch(/Sugar ran out around 11:20/);
    const risk = creditRisk(s, { now });
    expect(risk.customers[0]).toMatchObject({ name: "Farooq", risk: "high" });
    expect(deadStock(s, { now }).items.map((i) => i.name)).toEqual(["Ghee", "Hair Oil"]);
    l.db.close();
  });

it("summarises a day against the same weekday and reports charts", () => {
  const l = new Ledger(":memory:"),
    t = l.session();
  const s = seedDemo(l, t);
  const yesterday = dailySummary(s, "yesterday");
  expect(yesterday.revenue).toBeGreaterThan(0);
  expect(yesterday.comparison!.date).toBe(addDays(yesterday.date, -7));
  expect(yesterday.say).toMatch(/in sales from \d+ bills/);
  const report = salesReport(s, { by: "item", days: 28 });
  expect(report.chart.labels.length).toBeGreaterThan(5);
  expect(report.total).toBeGreaterThan(0);
  const weekday = salesReport(s, { by: "weekday" });
  expect(weekday.chart.labels).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  const low = lowStockForecast(s);
  expect(low.items.every((i) => i.daysLeft === null || i.daysLeft >= 0)).toBe(true);
  l.db.close();
});

it("resolves spoken days in the shop's timezone", () => {
  const now = Date.parse("2026-10-14T06:00:00Z"); // Wednesday in India
  expect(resolveDay("tuesday", "Asia/Kolkata", now)).toBe("2026-10-13");
  expect(resolveDay("wednesday", "Asia/Kolkata", now)).toBe("2026-10-14");
  expect(resolveDay("last wednesday", "Asia/Kolkata", now)).toBe("2026-10-07");
  expect(resolveDay("mangalwar", "Asia/Kolkata", now)).toBe("2026-10-13");
  expect(resolveDay("yesterday", "Asia/Kolkata", now)).toBe("2026-10-13");
  expect(() => resolveDay("2027-01-01", "Asia/Kolkata", now)).toThrow(/future/);
});
