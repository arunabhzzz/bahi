/**
 * The analyst. Every number here is computed from ledger events; the
 * assistant only narrates. Each function returns structured facts plus a
 * short `say` sentence suitable for reading aloud.
 */
import type { State } from "../../domain/src/ledger";
import {
  DAY,
  addDays,
  dayKey,
  dayLabel,
  paymentFacts,
  quantityText,
  resolveDay,
  rupees,
  roundRupees,
  saleFacts,
  stockTimeline,
  timeLabel,
  weekdayName,
  weekdayOf,
  type SaleFact,
} from "./facts";

const pct = (now: number, before: number) =>
  before ? Math.round(((now - before) / before) * 100) : null;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export type Chart = {
  type: "bar" | "line";
  title: string;
  unit: "₹" | "days" | "qty";
  labels: string[];
  values: number[];
  highlight?: number[];
};

// ---------------------------------------------------------------- summary

export function dailySummary(
  state: State,
  date?: string,
  compareTo?: string,
  now = Date.now(),
) {
  const tz = state.shop.timezone;
  const day = resolveDay(date, tz, now);
  const sales = saleFacts(state).filter((s) => s.day === day);
  const payments = paymentFacts(state).filter((p) => p.day === day);
  const revenue = sum(sales.map((s) => s.total));
  const saleCash = sum(sales.map((s) => s.paid));
  const repaymentCash = sum(payments.map((p) => p.amount));
  const creditGiven = revenue - saleCash;
  const items = new Map<string, { name: string; unit: string; qty: number; revenue: number }>();
  for (const s of sales)
    for (const l of s.lines) {
      const row = items.get(l.item) ?? { name: l.name, unit: l.unit, qty: 0, revenue: 0 };
      row.qty += l.qty;
      row.revenue += l.total;
      items.set(l.item, row);
    }
  const topItems = [...items.values()]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 3)
    .map((r) => ({ ...r, qtyText: quantityText(r.qty, r.unit), revenueText: rupees(r.revenue) }));
  let comparison;
  const other =
    compareTo === "none"
      ? undefined
      : compareTo
        ? resolveDay(compareTo, tz, now, true)
        : addDays(day, -7);
  const isToday = day === dayKey(now, tz);
  // For today, compare with the other day only up to the same time of day.
  const sameTime = (s: { at: string; day: string }) =>
    !isToday || Date.parse(s.at) - Date.parse(s.day + "T00:00:00Z") <= now - Date.parse(day + "T00:00:00Z");
  if (other) {
    const before = sum(saleFacts(state).filter((s) => s.day === other && sameTime(s)).map((s) => s.total));
    comparison = {
      date: other,
      label: dayLabel(other) + (isToday ? " at this time" : ""),
      revenue: before,
      change: revenue - before,
      changePct: pct(revenue, before),
    };
  }
  const label = isToday ? "Today" : dayLabel(day);
  let say = sales.length
    ? `${label}: ${rupees(revenue)} in sales from ${sales.length} bill${sales.length === 1 ? "" : "s"}, ${rupees(saleCash)} in cash and ${rupees(creditGiven)} on credit.`
    : `${label}: no sales recorded.`;
  if (repaymentCash) say += ` ${rupees(repaymentCash)} came in as credit repayments.`;
  if (topItems.length) say += ` Top seller: ${topItems[0].name}.`;
  if (comparison && comparison.revenue)
    say += ` That's ${comparison.change >= 0 ? "up" : "down"} ${Math.abs(comparison.changePct!)}% on ${comparison.label} (${rupees(comparison.revenue)}).`;
  return {
    date: day,
    timezone: tz,
    currency: "INR",
    revenue,
    saleCash,
    repaymentCash,
    cashReceived: saleCash + repaymentCash,
    creditGiven,
    bills: sales.length,
    topItems,
    comparison,
    evidence: [...sales.flatMap((s) => s.ids), ...payments.flatMap((p) => p.ids)],
    limitation:
      "Cash received is not cash in hand: expenses and supplier payments are not tracked.",
    say,
  };
}

