import { planRestock } from "../../analytics/src/restock-plan";
import type { Constraints } from "../../contracts/src/planning";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../../db/src/database";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { resolveName } from "./names";

const integer = z.number().int().nonnegative().max(100_000_000);
const isoDate = z.iso.datetime({ offset: true });
/** Sales may be back-dated ("yesterday I sold…") but never dated in the future. */
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

const itemSchema = z.object({
  name: z.string().trim().min(1).max(80),
  unit: z.enum(["kg", "packet", "piece"]),
  stock: integer,
  price: integer.positive(),
  cost: integer.positive().nullable().default(null),
  pack: integer.positive().default(1000),
  leadDays: integer.max(30).default(1),
  aliases: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
});
export type Item = z.infer<typeof itemSchema> & { id: string };
export type Event = {
  id: string;
  kind: string;
  data: any;
  at: string;
  version: number;
};
export type Receivable = {
  id: string;
  /** Every receipt id this debt has had (original sale + corrections). */
  ids: string[];
  customer: string;
  amount: number;
  received: number;
  at: string;
};
export type State = {
  shop: { name: string; currency: "INR"; timezone: "UTC" | "Asia/Kolkata" };
  version: number;
  items: Item[];
  customers: { name: string; balance: number }[];
  events: Event[];
  drafts: any[];
  receivables: Receivable[];
  revenue: number;
  cash: number;
};

export function emptyState(): State {
  return {
    version: 0,
    shop: { name: "Synthetic Corner Shop", currency: "INR", timezone: "UTC" },
    items: [],
    customers: [],
    events: [],
    drafts: [],
    receivables: [],
    revenue: 0,
    cash: 0,
  };
}

const debtFor = (state: State, id: string) =>
  state.receivables.find((r) => r.id === id || r.ids.includes(id));

/** The current version of a sale (or payment) chain: not yet superseded by a correction. */
export function latestReceipt(state: State, kinds: string[]) {
  const superseded = new Set(
    state.events
      .filter((e) => e.kind === "correct_entry" || e.kind === "correct_payment")
      .map((e) => e.data.original.id),
  );
  return [...state.events]
    .reverse()
    .find((e) => kinds.includes(e.kind) && !superseded.has(e.id));
}
export const SALE_KINDS = ["record_sale", "correct_entry"];
export const PAYMENT_KINDS = ["record_payment", "correct_payment"];

/** The sale data a sale-chain event currently stands for. */
export const saleData = (e: Event) =>
  e.kind === "correct_entry" ? e.data.replacement : e.data;

