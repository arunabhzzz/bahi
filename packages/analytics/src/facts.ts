import {
  type Event,
  type State,
  SALE_KINDS,
  PAYMENT_KINDS,
  saleData,
  quantityText,
} from "../../domain/src/ledger";

export type Tz = State["shop"]["timezone"];
export const DAY = 86400000;
export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** Calendar day (YYYY-MM-DD) of an instant in the shop's timezone. */
export function dayKey(value: string | number | Date, tz: Tz) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}
export function addDays(key: string, days: number) {
  const d = new Date(key + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export const weekdayOf = (key: string) =>
  new Date(key + "T12:00:00Z").getUTCDay();
export const weekdayName = (key: string) => WEEKDAYS[weekdayOf(key)];
export function dayLabel(key: string) {
  const d = new Date(key + "T12:00:00Z");
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })}`;
}
export function timeLabel(value: string, tz: Tz) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(new Date(value));
}

const HINDI_DAYS: Record<string, number> = {
  ravivar: 0,
  somvar: 1,
  mangalvar: 2,
  mangalwar: 2,
  budhvar: 3,
  budhwar: 3,
  guruvar: 4,
  guruwar: 4,
  shukravar: 5,
  shukrawar: 5,
  shanivar: 6,
  shaniwar: 6,
};

/**
 * Turn "today", "yesterday", "tuesday", "last tuesday", "kal" or an ISO date
 * into a shop-local day key. Weekday names mean the most recent such day;
 * with `completedOnly`, today is skipped (asking "why was Tuesday slow?" on a
 * Tuesday means last Tuesday).
 */
export function resolveDay(
  input: string | undefined,
  tz: Tz,
  now = Date.now(),
  completedOnly = false,
) {
  const today = dayKey(now, tz);
  const text = (input ?? "").trim().toLowerCase();
  if (!text) return completedOnly ? addDays(today, -1) : today;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    if (text > today) throw Error("That date is in the future.");
    return text;
  }
  if (text === "today" || text === "aaj") return today;
  if (text === "yesterday" || text === "kal") return addDays(today, -1);
  const word = text.replace(/^(last|previous|pichhle|pichle)\s+/, "").trim();
  let target = WEEKDAYS.findIndex((d) => d.toLowerCase().startsWith(word.slice(0, 3)) && word.length >= 3);
  if (target < 0 && word in HINDI_DAYS) target = HINDI_DAYS[word];
  if (target < 0)
    throw Error(
      `I didn't understand the day "${input}". Say today, yesterday, a weekday or a date like 2026-10-13.`,
    );
  const skipToday = completedOnly || text !== word;
  for (let back = skipToday ? 1 : 0; back <= 7; back++) {
    const key = addDays(today, -back);
    if (weekdayOf(key) === target) return key;
  }
  throw Error("Could not resolve day");
}

export function rupees(paise: number) {
  const value = paise / 100;
  return (
    (paise < 0 ? "-₹" : "₹") +
    Math.abs(value).toLocaleString("en-IN", {
      minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
      maximumFractionDigits: 2,
    })
  );
}
/** Rupees rounded to the nearest rupee, for spoken averages. */
export const roundRupees = (paise: number) => rupees(Math.round(paise / 100) * 100);
export { quantityText };

export type SaleFact = {
  id: string;
  ids: string[];
  at: string;
  day: string;
  customer: string | null;
  lines: { item: string; name: string; unit: string; qty: number; total: number }[];
  total: number;
  paid: number;
};
export type PaymentFact = {
  id: string;
  ids: string[];
  at: string;
  day: string;
  customer: string;
  amount: number;
};

function chains(state: State, kinds: string[]) {
  const superseded = new Set<string>();
  const parent = new Map<string, string>();
  for (const e of state.events)
    if (
      (e.kind === "correct_entry" || e.kind === "correct_payment") &&
      kinds.includes(e.kind)
    ) {
      superseded.add(e.data.original.id);
      parent.set(e.id, e.data.original.id);
    }
  const byId = new Map(state.events.map((e) => [e.id, e]));
  return state.events
    .filter((e) => kinds.includes(e.kind) && !superseded.has(e.id))
    .map((e) => {
      const ids = [e.id];
      let cursor = e.id;
      while (parent.has(cursor)) {
        cursor = parent.get(cursor)!;
        ids.unshift(cursor);
      }
      return { event: e, root: byId.get(ids[0]) as Event, ids };
    });
}

/** Final version of every sale (corrections applied, voided sales dropped). */
export function saleFacts(state: State): SaleFact[] {
  const tz = state.shop.timezone;
  return chains(state, SALE_KINDS)
    .map(({ event, root, ids }) => {
      const d = saleData(event);
      const at = d.effectiveAt ?? root.data.effectiveAt ?? root.at;
      return {
        id: event.id,
        ids,
        at,
        day: dayKey(at, tz),
        customer: d.customer ?? null,
        lines: d.lines.map((l: any) => {
          const item = state.items.find((i) => i.id === l.item)!;
          return {
            item: l.item,
            name: item.name,
            unit: item.unit,
            qty: l.qty,
            total: l.total,
          };
        }),
        total: d.total,
        paid: d.paid,
      };
    })
    .filter((s) => s.lines.length > 0)
    .sort((a, b) => a.at.localeCompare(b.at));
}

export function paymentFacts(state: State): PaymentFact[] {
  const tz = state.shop.timezone;
  return chains(state, PAYMENT_KINDS)
    .map(({ event, root, ids }) => {
      const at = root.data.effectiveAt ?? root.at;
      return {
        id: event.id,
        ids,
        at,
        day: dayKey(at, tz),
        customer: event.data.customer,
        amount: event.data.amount,
      };
    })
    .filter((p) => p.amount > 0)
    .sort((a, b) => a.at.localeCompare(b.at));
}

type Move = { at: string; qty: number };
/**
 * Stock level of each item over time, in effective (business) time. Opening
 * stock counts from the beginning. Returns a lookup for any day.
 */
export function stockTimeline(state: State, sales = saleFacts(state)) {
  const moves = new Map<string, Move[]>();
  const push = (item: string, at: string, qty: number) => {
    if (!moves.has(item)) moves.set(item, []);
    moves.get(item)!.push({ at, qty });
  };
  for (const e of state.events) {
    if (e.kind === "add_item") push(e.id, "0000", e.data.stock);
    if (e.kind === "record_purchase")
      for (const l of e.data.lines) push(l.item, e.data.effectiveAt ?? e.at, l.qty);
    if (e.kind === "receive_order")
      for (const l of e.data.lines) push(l.item, e.at, l.qty);
  }
  for (const s of sales) for (const l of s.lines) push(l.item, s.at, -l.qty);
  for (const list of moves.values())
    list.sort((a, b) => a.at.localeCompare(b.at) || b.qty - a.qty);
  const tz = state.shop.timezone;
  return {
    /** Stock at the start/end of a shop-local day, and when it hit zero. */
    day(item: string, key: string) {
      let level = 0,
        start: number | undefined,
        ranOutAt: string | undefined,
        min = Infinity;
      for (const m of moves.get(item) ?? []) {
        const d = m.at === "0000" ? "0000" : dayKey(m.at, tz);
        if (d > key) break;
        if (d === key && start === undefined) start = level;
        level += m.qty;
        if (d === key) {
          min = Math.min(min, level);
          if (level <= 0 && !ranOutAt) ranOutAt = m.at;
        }
      }
      if (start === undefined) start = level;
      if (start <= 0 && !ranOutAt) ranOutAt = "start";
      return { start, end: level, min: Math.min(min, level, start), ranOutAt };
    },
  };
}