// ---------------------------------------------------------------- why did sales change?

export function explainSalesChange(
  state: State,
  options: { date?: string; weeks?: number; now?: number } = {},
) {
  const now = options.now ?? Date.now();
  const tz = state.shop.timezone;
  const weeks = options.weeks ?? 4;
  const day = resolveDay(options.date, tz, now, true);
  const baselineDays = Array.from({ length: weeks }, (_, i) => addDays(day, -7 * (i + 1)));
  const all = saleFacts(state);
  const on = (key: string) => all.filter((s) => s.day === key);
  const target = on(day);
  const base = baselineDays.map(on);
  const usedWeeks = base.filter((b) => b.length).length;
  if (!usedWeeks)
    return {
      date: day,
      say: `I don't have earlier ${weekdayName(day)}s to compare ${dayLabel(day)} with yet.`,
      drivers: [],
    };
  const revenue = sum(target.map((s) => s.total));
  const baseline = Math.round(sum(base.flat().map((s) => s.total)) / usedWeeks);
  const change = revenue - baseline;

  // Item drivers
  const itemTotals = (sales: SaleFact[]) => {
    const m = new Map<string, { name: string; unit: string; qty: number; revenue: number }>();
    for (const s of sales)
      for (const l of s.lines) {
        const r = m.get(l.item) ?? { name: l.name, unit: l.unit, qty: 0, revenue: 0 };
        r.qty += l.qty;
        r.revenue += l.total;
        m.set(l.item, r);
      }
    return m;
  };
  const now_ = itemTotals(target);
  const before = base.map(itemTotals);
  const timeline = stockTimeline(state, all);
  const itemIds = new Set([...now_.keys(), ...before.flatMap((m) => [...m.keys()])]);
  const items = [...itemIds].map((id) => {
    const item = state.items.find((i) => i.id === id)!;
    const usual = Math.round(sum(before.map((m) => m.get(id)?.revenue ?? 0)) / usedWeeks);
    const usualQty = Math.round(sum(before.map((m) => m.get(id)?.qty ?? 0)) / usedWeeks);
    const actual = now_.get(id)?.revenue ?? 0;
    const stock = timeline.day(id, day);
    return {
      name: item.name,
      revenue: actual,
      usual,
      change: actual - usual,
      qty: now_.get(id)?.qty ?? 0,
      usualQty,
      unit: item.unit,
      stockout: stock.ranOutAt
        ? stock.ranOutAt === "start"
          ? "out of stock all day"
          : `ran out around ${timeLabel(stock.ranOutAt, tz)}`
        : undefined,
    };
  });

  // Customer drivers (named customers; walk-ins pooled)
  const custTotals = (sales: SaleFact[]) => {
    const m = new Map<string, number>();
    for (const s of sales) m.set(s.customer ?? "Walk-in customers", (m.get(s.customer ?? "Walk-in customers") ?? 0) + s.total);
    return m;
  };
  const cNow = custTotals(target);
  const cBefore = base.map(custTotals);
  const names = new Set([...cNow.keys(), ...cBefore.flatMap((m) => [...m.keys()])]);
  const customers = [...names].map((name) => {
    const visits = cBefore.filter((m) => m.has(name)).length;
    const usual = Math.round(sum(cBefore.map((m) => m.get(name) ?? 0)) / usedWeeks);
    const actual = cNow.get(name) ?? 0;
    return {
      name,
      revenue: actual,
      usual,
      change: actual - usual,
      regular: name !== "Walk-in customers" && visits >= Math.ceil(usedWeeks * 0.75),
      came: cNow.has(name),
    };
  });

  const direction = change < 0 ? "down" : "up";
  const significant = Math.max(5000, Math.abs(change) * 0.15);
  const reasons: string[] = [];
  const missing = customers
    .filter((c) => c.regular && !c.came && c.usual >= significant / 2)
    .sort((a, b) => a.change - b.change);
  const outs = items
    .filter((i) => i.stockout && i.change < 0 && -i.change >= 5000)
    .sort((a, b) => a.change - b.change);
  if (change < 0) {
    for (const c of missing.slice(0, 2))
      reasons.push(
        `${c.name}, who usually spends about ${roundRupees(c.usual)} on ${weekdayName(day)}s, didn't buy anything`,
      );
    for (const i of outs.slice(0, 2))
      reasons.push(
        `${i.name} ${i.stockout}, so ${i.name.toLowerCase()} sales were ${roundRupees(-i.change)} below normal`,
      );
    if (!reasons.length) {
      const worst = [...items].sort((a, b) => a.change - b.change)[0];
      if (worst && worst.change < 0)
        reasons.push(`${worst.name} sold ${rupees(-worst.change)} less than usual`);
    }
  } else {
    const best = [...items].sort((a, b) => b.change - a.change)[0];
    if (best && best.change > 0) reasons.push(`${best.name} sold ${rupees(best.change)} more than usual`);
    const cust = [...customers].sort((a, b) => b.change - a.change)[0];
    if (cust && cust.change > 0 && cust.name !== "Walk-in customers")
      reasons.push(`${cust.name} spent ${rupees(cust.change)} more than usual`);
  }
  const changePct = pct(revenue, baseline);
  let say = `${dayLabel(day)}: sales were ${rupees(revenue)}, ${Math.abs(changePct ?? 0)}% ${direction} on a usual ${weekdayName(day)} (${roundRupees(baseline)}).`;
  if (Math.abs(changePct ?? 0) < 5)
    say = `${dayLabel(day)}: sales were ${rupees(revenue)}, about normal for a ${weekdayName(day)} (${roundRupees(baseline)}).`;
  else if (reasons.length)
    say += ` ${reasons.length === 1 ? "Main reason" : `${["", "", "Two", "Three", "Four"][reasons.length]} reasons`}: ${reasons.slice(0, -1).join("; ")}${reasons.length > 1 ? "; and " : ""}${reasons.at(-1)}.`;

  const chartItems = [...items].sort((a, b) => a.change - b.change).slice(0, 6);
  return {
    date: day,
    label: dayLabel(day),
    revenue,
    baseline,
    baselineDays: baselineDays.filter((_, i) => base[i].length),
    change,
    changePct,
    drivers: {
      customers: customers.sort((a, b) => a.change - b.change),
      items: items.sort((a, b) => a.change - b.change),
    },
    chart: {
      type: "bar",
      title: `${dayLabel(day)} vs a usual ${weekdayName(day)} — change by item`,
      unit: "₹",
      labels: chartItems.map((i) => i.name),
      values: chartItems.map((i) => i.change / 100),
    } satisfies Chart,
    evidence: target.flatMap((s) => s.ids),
    say,
  };
}