export function applyEvent(state: State, e: Event) {
  const d = e.data;
  const item = (id: string) => state.items.find((i) => i.id === id)!;
  const customer = (name: string) =>
    state.customers.find((c) => c.name === name)!;
  state.events.push(e);
  state.version = e.version;
  switch (e.kind) {
    case "configure_shop":
      state.shop = d;
      break;
    case "add_item":
      state.items.push({ aliases: [], ...d, id: e.id });
      break;
    case "add_customer":
      state.customers.push({ name: d.name, balance: d.balance });
      state.receivables.push({
        id: e.id,
        ids: [e.id],
        customer: d.name,
        amount: d.balance,
        received: 0,
        at: e.at,
      });
      break;
    case "save_order_draft":
      state.drafts.push({
        ...d.snapshot,
        id: e.id,
        status: "unsent",
        lines: d.snapshot.lines.map((line: any) => ({
          ...line,
          remaining: line.qty,
        })),
      });
      break;
    case "cancel_order_draft":
      state.drafts.find((draft) => draft.id === d.draft)!.status = "cancelled";
      break;
    case "receive_order": {
      const draft = state.drafts.find((draft) => draft.id === d.draft)!;
      for (const line of d.lines) {
        draft.lines.find((l: any) => l.item === line.item).remaining -=
          line.qty;
        item(line.item).stock += line.qty;
        item(line.item).cost = line.price;
      }
      if (draft.lines.every((l: any) => l.remaining === 0))
        draft.status = "received";
      break;
    }
    case "set_price":
      Object.assign(item(d.item), { price: d.price, cost: d.cost });
      break;
    case "record_purchase":
      for (const line of d.lines) {
        item(line.item).stock += line.qty;
        item(line.item).cost = line.price;
      }
      break;
    case "record_sale":
      for (const line of d.lines) item(line.item).stock -= line.qty;
      state.revenue += d.total;
      state.cash += d.paid;
      if (d.customer) {
        customer(d.customer).balance += d.total - d.paid;
        state.receivables.push({
          id: e.id,
          ids: [e.id],
          customer: d.customer,
          amount: d.total - d.paid,
          received: 0,
          at: d.effectiveAt ?? e.at,
        });
      }
      break;
    case "correct_entry": {
      const original = d.original.data,
        replacement = d.replacement;
      for (const line of original.lines) item(line.item).stock += line.qty;
      for (const line of replacement.lines) item(line.item).stock -= line.qty;
      state.revenue += replacement.total - original.total;
      state.cash += replacement.paid - original.paid;
      if (original.customer)
        customer(original.customer).balance -= original.total - original.paid;
      if (replacement.customer)
        customer(replacement.customer).balance +=
          replacement.total - replacement.paid;
      const debt = debtFor(state, d.original.id);
      if (debt) {
        debt.id = e.id;
        debt.ids.push(e.id);
        if (replacement.customer) {
          debt.customer = replacement.customer;
          debt.amount = replacement.total - replacement.paid;
        } else debt.amount = debt.received;
      } else if (replacement.customer)
        state.receivables.push({
          id: e.id,
          ids: [d.original.id, e.id],
          customer: replacement.customer,
          amount: replacement.total - replacement.paid,
          received: 0,
          at: replacement.effectiveAt ?? e.at,
        });
      break;
    }
    case "record_payment":
      customer(d.customer).balance -= d.amount;
      state.cash += d.amount;
      for (const allocation of d.allocations ?? [])
        debtFor(state, allocation.receipt)!.received += allocation.amount;
      break;
    case "correct_payment": {
      const original = d.original.data;
      customer(original.customer).balance += original.amount - d.amount;
      state.cash += d.amount - original.amount;
      for (const a of original.allocations ?? [])
        debtFor(state, a.receipt)!.received -= a.amount;
      for (const a of d.allocations) debtFor(state, a.receipt)!.received += a.amount;
      break;
    }
  }
}

function checkDate(value: string | undefined, what: string) {
  if (value === undefined) return undefined;
  const when = Date.parse(value);
  if (Number.isNaN(when)) throw Error(`Invalid date for ${what}`);
  if (when > Date.now() + FUTURE_TOLERANCE_MS)
    throw Error(`Can't record a ${what} in the future.`);
  return value;
}

export function quantityText(qty: number, unit: string) {
  const n = qty / 1000;
  const shown = Number.isInteger(n) ? String(n) : String(+n.toFixed(3));
  if (unit === "kg") return `${shown} kg`;
  return `${shown} ${unit}${n === 1 ? "" : "s"}`;
}