// ---------------------------------------------------------------- demand & stock

/** Average quantity sold per weekday over the last `weeks` complete weeks. */
function weekdayDemand(state: State, now: number, weeks = 4) {
  const tz = state.shop.timezone;
  const today = dayKey(now, tz);
  const first = addDays(today, -7 * weeks);
  const totals = new Map<string, number[]>();
  for (const s of saleFacts(state)) {
    if (s.day < first || s.day >= today) continue;
    for (const l of s.lines) {
      const row = totals.get(l.item) ?? Array(7).fill(0);
      row[weekdayOf(s.day)] += l.qty;
      totals.set(l.item, row);
    }
  }
  return (item: string) => (totals.get(item) ?? Array(7).fill(0)).map((q) => q / weeks);
}

export function lowStockForecast(
  state: State,
  options: { item?: string; now?: number; horizonDays?: number } = {},
) {
  const now = options.now ?? Date.now();
  const tz = state.shop.timezone;
  const today = dayKey(now, tz);
  const horizon = options.horizonDays ?? 14;
  const demand = weekdayDemand(state, now);
  const soldToday = new Map<string, number>();
  for (const s of saleFacts(state))
    if (s.day === today)
      for (const l of s.lines) soldToday.set(l.item, (soldToday.get(l.item) ?? 0) + l.qty);
  const rows = state.items
    .filter((i) => !options.item || i.id === options.item)
    .map((item) => {
      const perDay = demand(item.id);
      const weekly = sum(perDay);
      let stock = item.stock,
        days = 0,
        runsOut: string | undefined;
      // remainder of today
      const leftToday = Math.max(0, perDay[weekdayOf(today)] - (soldToday.get(item.id) ?? 0));
      if (stock <= 0) runsOut = today;
      else if (leftToday >= stock) {
        runsOut = today;
        days = stock / leftToday;
      } else {
        stock -= leftToday;
        days = leftToday && perDay[weekdayOf(today)] ? leftToday / perDay[weekdayOf(today)] : 0;
        for (let d = 1; d <= horizon && weekly > 0; d++) {
          const key = addDays(today, d);
          const need = perDay[weekdayOf(key)];
          if (need >= stock) {
            runsOut = key;
            days += need ? stock / need : 0;
            break;
          }
          stock -= need;
          days += 1;
        }
      }
      const daysLeft = runsOut ? Math.round(days * 10) / 10 : null;
      const low = runsOut !== undefined && (daysLeft ?? 0) <= item.leadDays + 1;
      return {
        name: item.name,
        unit: item.unit,
        stock: item.stock,
        stockText: quantityText(item.stock, item.unit),
        averagePerDay: Math.round(weekly / 7),
        averagePerDayText: quantityText(Math.round(weekly / 7), item.unit),
        daysLeft,
        runsOutOn: runsOut,
        runsOutLabel: runsOut ? (runsOut === today ? "today" : weekdayName(runsOut)) : undefined,
        leadDays: item.leadDays,
        low,
        orderBy: runsOut
          ? addDays(runsOut, -item.leadDays) <= today
            ? "today"
            : weekdayName(addDays(runsOut, -item.leadDays))
          : undefined,
      };
    })
    .sort((a, b) => (a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9));
  const low = rows.filter((r) => r.low);
  const describe = (r: (typeof rows)[number]) =>
    r.stock <= 0
      ? `${r.name} is out of stock`
      : r.runsOutOn === today
      ? `${r.name} (${r.stockText} left) will run out today`
      : `${r.name} (${r.stockText}) lasts about ${r.daysLeft} day${r.daysLeft === 1 ? "" : "s"}, until ${r.runsOutLabel}`;
  let say: string;
  if (options.item && rows[0]) {
    const r = rows[0];
    say = r.runsOutOn
      ? `${describe(r)}.${r.low ? ` Order ${r.orderBy} — the supplier takes ${r.leadDays} day${r.leadDays === 1 ? "" : "s"}.` : ""}`
      : `${r.name}: ${r.stockText} in stock, enough for more than ${horizon} days.`;
  } else
    say = low.length
      ? `Running low: ${low.slice(0, 4).map(describe).join("; ")}.${low.some((r) => r.orderBy === "today") ? ` Order ${low.filter((r) => r.orderBy === "today").map((r) => r.name).join(" and ")} today.` : ""}`
      : "Nothing is running low. Everything lasts beyond its supplier lead time.";
  return {
    method: "Day-of-week average of the last 4 weeks, projected forward from current stock.",
    items: rows,
    low: low.map((r) => r.name),
    chart: {
      type: "bar",
      title: "Days of stock left",
      unit: "days",
      labels: rows.slice(0, 8).map((r) => r.name),
      values: rows.slice(0, 8).map((r) => r.daysLeft ?? horizon),
      highlight: rows.slice(0, 8).flatMap((r, i) => (r.low ? [i] : [])),
    } satisfies Chart,
    say,
  };
}

export function deadStock(state: State, options: { days?: number; now?: number } = {}) {
  const now = options.now ?? Date.now();
  const days = options.days ?? 21;
  const tz = state.shop.timezone;
  const since = addDays(dayKey(now, tz), -days);
  const last = new Map<string, string>();
  for (const s of saleFacts(state)) for (const l of s.lines) last.set(l.item, s.day);
  const rows = state.items
    .filter((i) => i.stock > 0 && (last.get(i.id) ?? "0000") < since)
    .map((i) => ({
      name: i.name,
      stockText: quantityText(i.stock, i.unit),
      lastSold: last.get(i.id) ?? null,
      tiedUp: i.cost === null ? null : Math.round((i.cost * i.stock) / 1000),
    }))
    .sort((a, b) => (b.tiedUp ?? 0) - (a.tiedUp ?? 0));
  const total = sum(rows.map((r) => r.tiedUp ?? 0));
  return {
    days,
    items: rows,
    tiedUp: total,
    say: rows.length
      ? `${rows.length} item${rows.length === 1 ? " hasn't" : "s haven't"} sold in ${days} days: ${rows
          .map((r) => `${r.name} (${r.stockText}${r.tiedUp ? `, ${rupees(r.tiedUp)}` : ""}${r.lastSold ? "" : ", never sold"})`)
          .join(", ")}. That's ${rupees(total)} tied up.`
      : `Everything has sold at least once in the last ${days} days.`,
  };
}