export class Ledger {
  db: DatabaseSync;
  private cache = new Map<string, State>();
  constructor(path: string) {
    this.db = openDatabase(path);
  }
  session(hours = 24) {
    const token = randomUUID();
    this.db
      .prepare("INSERT INTO sessions VALUES(?,?,?)")
      .run(token, randomUUID(), Date.now() + hours * 3600000);
    return token;
  }
  /**
   * Make sure a long-lived token (e.g. the Alexa+ connector secret) maps to a
   * shop. Returns true when a new, empty shop was created.
   */
  ensureSession(token: string, days = 3650) {
    const row = this.db
      .prepare("SELECT shop FROM sessions WHERE token=?")
      .get(token) as any;
    const expires = Date.now() + days * 86400000;
    if (row) {
      this.db
        .prepare("UPDATE sessions SET expires=? WHERE token=?")
        .run(expires, token);
      return false;
    }
    this.db
      .prepare("INSERT INTO sessions VALUES(?,?,?)")
      .run(token, randomUUID(), expires);
    return true;
  }
  scope(token: string) {
    const row = this.db
      .prepare("SELECT shop FROM sessions WHERE token=? AND expires>?")
      .get(token, Date.now()) as any;
    if (!row) throw Error("Unauthorized or expired session");
    return row.shop as string;
  }
  /** Replays the shop's immutable events. Cached and extended incrementally. */
  state(token: string): State {
    const shop = this.scope(token);
    const state = this.cache.get(shop) ?? emptyState();
    const rows = this.db
      .prepare(
        "SELECT id,kind,data,at,version FROM events WHERE shop=? AND version>? ORDER BY version",
      )
      .all(shop, state.version) as any[];
    for (const r of rows) applyEvent(state, { ...r, data: JSON.parse(r.data) });
    this.cache.set(shop, state);
    return structuredClone(state);
  }
  private item(state: State, ref: string) {
    return resolveName(state.items, ref, "item");
  }
  private customer(state: State, ref: string) {
    return resolveName(state.customers, ref, "customer").name;
  }
  /** Price sale lines at current catalogue prices; merges repeated items. */
  private priceLines(state: State, input: { item: string; qty: number }[]) {
    const merged = new Map<string, number>();
    for (const line of input) {
      const item = this.item(state, line.item);
      merged.set(item.id, (merged.get(item.id) ?? 0) + line.qty);
    }
    const lines = [...merged].map(([id, qty]) => {
      const item = state.items.find((i) => i.id === id)!;
      if (item.unit !== "kg" && qty % 1000)
        throw Error(`${item.name} is sold in whole ${item.unit}s.`);
      if (qty > item.stock)
        throw Error(
          `Only ${quantityText(item.stock, item.unit)} of ${item.name} in stock.`,
        );
      const product = BigInt(item.price) * BigInt(qty);
      if (product % 1000n)
        throw Error(
          `That quantity of ${item.name} gives a fraction of a paisa; use a rounder quantity.`,
        );
      return { item: id, qty, price: item.price, total: Number(product / 1000n) };
    });
    const total = lines.reduce((sum, l) => sum + l.total, 0);
    if (!Number.isSafeInteger(total) || total > 100_000_000)
      throw Error("Financial transaction limit exceeded");
    return { lines, total };
  }
  private allocate(state: State, customer: string, amount: number) {
    let remaining = amount;
    const allocations: { receipt: string; amount: number }[] = [];
    for (const debt of state.receivables
      .filter((r) => r.customer === customer)
      .sort((a, b) => a.at.localeCompare(b.at))) {
      const part = Math.min(remaining, debt.amount - debt.received);
      if (part > 0) {
        allocations.push({ receipt: debt.id, amount: part });
        remaining -= part;
      }
    }
    if (remaining) throw Error("Receivables do not reconcile");
    return allocations;
  }
  validate(kind: string, data: any, state: State, token?: string): any {
    if (kind === "configure_shop")
      return z
        .object({
          name: z.string().trim().min(1).max(80),
          currency: z.literal("INR"),
          timezone: z.enum(["UTC", "Asia/Kolkata"]),
        })
        .strict()
        .parse(data);
    if (kind === "add_item") {
      const d = itemSchema.parse(data);
      if (d.unit !== "kg" && (d.stock % 1000 || d.pack % 1000))
        throw Error("Whole stock and packs required for pieces/packets");
      if (
        state.items.some((i) => i.name.toLowerCase() === d.name.toLowerCase())
      )
        throw Error(`${d.name} is already in the catalogue.`);
      return d;
    }
    if (kind === "add_customer") {
      const d = z
        .object({
          name: z.string().trim().min(1).max(80),
          balance: integer.default(0),
        })
        .parse(data);
      if (
        state.customers.some(
          (c) => c.name.toLowerCase() === d.name.toLowerCase(),
        )
      )
        throw Error(`${d.name} is already a customer.`);
      return d;
    }
    if (kind === "record_sale") {
      const d = z
        .object({
          customer: z.string().nullable().optional(),
          lines: z
            .array(z.object({ item: z.string(), qty: integer.positive() }))
            .min(1)
            .max(30),
          paid: integer.optional(),
          effectiveAt: isoDate.optional(),
        })
        .parse(data);
      const customer = d.customer ? this.customer(state, d.customer) : null;
      const { lines, total } = this.priceLines(state, d.lines);
      const paid = d.paid ?? (customer ? 0 : total);
      if (paid > total)
        throw Error(
          `Paid amount is more than the ₹${total / 100} bill; overpayment isn't supported.`,
        );
      if (!customer && paid !== total)
        throw Error("Credit requires customer: whose credit is this?");
      const effectiveAt = checkDate(d.effectiveAt, "sale");
      return {
        customer,
        lines,
        paid,
        total,
        ...(effectiveAt ? { effectiveAt } : {}),
      };
    }
    if (kind === "record_payment") {
      const d = z
        .object({
          customer: z.string(),
          amount: integer.positive(),
          effectiveAt: isoDate.optional(),
        })
        .parse(data);
      const name = this.customer(state, d.customer);
      const balance = state.customers.find((c) => c.name === name)!.balance;
      if (d.amount > balance)
        throw Error(
          balance
            ? `Overpayment is unsupported: ${name} only owes ₹${balance / 100}.`
            : `Overpayment is unsupported: ${name} owes nothing.`,
        );
      const effectiveAt = checkDate(d.effectiveAt, "payment");
      return {
        customer: name,
        amount: d.amount,
        allocations: this.allocate(state, name, d.amount),
        ...(effectiveAt ? { effectiveAt } : {}),
      };
    }
    if (kind === "correct_entry") {
      const input = z
        .object({
          receipt: z.string().optional(),
          lines: z
            .array(z.object({ item: z.string(), qty: integer.positive() }))
            .max(30)
            .optional(),
          customer: z.string().nullable().optional(),
          paid: integer.optional(),
        })
        .parse(data);
      const originalEvent = input.receipt
        ? state.events.find(
            (e) => e.id === input.receipt && SALE_KINDS.includes(e.kind),
          )
        : latestReceipt(state, SALE_KINDS);
      if (!originalEvent)
        throw Error(input.receipt ? "Sale receipt not found" : "No sale to correct yet.");
      if (
        state.events.some(
          (e) => e.kind === "correct_entry" && e.data.original.id === originalEvent.id,
        )
      )
        throw Error("Receipt already corrected; correct the latest version.");
      const original = { id: originalEvent.id, data: saleData(originalEvent) };
      // Put the original back: stock returns and its historical prices apply.
      const restored = structuredClone(state);
      for (const line of original.data.lines) {
        const item = restored.items.find((i) => i.id === line.item)!;
        item.stock += line.qty;
        item.price = line.price;
      }
      const customer =
        input.customer === undefined
          ? original.data.customer
          : input.customer === null
            ? null
            : this.customer(state, input.customer);
      const requested =
        input.lines ??
        original.data.lines.map((l: any) => ({ item: l.item, qty: l.qty }));
      const { lines, total } = requested.length
        ? this.priceLines(restored, requested)
        : { lines: [], total: 0 };
      const paid =
        input.paid ?? (customer ? Math.min(original.data.paid, total) : total);
      if (paid > total)
        throw Error(
          `Paid amount is more than the corrected ₹${total / 100} bill.`,
        );
      if (!customer && paid !== total)
        throw Error("Credit requires customer: whose credit is this?");
      const debt = debtFor(state, original.id);
      if (debt && debt.received > 0) {
        if (customer !== original.data.customer)
          throw Error(
            `${original.data.customer} has already repaid part of this sale, so it can't be moved to someone else. Correction requires refund after repayment; unsupported.`,
          );
        if (total - paid < debt.received)
          throw Error(
            "Correction requires refund after repayment; unsupported: the customer already repaid more than the corrected credit.",
          );
      }
      const effectiveAt = original.data.effectiveAt ?? originalEvent.at;
      const replacement = { customer, lines, paid, total, effectiveAt };
      return {
        receipt: original.id,
        original,
        replacement,
        cashDelta: paid - original.data.paid,
      };
    }
    if (kind === "correct_payment") {
      const input = z
        .object({ receipt: z.string().optional(), amount: integer })
        .parse(data);
      const originalEvent = input.receipt
        ? state.events.find(
            (e) => e.id === input.receipt && PAYMENT_KINDS.includes(e.kind),
          )
        : latestReceipt(state, PAYMENT_KINDS);
      if (!originalEvent)
        throw Error(input.receipt ? "Payment receipt not found" : "No payment to correct yet.");
      if (
        state.events.some(
          (e) => e.kind === "correct_payment" && e.data.original.id === originalEvent.id,
        )
      )
        throw Error("Payment already corrected; correct the latest version.");
      const originalData =
        originalEvent.kind === "correct_payment"
          ? {
              customer: originalEvent.data.customer,
              amount: originalEvent.data.amount,
              allocations: originalEvent.data.allocations,
            }
          : originalEvent.data;
      const restored = structuredClone(state);
      restored.customers.find((c) => c.name === originalData.customer)!.balance +=
        originalData.amount;
      for (const a of originalData.allocations ?? [])
        debtFor(restored, a.receipt)!.received -= a.amount;
      const balance = restored.customers.find(
        (c) => c.name === originalData.customer,
      )!.balance;
      if (input.amount > balance)
        throw Error(
          `Overpayment is unsupported: ${originalData.customer} only owed ₹${balance / 100}.`,
        );
      return {
        receipt: originalEvent.id,
        original: { id: originalEvent.id, data: originalData },
        customer: originalData.customer,
        amount: input.amount,
        allocations: this.allocate(restored, originalData.customer, input.amount),
      };
    }
    if (kind === "set_price") {
      const d = z
        .object({
          item: z.string(),
          price: integer.positive(),
          cost: integer.positive().nullable().optional(),
        })
        .parse(data);
      const item = this.item(state, d.item);
      return {
        item: item.id,
        price: d.price,
        cost: d.cost === undefined ? item.cost : d.cost,
      };
    }
    if (kind === "record_purchase") {
      const d = z
        .object({
          lines: z
            .array(
              z.object({
                item: z.string(),
                qty: integer.positive(),
                price: integer.positive(),
              }),
            )
            .min(1)
            .max(30),
          effectiveAt: isoDate.optional(),
        })
        .parse(data);
      const seen = new Set();
      const lines = d.lines.map((line) => {
        const item = this.item(state, line.item);
        if (seen.has(item.id)) throw Error(`${item.name} is listed twice.`);
        seen.add(item.id);
        if (item.unit !== "kg" && line.qty % 1000)
          throw Error(`${item.name} comes in whole ${item.unit}s.`);
        const product = BigInt(line.price) * BigInt(line.qty);
        if (product % 1000n) throw Error("Fractional paise not supported");
        if (item.stock + line.qty > 100_000_000) throw Error("Stock limit");
        return {
          item: item.id,
          qty: line.qty,
          price: line.price,
          total: Number(product / 1000n),
        };
      });
      const total = lines.reduce((sum, l) => sum + l.total, 0);
      if (!Number.isSafeInteger(total) || total > 100_000_000)
        throw Error("Financial transaction limit exceeded");
      const effectiveAt = checkDate(d.effectiveAt, "purchase");
      return { lines, total, ...(effectiveAt ? { effectiveAt } : {}) };
    }
    if (kind === "save_order_draft") {
      const d = z.object({ plan: z.string() }).parse(data);
      if (!token) throw Error("Unauthorized");
      const snapshot = this.scenario(token, d.plan);
      if (snapshot.version !== state.version)
        throw Error("Scenario stale; recompute the plan first.");
      if (!snapshot.lines.length) throw Error("No stock to order");
      if (
        state.events.some(
          (e) => e.kind === "save_order_draft" && e.data.plan === d.plan,
        )
      )
        throw Error("Plan already saved");
      return { plan: d.plan, snapshot };
    }
    const activeDraft = (id?: string) => {
      const draft = id
        ? state.drafts.find((x) => x.id === id && x.status === "unsent")
        : [...state.drafts].reverse().find((x) => x.status === "unsent");
      if (!draft) throw Error("Active draft not found");
      return draft;
    };
    if (kind === "cancel_order_draft") {
      const d = z.object({ draft: z.string().optional() }).parse(data);
      return { draft: activeDraft(d.draft).id };
    }
    if (kind === "receive_order") {
      const d = z
        .object({
          draft: z.string().optional(),
          lines: z
            .array(
              z.object({
                item: z.string(),
                qty: integer.positive(),
                price: integer.positive(),
              }),
            )
            .min(1),
          purchaseId: z.string().optional(),
        })
        .parse(data);
      const draft = activeDraft(d.draft);
      const lines = d.lines.map((line) => ({
        ...line,
        item: this.item(state, line.item).id,
      }));
      for (const line of lines) {
        const outstanding = draft.lines.find(
          (l: any) => l.item === line.item,
        )?.remaining;
        if (outstanding === undefined || line.qty > outstanding)
          throw Error("Quantity exceeds outstanding order");
      }
      const purchase = this.validate("record_purchase", { lines }, state);
      return {
        draft: draft.id,
        ...purchase,
        purchaseId: d.purchaseId ?? randomUUID(),
      };
    }
    throw Error("Unsupported action");
  }
  plan(token: string, constraints: Constraints, previous?: string) {
    const plan = { ...planRestock(this.state(token), constraints), previous };
    this.db
      .prepare("INSERT INTO scenarios VALUES(?,?,?)")
      .run(plan.id, token, JSON.stringify(plan));
    return plan;
  }
  scenario(token: string, id: string) {
    this.scope(token);
    const row = this.db
      .prepare("SELECT data FROM scenarios WHERE id=? AND token=?")
      .get(id, token) as any;
    if (!row) throw Error("Scenario not found");
    return JSON.parse(row.data);
  }
  revise(token: string, id: string, changes: Partial<Constraints>) {
    const old = this.scenario(token, id);
    return this.plan(token, { ...old.constraints, ...changes }, id);
  }
  preview(token: string, kind: string, data: any) {
    const state = this.state(token);
    const payload = this.validate(kind, data, state, token);
    const id = randomUUID(),
      serialized = JSON.stringify(payload);
    this.db
      .prepare("INSERT INTO operations VALUES(?,?,?,?,?,?,?,?,NULL)")
      .run(
        id,
        token,
        this.scope(token),
        state.version,
        kind,
        serialized,
        createHash("sha256").update(serialized).digest("hex"),
        Date.now() + 300000,
      );
    return {
      id,
      kind,
      data: payload,
      version: state.version,
      expires: Date.now() + 300000,
    };
  }
  discard(token: string, id: string) {
    this.scope(token);
    const row = this.db
      .prepare("SELECT result FROM operations WHERE id=? AND token=?")
      .get(id, token) as any;
    if (!row) throw Error("Operation not found in this session");
    if (row.result) throw Error("Operation already committed; use correction");
    this.db
      .prepare("UPDATE operations SET expires=0 WHERE id=? AND token=?")
      .run(id, token);
    return { id, cancelled: true };
  }
  /**
   * Commit a previewed operation. Unrelated entries in between are fine: the
   * payload is re-validated against the current ledger and must come out
   * byte-identical (same prices, totals, allocations), otherwise the owner
   * has to look at a fresh preview.
   */
  confirm(token: string, id: string) {
    const shop = this.scope(token);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const op = this.db
        .prepare("SELECT * FROM operations WHERE id=? AND token=? AND shop=?")
        .get(id, token, shop) as any;
      if (!op) throw Error("Operation not found in this session");
      if (op.result) {
        this.db.exec("COMMIT");
        return JSON.parse(op.result);
      }
      if (op.expires < Date.now()) throw Error("Confirmation expired");
      if (createHash("sha256").update(op.data).digest("hex") !== op.hash)
        throw Error("Payload mismatch");
      const state = this.state(token);
      const data = JSON.parse(op.data);
      if (state.version !== op.version) {
        let fresh;
        try {
          fresh = this.validate(op.kind, data, state, token);
        } catch (e) {
          throw Error(
            `State changed since the preview: ${(e as Error).message} Preview again.`,
          );
        }
        if (JSON.stringify(fresh) !== op.data)
          throw Error(
            "State changed since the preview (prices, stock or balances moved). Preview again.",
          );
      } else this.validate(op.kind, data, state, token);
      const receipt = {
        id: randomUUID(),
        kind: op.kind,
        data,
        at: new Date().toISOString(),
        version: state.version + 1,
      };
      this.db
        .prepare("INSERT INTO events VALUES(?,?,?,?,?,?)")
        .run(
          receipt.id,
          shop,
          receipt.kind,
          JSON.stringify(data),
          receipt.at,
          receipt.version,
        );
      this.db
        .prepare("UPDATE operations SET result=? WHERE id=?")
        .run(JSON.stringify(receipt), id);
      this.db.exec("COMMIT");
      return receipt;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}