// ---------------------------------------------------------------- credit

export function creditRisk(state: State, options: { now?: number } = {}) {
  const now = options.now ?? Date.now();
  const sales = saleFacts(state);
  const payments = paymentFacts(state);
  const recent = now - 14 * DAY;
  const rows = state.customers
    .filter((c) => c.balance > 0)
    .map((c) => {
      const open = state.receivables.filter(
        (r) => r.customer === c.name && r.amount - r.received > 0,
      );
      const oldest = open.reduce((m, r) => (r.at < m ? r.at : m), new Date(now).toISOString());
      const oldestDays = Math.floor((now - Date.parse(oldest)) / DAY);
      const given14 = sum(
        sales.filter((s) => s.customer === c.name && Date.parse(s.at) >= recent).map((s) => s.total - s.paid),
      );
      const paid14 = sum(
        payments.filter((p) => p.customer === c.name && Date.parse(p.at) >= recent).map((p) => p.amount),
      );
      const lastPayment = payments.filter((p) => p.customer === c.name).at(-1);
      const daysSincePayment = lastPayment
        ? Math.floor((now - Date.parse(lastPayment.at)) / DAY)
        : null;
      const growing = given14 > paid14;
      const silent = daysSincePayment === null || daysSincePayment > 14;
      const risk =
        (growing && silent && c.balance >= 30000) || oldestDays > 30
          ? "high"
          : (growing && given14 > 2 * paid14 && c.balance >= 20000) || oldestDays > 14
            ? "medium"
            : "low";
      return {
        name: c.name,
        balance: c.balance,
        balanceText: rupees(c.balance),
        oldestUnpaidDays: oldestDays,
        creditLast14Days: given14,
        paidLast14Days: paid14,
        daysSincePayment,
        risk,
        why:
          risk === "low"
            ? "pays regularly"
            : [
                growing ? `owes ${rupees(given14 - paid14)} more than two weeks ago` : "",
                silent
                  ? daysSincePayment === null
                    ? "has never paid"
                    : `last paid ${daysSincePayment} days ago`
                  : "",
                oldestDays > 14 ? `oldest unpaid bill is ${oldestDays} days old` : "",
              ]
                .filter(Boolean)
                .join(", "),
      };
    })
    .sort((a, b) => ["high", "medium", "low"].indexOf(a.risk) - ["high", "medium", "low"].indexOf(b.risk) || b.balance - a.balance);
  const flagged = rows.filter((r) => r.risk !== "low");
  return {
    customers: rows,
    chart: {
      type: "bar",
      title: "Oldest unpaid bill (days)",
      unit: "days",
      labels: rows.map((r) => r.name),
      values: rows.map((r) => r.oldestUnpaidDays),
      highlight: rows.flatMap((r, i) => (r.risk === "high" ? [i] : [])),
    } satisfies Chart,
    say: flagged.length
      ? flagged
          .slice(0, 3)
          .map((r) => `${r.name} is a ${r.risk} risk: owes ${r.balanceText}, ${r.why}`)
          .join(". ") + "."
      : rows.length
        ? "No one looks risky. Everyone with a balance is paying regularly."
        : "No one owes you money.",
  };
}

// ---------------------------------------------------------------- reports / charts

export function salesReport(
  state: State,
  options: { days?: number; by?: "day" | "item" | "weekday" | "customer"; now?: number } = {},
) {
  const now = options.now ?? Date.now();
  const tz = state.shop.timezone;
  const days = Math.min(Math.max(options.days ?? 28, 1), 120);
  const by = options.by ?? "day";
  const today = dayKey(now, tz);
  const first = addDays(today, -(days - 1));
  const sales = saleFacts(state).filter((s) => s.day >= first && s.day <= today);
  const total = sum(sales.map((s) => s.total));
  let labels: string[] = [],
    values: number[] = [];
  if (by === "day") {
    labels = Array.from({ length: days }, (_, i) => addDays(first, i));
    values = labels.map((d) => sum(sales.filter((s) => s.day === d).map((s) => s.total)));
    labels = labels.map((d) => d.slice(5));
  } else if (by === "weekday") {
    const order = [1, 2, 3, 4, 5, 6, 0];
    const counts = Array(7).fill(0),
      totals = Array(7).fill(0);
    for (let i = 0; i < days; i++) counts[weekdayOf(addDays(first, i))]++;
    for (const s of sales) totals[weekdayOf(s.day)] += s.total;
    labels = order.map((d) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]);
    values = order.map((d) => (counts[d] ? Math.round(totals[d] / counts[d]) : 0));
  } else {
    const m = new Map<string, number>();
    for (const s of sales)
      if (by === "item") for (const l of s.lines) m.set(l.name, (m.get(l.name) ?? 0) + l.total);
      else m.set(s.customer ?? "Walk-in", (m.get(s.customer ?? "Walk-in") ?? 0) + s.total);
    const rows = [...m].sort((a, b) => b[1] - a[1]).slice(0, 12);
    labels = rows.map((r) => r[0]);
    values = rows.map((r) => r[1]);
  }
  const bestIndex = values.indexOf(Math.max(...values));
  const title =
    by === "day"
      ? `Sales per day, last ${days} days`
      : by === "weekday"
        ? `Average sales by weekday, last ${days} days`
        : `Sales by ${by}, last ${days} days`;
  const say =
    `Last ${days} days: ${rupees(total)} in sales.` +
    (labels.length && values[bestIndex] > 0
      ? by === "day"
        ? ` Best day was ${dayLabel(addDays(first, bestIndex))} at ${rupees(values[bestIndex])}.`
        : by === "weekday"
          ? ` ${labels[bestIndex]} is your best day, averaging ${roundRupees(values[bestIndex])}.`
          : ` Biggest: ${labels[bestIndex]} with ${rupees(values[bestIndex])}.`
      : "");
  return {
    from: first,
    to: today,
    by,
    total,
    chart: {
      type: by === "day" ? "line" : "bar",
      title,
      unit: "₹",
      labels,
      values: values.map((v) => v / 100),
    } satisfies Chart,
    say,
  };
}
