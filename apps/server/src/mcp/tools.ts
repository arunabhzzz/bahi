/**
 * Bahi's MCP tool surface, written for a voice assistant (Alexa+) to call.
 *
 * Conventions every tool follows:
 *  - Items and customers are passed by the name the shopkeeper said, in any
 *    spelling or language ("cheeni", "Sugar", "ramesh"). The server matches.
 *  - Money is in rupees (52.50), quantities in the item's own unit
 *    (kilos for loose goods, a count for packets and pieces).
 *  - Every result has a short `say` sentence to read aloud.
 *  - Anything that changes the books returns a preview with an `operation`
 *    id. Nothing is saved until `confirm_operation` is called with that id
 *    after the shopkeeper says yes.
 *
 * This module has no MCP SDK dependency so it can be unit-tested directly.
 */
import { z } from "zod";
import {
  type Ledger,
  type State,
  SALE_KINDS,
  PAYMENT_KINDS,
  latestReceipt,
  quantityText,
  saleData,
} from "../../../../packages/domain/src/ledger";
import { resolveName, listNames } from "../../../../packages/domain/src/names";
import { exact } from "../../../../packages/contracts/src/money";
import {
  creditRisk,
  dailySummary,
  deadStock,
  explainSalesChange,
  lowStockForecast,
  salesReport,
} from "../../../../packages/analytics/src/insights";
import {
  dayKey,
  resolveDay,
  rupees,
  saleFacts,
  paymentFacts,
  timeLabel,
  dayLabel,
} from "../../../../packages/analytics/src/facts";

// ------------------------------------------------------------------ schemas

const rupeesIn = (what: string) =>
  z
    .number()
    .nonnegative()
    .max(1_000_000)
    .describe(`${what} in rupees, e.g. 200 or 52.50`);
const itemName = z
  .string()
  .min(1)
  .max(80)
  .describe(
    "Item as the shopkeeper said it, any language or spelling (e.g. 'cheeni', 'sugar', 'chawal'). The server matches it to the catalogue.",
  );
const customerName = z
  .string()
  .min(1)
  .max(80)
  .describe("Customer name as said, e.g. 'Ramesh'. Case and small spelling slips are fine.");
const quantity = z
  .number()
  .positive()
  .max(100_000)
  .describe(
    "Quantity in the item's own unit: kilos for loose goods (0.5 = half a kilo), a count for packets and pieces.",
  );
const unit = z
  .enum(["kg", "g", "packet", "piece", "dozen"])
  .optional()
  .describe("Only if the shopkeeper said a unit. Grams and dozens are converted.");
const dayPhrase = z
  .string()
  .max(40)
  .optional()
  .describe("Day it happened if not today: 'yesterday', a weekday like 'tuesday', or 2026-10-13.");
const saleLine = z.object({ item: itemName, quantity, unit }).strict();

// ------------------------------------------------------------------ helpers

const paise = (n: number) => exact(String(+n.toFixed(6)), 2);

function toMilli(state: State, line: { item: string; quantity: number; unit?: string }) {
  const item = resolveName(state.items, line.item, "item");
  let q = line.quantity;
  const said = line.unit;
  if (said === "g") {
    if (item.unit !== "kg") throw Error(`${item.name} is sold by the ${item.unit}, not by weight.`);
    q = q / 1000;
  } else if (said === "dozen") q = q * 12;
  else if (said && said !== item.unit)
    throw Error(`${item.name} is sold by the ${item.unit}, not by the ${said}.`);
  let milli: number;
  try {
    milli = exact(String(+q.toFixed(6)), 3);
  } catch {
    throw Error(`Quantity for ${item.name} is too precise.`);
  }
  if (item.unit !== "kg" && milli % 1000)
    throw Error(`${item.name} is sold in whole ${item.unit}s.`);
  return { item, qty: milli };
}

function effectiveAt(state: State, phrase?: string) {
  if (!phrase) return undefined;
  const tz = state.shop.timezone;
  const key = resolveDay(phrase, tz);
  if (key === dayKey(Date.now(), tz)) return undefined;
  return new Date(
    Date.parse(`${key}T12:00:00${tz === "UTC" ? "Z" : "+05:30"}`),
  ).toISOString();
}

const itemOf = (state: State, id: string) => state.items.find((i) => i.id === id)!;
const linesText = (state: State, lines: { item: string; qty: number; total?: number }[]) =>
  lines
    .map((l) => {
      const item = itemOf(state, l.item);
      return `${quantityText(l.qty, item.unit)} ${item.name}${l.total !== undefined ? ` ${rupees(l.total)}` : ""}`;
    })
    .join(", ");
const balanceOf = (state: State, name: string) =>
  state.customers.find((c) => c.name === name)?.balance ?? 0;
const he = (name: string) => name;

/** One sentence describing a previewed change, ending in a question. */
export function describePreview(kind: string, d: any, state: State): string {
  switch (kind) {
    case "record_sale": {
      const when = d.effectiveAt ? ` on ${dayLabel(dayKey(d.effectiveAt, state.shop.timezone))}` : "";
      if (!d.customer)
        return `Cash sale${when}: ${linesText(state, d.lines)}. Total ${rupees(d.total)}, paid in full. Shall I record it?`;
      const credit = d.total - d.paid;
      const owes = balanceOf(state, d.customer) + credit;
      return `Sale to ${d.customer}${when}: ${linesText(state, d.lines)}. Total ${rupees(d.total)}${
        credit === 0
          ? ", paid in full"
          : d.paid
            ? `; paid ${rupees(d.paid)}, ${rupees(credit)} on credit`
            : `, all ${rupees(credit)} on credit`
      }${credit ? ` (${he(d.customer)} will owe ${rupees(owes)})` : ""}. Shall I record it?`;
    }
    case "record_payment": {
      const left = balanceOf(state, d.customer) - d.amount;
      return `${d.customer} pays ${rupees(d.amount)}. ${left ? `${d.customer} will still owe ${rupees(left)}` : `That clears ${d.customer}'s balance`}. Shall I record it?`;
    }
    case "correct_entry": {
      const o = d.original.data,
        r = d.replacement;
      const when = timeLabel(d.original.data.effectiveAt ?? state.events.find((e) => e.id === d.receipt)?.at ?? new Date().toISOString(), state.shop.timezone);
      const who = (c: string | null) => (c ? `to ${c}` : "(cash)");
      const before = `${linesText(state, o.lines)} ${who(o.customer)}, ${rupees(o.total)}`;
      if (!r.lines.length)
        return `Cancel the ${when} sale: ${before}.${o.paid ? ` Give back ${rupees(o.paid)} in cash.` : ""}${o.customer && o.total - o.paid ? ` ${o.customer}'s credit goes down ${rupees(o.total - o.paid)}.` : ""} Shall I cancel it?`;
      let money = "";
      if (d.cashDelta < 0) money += ` Give back ${rupees(-d.cashDelta)} in cash.`;
      if (d.cashDelta > 0) money += ` Collect ${rupees(d.cashDelta)} more in cash.`;
      const creditBefore = o.customer ? o.total - o.paid : 0,
        creditAfter = r.customer ? r.total - r.paid : 0;
      if (o.customer === r.customer && o.customer && creditAfter !== creditBefore)
        money += ` ${o.customer}'s credit goes ${creditAfter > creditBefore ? "up" : "down"} ${rupees(Math.abs(creditAfter - creditBefore))}.`;
      if (o.customer !== r.customer) {
        if (o.customer && creditBefore) money += ` ${o.customer}'s credit goes down ${rupees(creditBefore)}.`;
        if (r.customer && creditAfter) money += ` ${r.customer}'s credit goes up ${rupees(creditAfter)}.`;
      }
      return `Change the ${when} sale from ${before} to ${linesText(state, r.lines)} ${who(r.customer)}, ${rupees(r.total)}.${money} Shall I make the correction?`;
    }
    case "correct_payment":
      return d.amount
        ? `Change ${d.customer}'s payment from ${rupees(d.original.data.amount)} to ${rupees(d.amount)}. Shall I correct it?`
        : `Cancel ${d.customer}'s payment of ${rupees(d.original.data.amount)}; it goes back on their credit. Shall I cancel it?`;
    case "record_purchase":
      return `Purchase: ${d.lines
        .map((l: any) => {
          const item = itemOf(state, l.item);
          return `${quantityText(l.qty, item.unit)} ${item.name} at ${rupees(l.price)} per ${item.unit} (${rupees(l.total)})`;
        })
        .join(", ")}. Total ${rupees(d.total)}. This adds stock; it doesn't record paying the supplier. Shall I record it?`;
    case "add_item":
      return `New item ${d.name}: ${quantityText(d.stock, d.unit)} in stock, selling at ${rupees(d.price)} per ${d.unit}${d.cost ? `, costing ${rupees(d.cost)}` : ""}. Shall I add it?`;
    case "add_customer":
      return `New customer ${d.name}${d.balance ? ` who already owes ${rupees(d.balance)}` : ""}. Shall I add them?`;
    case "set_price": {
      const item = itemOf(state, d.item);
      return `${item.name} price changes from ${rupees(item.price)} to ${rupees(d.price)} per ${item.unit} for future sales. Shall I change it?`;
    }
    case "configure_shop":
      return `Shop name ${d.name}, timezone ${d.timezone}. Shall I save it?`;
    case "save_order_draft":
      return `Save a supplier order draft: ${d.snapshot.lines.map((l: any) => `${quantityText(l.qty, l.unit)} ${l.name}`).join(", ")}, about ${rupees(d.snapshot.total)}. Nothing is sent to the supplier. Shall I save it?`;
    case "receive_order":
      return `Delivery received: ${d.lines
        .map((l: any) => `${quantityText(l.qty, itemOf(state, l.item).unit)} ${itemOf(state, l.item).name} at ${rupees(l.price)}`)
        .join(", ")}, ${rupees(d.total)} in all. Shall I add it to stock?`;
    case "cancel_order_draft":
      return "Cancel the unsent order draft? Nothing was sent to the supplier.";
  }
  return "Shall I record this?";
}

/** One sentence describing what just got saved, using the new state. */
export function describeReceipt(receipt: any, state: State): string {
  const d = receipt.data;
  const stockLine = (lines: any[]) =>
    lines
      .map((l) => {
        const item = itemOf(state, l.item);
        return `${item.name} now ${quantityText(item.stock, item.unit)}`;
      })
      .join(", ");
  switch (receipt.kind) {
    case "record_sale":
      return `Recorded. ${stockLine(d.lines)}.${d.customer && d.total > d.paid ? ` ${d.customer} owes ${rupees(balanceOf(state, d.customer))}.` : ""}`;
    case "record_payment":
    case "correct_payment":
      return `Recorded. ${d.customer} owes ${rupees(balanceOf(state, d.customer))}.`;
    case "correct_entry":
      return `Corrected; the original stays in the history. ${stockLine([...d.original.data.lines, ...d.replacement.lines].filter((l, i, a) => a.findIndex((x) => x.item === l.item) === i))}.${d.replacement.customer ? ` ${d.replacement.customer} owes ${rupees(balanceOf(state, d.replacement.customer))}.` : ""}`;
    case "record_purchase":
    case "receive_order":
      return `Recorded. ${stockLine(d.lines)}.`;
    case "save_order_draft":
      return "Order draft saved. It hasn't been sent to anyone.";
    default:
      return "Done.";
  }
}

// ------------------------------------------------------------------ tool list

export type ToolDef = {
  name: string;
  title: string;
  description: string;
  schema: z.ZodObject<any>;
  readOnly: boolean;
  run: (args: any) => any;
};

export const SERVER_INSTRUCTIONS = `Bahi is a shop's account book (bahi-khata): stock, sales, customer credit (udhaar) and supplier purchases for one small shop.
How to use it:
- Pass items and customers exactly as the shopkeeper said them (Hindi, Hinglish or English, e.g. "cheeni" for sugar). If the server says a name is ambiguous or unknown, ask the shopkeeper; never guess.
- Money is in rupees. Quantities are in the item's own unit (kilos, or a count of packets/pieces).
- Tools that change the books only PREVIEW. Read the preview's "say" text aloud, wait for the shopkeeper's yes in their next turn, then call confirm_operation with the operation id. If they say no or change something, call discard_operation or make a new preview. Never confirm without a clear yes.
- For "no, that was 2 not 3" or "that was Meena, not Ramesh", use correct_entry; it fixes the latest sale unless a receipt is given (see recent_entries).
- For why/what-if questions use the analyst tools (explain_sales_change, low_stock_forecast, credit_risk, dead_stock, sales_report, daily_summary) and narrate their "say" text; every number comes from the ledger, so do not compute totals yourself.`;

export function toolDefinitions(ledger: Ledger, token: string): ToolDef[] {
  const state = () => ledger.state(token);
  const preview = (kind: string, data: any) => {
    const s = state();
    const op = ledger.preview(token, kind, data);
    return {
      operation: op.id,
      kind,
      needsConfirmation: true,
      expiresInSeconds: 300,
      say: describePreview(kind, op.data, s),
      data: op.data,
      version: op.version,
    };
  };
  const plan = (args: any, previous?: any) => {
    const constraints = {
      budget: paise(args.budget ?? previous.budget / 100),
      reserve: paise(args.reserve ?? (previous ? previous.reserve / 100 : 0)),
      deliveryFee: paise(args.deliveryFee ?? (previous ? previous.deliveryFee / 100 : 0)),
      exclude: (args.exclude ?? previous?.exclude ?? []).map(
        (n: string) => resolveName(state().items, n, "item").name,
      ),
      priority: (args.priority ?? previous?.priority ?? []).map(
        (n: string) => resolveName(state().items, n, "item").name,
      ),
    };
    const result = previous
      ? ledger.revise(token, args.plan, constraints)
      : ledger.plan(token, constraints);
    const assumed = [
      args.reserve === undefined && !previous ? "nothing kept aside" : "",
      args.deliveryFee === undefined && !previous ? "no delivery charge" : "",
    ].filter(Boolean);
    return {
      ...result,
      say: `${result.lines.length ? `Order ${result.lines.map((l: any) => `${quantityText(l.qty, l.unit)} ${l.name}`).join(", ")} for about ${rupees(result.total)}` : "Nothing needs ordering within that budget"}${result.unmet.length ? `. Not enough budget for ${listNames(result.unmet.map((u: any) => (result.lines.some((l: any) => l.name === u.name) ? `more ${u.name}` : u.name)))}` : ""}${assumed.length ? ` (assuming ${assumed.join(" and ")})` : ""}. This is only a plan; say "save it" to keep it as an order draft.`,
    };
  };

  return [
    // ---------------- reads
    {
      name: "check_stock",
      title: "Check stock",
      description:
        "How much of an item (or of everything) is in stock, with its selling price. Use for 'how much rice do I have?' or 'what's in stock?'.",
      schema: z.object({ item: itemName.optional() }).strict(),
      readOnly: true,
      run: ({ item }) => {
        const s = state();
        const rows = (item ? [resolveName(s.items, item, "item")] : s.items).map((i) => ({
          name: i.name,
          stock: i.stock / 1000,
          unit: i.unit,
          stockText: quantityText(i.stock, i.unit),
          price: i.price / 100,
          priceText: `${rupees(i.price)} per ${i.unit}`,
        }));
        return {
          items: rows,
          say: item
            ? `${rows[0].name}: ${rows[0].stockText} in stock, selling at ${rows[0].priceText}.`
            : rows.length
              ? `You have ${rows.map((r) => `${r.stockText} ${r.name}`).join(", ")}.`
              : "No items yet.",
        };
      },
    },
    {
      name: "who_owes",
      title: "Who owes money",
      description:
        "Customer credit (udhaar) balances: everyone who owes money, or one customer's balance. Use for 'who owes me money?' or 'how much does Ramesh owe?'.",
      schema: z.object({ customer: customerName.optional() }).strict(),
      readOnly: true,
      run: ({ customer }) => {
        const s = state();
        if (customer) {
          const c = resolveName(s.customers, customer, "customer");
          return {
            customers: [{ name: c.name, balance: c.balance / 100, balanceText: rupees(c.balance) }],
            say: c.balance ? `${c.name} owes ${rupees(c.balance)}.` : `${c.name} doesn't owe anything.`,
          };
        }
        const owing = s.customers.filter((c) => c.balance > 0).sort((a, b) => b.balance - a.balance);
        const total = owing.reduce((n, c) => n + c.balance, 0);
        return {
          total: total / 100,
          totalText: rupees(total),
          customers: owing.map((c) => ({ name: c.name, balance: c.balance / 100, balanceText: rupees(c.balance) })),
          say: owing.length
            ? `${owing.length} ${owing.length === 1 ? "person owes" : "people owe"} you ${rupees(total)}: ${owing.map((c) => `${c.name} ${rupees(c.balance)}`).join(", ")}.`
            : "Nobody owes you money.",
        };
      },
    },
    {
      name: "recent_entries",
      title: "Recent entries",
      description:
        "The latest sales and payments with their receipt ids and times. Use to find which entry to correct ('the sale to Meena this morning').",
      schema: z
        .object({
          limit: z.number().int().min(1).max(20).optional().describe("How many, default 5"),
          customer: customerName.optional(),
        })
        .strict(),
      readOnly: true,
      run: ({ limit = 5, customer }) => {
        const s = state();
        const who = customer ? resolveName(s.customers, customer, "customer").name : undefined;
        const tz = s.shop.timezone;
        const rows = [
          ...saleFacts(s).map((f) => ({
            receipt: f.id,
            type: "sale",
            at: f.at,
            customer: f.customer,
            text: `${timeLabel(f.at, tz)} ${dayLabel(f.day)}: ${f.lines.map((l) => `${quantityText(l.qty, l.unit)} ${l.name}`).join(", ")}${f.customer ? ` to ${f.customer}` : " (cash)"}, ${rupees(f.total)}`,
          })),
          ...paymentFacts(s).map((p) => ({
            receipt: p.id,
            type: "payment",
            at: p.at,
            customer: p.customer,
            text: `${timeLabel(p.at, tz)} ${dayLabel(p.day)}: ${p.customer} paid ${rupees(p.amount)}`,
          })),
        ]
          .filter((r) => !who || r.customer === who)
          .sort((a, b) => b.at.localeCompare(a.at))
          .slice(0, limit);
        return {
          entries: rows,
          say: rows.length ? rows.map((r) => r.text).join(". ") + "." : "No entries yet.",
        };
      },
    },
    {
      name: "daily_summary",
      title: "Daily summary",
      description:
        "Sales, cash, credit given, repayments and top items for a day (default today), compared with another day (default the same weekday last week). Use for 'how was today?' or 'how was Saturday compared with last Saturday?'.",
      schema: z
        .object({
          date: dayPhrase,
          compareTo: z.string().max(40).optional().describe("Day to compare with; 'none' to skip"),
        })
        .strict(),
      readOnly: true,
      run: ({ date, compareTo }) => dailySummary(state(), date, compareTo),
    },
    {
      name: "explain_sales_change",
      title: "Why sales went up or down",
      description:
        "Explains why a day's sales were higher or lower than usual: compares with the same weekday over the last 4 weeks and names the customers and items behind the gap, including stock-outs. Use for 'why were sales down on Tuesday?'. Defaults to yesterday.",
      schema: z.object({ date: dayPhrase }).strict(),
      readOnly: true,
      run: ({ date }) => explainSalesChange(state(), { date }),
    },
    {
      name: "low_stock_forecast",
      title: "What's running low",
      description:
        "Days of stock left per item from day-of-week sales patterns, which items run out before the supplier can deliver, and when to order. Use for 'what's running low?' or 'how long will sugar last?'.",
      schema: z.object({ item: itemName.optional() }).strict(),
      readOnly: true,
      run: ({ item }) => {
        const s = state();
        return lowStockForecast(s, item ? { item: resolveName(s.items, item, "item").id } : {});
      },
    },
    {
      name: "credit_risk",
      title: "Credit risk",
      description:
        "Which customers' credit is risky: ages every balance and flags people whose debt is growing while payments have stopped. Use for 'who's a credit risk?' or 'should I give Farooq more credit?'.",
      schema: z.object({}).strict(),
      readOnly: true,
      run: () => creditRisk(state()),
    },
    {
      name: "dead_stock",
      title: "Dead stock",
      description:
        "Items that haven't sold in a while and how much money is tied up in them. Use for 'which items aren't moving?'.",
      schema: z
        .object({ days: z.number().int().min(7).max(120).optional().describe("No sales for this many days, default 21") })
        .strict(),
      readOnly: true,
      run: ({ days }) => deadStock(state(), { days }),
    },
    {
      name: "sales_report",
      title: "Sales report and chart",
      description:
        "Sales over a period as chart data: per day, per item, per customer, or average per weekday. Use for 'show me last month by item' or 'which day is busiest?'. Show the chart on screen if you can.",
      schema: z
        .object({
          days: z.number().int().min(1).max(120).optional().describe("Period length in days, default 28"),
          by: z.enum(["day", "item", "weekday", "customer"]).optional().describe("Default day"),
        })
        .strict(),
      readOnly: true,
      run: (args) => salesReport(state(), args),
    },
    {
      name: "plan_restock",
      title: "Plan what to restock",
      description:
        "Suggests what to buy from the supplier within a budget, covering each item's lead time plus two days of recent sales. Only a plan; nothing is ordered. Use for 'what should I stock for the weekend with 3000 rupees?'.",
      schema: z
        .object({
          budget: rupeesIn("Total spend allowed"),
          reserve: rupeesIn("Money to keep aside out of the budget").optional(),
          deliveryFee: rupeesIn("Supplier delivery charge").optional(),
          exclude: z.array(itemName).max(30).optional().describe("Items not to buy"),
          priority: z.array(itemName).max(30).optional().describe("Items to buy first"),
        })
        .strict(),
      readOnly: true,
      run: (args) => plan(args),
    },
    {
      name: "revise_plan",
      title: "Change a restock plan",
      description:
        "Recomputes a restock plan with changed budget, reserve, delivery fee, exclusions or priorities ('leave out biscuits', 'make it 2500'). Lists you pass replace the old ones.",
      schema: z
        .object({
          plan: z.string().describe("Plan id from plan_restock"),
          budget: rupeesIn("New total spend").optional(),
          reserve: rupeesIn("New amount to keep aside").optional(),
          deliveryFee: rupeesIn("New delivery charge").optional(),
          exclude: z.array(itemName).max(30).optional(),
          priority: z.array(itemName).max(30).optional(),
        })
        .strict(),
      readOnly: true,
      run: (args) => plan(args, ledger.scenario(token, args.plan).constraints),
    },
    // ---------------- writes (preview only)
    {
      name: "record_sale",
      title: "Record a sale",
      description:
        "PREVIEW a sale: reduces stock and, if the customer didn't pay everything, adds the rest to their credit. Prices come from the catalogue. With no customer it's a cash sale paid in full. With a customer and no 'paid', it all goes on credit, so pass 'paid' if they paid something or paidInFull if they paid everything. Example: 'sold three rice and two sugar to Ramesh, he paid fifty' → customer Ramesh, items rice 3 and sugar 2, paid 50.",
      schema: z
        .object({
          customer: customerName.nullable().optional().describe("Who bought, if a known credit customer. Omit for a walk-in cash sale."),
          items: z.array(saleLine).min(1).max(30),
          paid: rupeesIn("Cash the customer paid now").optional(),
          paidInFull: z.boolean().optional().describe("True if the customer paid the whole bill"),
          date: dayPhrase,
        })
        .strict(),
      readOnly: false,
      run: (a) => {
        const s = state();
        const lines = a.items.map((l: any) => {
          const { item, qty } = toMilli(s, l);
          return { item: item.id, qty };
        });
        const data: any = { customer: a.customer ?? null, lines };
        // Customers often hand over a round note: paying more than the bill
        // means change is due, not an overpayment.
        const bill = lines.reduce((n: number, l: any) => {
          const item = s.items.find((i) => i.id === l.item)!;
          return n + Math.floor((item.price * l.qty) / 1000);
        }, 0);
        let change = 0;
        if (a.paid !== undefined && paise(a.paid) > bill) {
          change = paise(a.paid) - bill;
          if (a.customer) data.paid = bill;
        } else if (a.customer && !a.paidInFull) data.paid = paise(a.paid ?? 0);
        const when = effectiveAt(s, a.date);
        if (when) data.effectiveAt = when;
        const result = preview("record_sale", data);
        if (change)
          result.say = result.say.replace(
            / Shall I record it\?$/,
            ` Give ${rupees(change)} change. Shall I record it?`,
          );
        return { ...result, change: change / 100 };
      },
    },
    {
      name: "record_payment",
      title: "Record a credit payment",
      description:
        "PREVIEW a customer paying back credit ('Ramesh paid two hundred'). Reduces what they owe; applied to their oldest bills first.",
      schema: z.object({ customer: customerName, amount: rupeesIn("Amount paid"), date: dayPhrase }).strict(),
      readOnly: false,
      run: (a) => {
        const s = state();
        const when = effectiveAt(s, a.date);
        return preview("record_payment", {
          customer: a.customer,
          amount: paise(a.amount),
          ...(when ? { effectiveAt: when } : {}),
        });
      },
    },
    {
      name: "correct_entry",
      title: "Correct or cancel a sale",
      description:
        "PREVIEW a fix to a sale that was recorded wrong: different items or quantities ('no, that was two sugar not three'), a different customer ('that was Meena, not Ramesh'), a different amount paid, or cancelling it entirely. Fixes the latest sale unless a receipt id is given (see recent_entries). Pass only what changes; 'items' replaces the whole item list. The original stays in the history; stock, credit and cash are adjusted, and the preview says if cash must be handed back.",
      schema: z
        .object({
          receipt: z.string().optional().describe("Receipt id of the sale; default is the latest sale"),
          items: z.array(saleLine).max(30).optional().describe("The complete corrected item list"),
          customer: customerName
            .nullable()
            .optional()
            .describe("Corrected customer; null to make it a walk-in cash sale"),
          paid: rupeesIn("Corrected amount paid at the time").optional(),
          cancel: z.boolean().optional().describe("True to cancel the sale completely"),
        })
        .strict(),
      readOnly: false,
      run: (a) => {
        const s = state();
        const data: any = {};
        if (a.receipt) data.receipt = a.receipt;
        if (a.cancel) {
          data.lines = [];
          data.paid = 0;
        } else if (a.items)
          data.lines = a.items.map((l: any) => {
            const { item, qty } = toMilli(s, l);
            return { item: item.id, qty };
          });
        if (a.customer !== undefined) data.customer = a.customer;
        if (a.paid !== undefined && !a.cancel) data.paid = paise(a.paid);
        if (!a.cancel && data.lines === undefined && a.customer === undefined && a.paid === undefined)
          throw Error("What should change: the items, the customer, the amount paid, or cancel the sale?");
        // When only items change on a credit sale, keep the cash paid unless told.
        return preview("correct_entry", data);
      },
    },
    {
      name: "correct_payment",
      title: "Correct or cancel a payment",
      description:
        "PREVIEW a fix to a credit payment recorded with the wrong amount ('no, Ramesh paid 200 not 300'); amount 0 cancels it. Fixes the latest payment unless a receipt id is given.",
      schema: z
        .object({
          receipt: z.string().optional(),
          amount: rupeesIn("The correct amount paid"),
        })
        .strict(),
      readOnly: false,
      run: (a) =>
        preview("correct_payment", {
          ...(a.receipt ? { receipt: a.receipt } : {}),
          amount: paise(a.amount),
        }),
    },
    {
      name: "record_purchase",
      title: "Record stock bought",
      description:
        "PREVIEW stock arriving from a supplier ('got 20 kilos of sugar for 900 rupees'). Give either the price per unit or the total cost of each line. Increases stock and updates the item's cost; it does not record paying the supplier.",
      schema: z
        .object({
          items: z
            .array(
              z
                .object({
                  item: itemName,
                  quantity,
                  unit,
                  pricePerUnit: rupeesIn("Cost per kilo/packet/piece").optional(),
                  totalCost: rupeesIn("Cost of this whole line").optional(),
                })
                .strict(),
            )
            .min(1)
            .max(30),
          date: dayPhrase,
        })
        .strict(),
      readOnly: false,
      run: (a) => {
        const s = state();
        const lines = a.items.map((l: any) => {
          const { item, qty } = toMilli(s, l);
          let price: number;
          if (l.pricePerUnit !== undefined) price = paise(l.pricePerUnit);
          else if (l.totalCost !== undefined) {
            const total = BigInt(paise(l.totalCost)) * 1000n;
            if (total % BigInt(qty))
              throw Error(
                `${rupees(paise(l.totalCost))} for ${quantityText(qty, item.unit)} isn't a whole number of paise per ${item.unit}; tell me the price per ${item.unit}.`,
              );
            price = Number(total / BigInt(qty));
          } else throw Error(`How much did the ${item.name} cost?`);
          return { item: item.id, qty, price };
        });
        const when = effectiveAt(s, a.date);
        return preview("record_purchase", { lines, ...(when ? { effectiveAt: when } : {}) });
      },
    },
    {
      name: "add_item",
      title: "Add an item",
      description:
        "PREVIEW adding a new product to the catalogue with its unit, opening stock and selling price. Aliases are other names people use for it (e.g. 'cheeni' for sugar).",
      schema: z
        .object({
          name: z.string().min(1).max(80),
          unit: z.enum(["kg", "packet", "piece"]),
          stock: quantity.or(z.literal(0)).describe("Opening stock in that unit"),
          price: rupeesIn("Selling price per unit"),
          cost: rupeesIn("Buying cost per unit, if known").optional(),
          packSize: quantity.optional().describe("How many units the supplier sells together, default 1"),
          leadDays: z.number().int().min(0).max(30).optional().describe("Days the supplier takes to deliver, default 1"),
          aliases: z.array(z.string().min(1).max(40)).max(10).optional(),
        })
        .strict(),
      readOnly: false,
      run: (a) =>
        preview("add_item", {
          name: a.name,
          unit: a.unit,
          stock: exact(String(a.stock), 3),
          price: paise(a.price),
          cost: a.cost ? paise(a.cost) : null,
          pack: exact(String(a.packSize ?? 1), 3),
          leadDays: a.leadDays ?? 1,
          aliases: a.aliases ?? [],
        }),
    },
    {
      name: "add_customer",
      title: "Add a customer",
      description: "PREVIEW adding a credit customer, optionally with money they already owe.",
      schema: z.object({ name: z.string().min(1).max(80), openingBalance: rupeesIn("Amount already owed").optional() }).strict(),
      readOnly: false,
      run: (a) => preview("add_customer", { name: a.name, balance: paise(a.openingBalance ?? 0) }),
    },
    {
      name: "set_price",
      title: "Change a price",
      description: "PREVIEW changing an item's selling price (and optionally its cost) for future sales. Past sales keep their prices.",
      schema: z.object({ item: itemName, price: rupeesIn("New selling price per unit"), cost: rupeesIn("New cost per unit").optional() }).strict(),
      readOnly: false,
      run: (a) =>
        preview("set_price", {
          item: a.item,
          price: paise(a.price),
          ...(a.cost !== undefined ? { cost: paise(a.cost) } : {}),
        }),
    },
    {
      name: "configure_shop",
      title: "Shop settings",
      description: "PREVIEW setting the shop's name and timezone.",
      schema: z.object({ name: z.string().min(1).max(80), timezone: z.enum(["UTC", "Asia/Kolkata"]) }).strict(),
      readOnly: false,
      run: (a) => preview("configure_shop", { name: a.name, currency: "INR", timezone: a.timezone }),
    },
    {
      name: "save_order_draft",
      title: "Save restock plan as an order draft",
      description: "PREVIEW saving a restock plan as an unsent supplier order draft. Nothing is sent to anyone.",
      schema: z.object({ plan: z.string().describe("Plan id") }).strict(),
      readOnly: false,
      run: (a) => preview("save_order_draft", { plan: a.plan }),
    },
    {
      name: "receive_order",
      title: "Receive an order delivery",
      description:
        "PREVIEW a delivery against a saved order draft with the actual quantities and prices; anything not delivered stays outstanding. Default is the latest unsent draft.",
      schema: z
        .object({
          draft: z.string().optional(),
          items: z
            .array(z.object({ item: itemName, quantity, unit, pricePerUnit: rupeesIn("Actual price per unit") }).strict())
            .min(1)
            .max(30),
        })
        .strict(),
      readOnly: false,
      run: (a) => {
        const s = state();
        return preview("receive_order", {
          ...(a.draft ? { draft: a.draft } : {}),
          lines: a.items.map((l: any) => {
            const { item, qty } = toMilli(s, l);
            return { item: item.id, qty, price: paise(l.pricePerUnit) };
          }),
        });
      },
    },
    {
      name: "cancel_order_draft",
      title: "Cancel an order draft",
      description: "PREVIEW cancelling an unsent order draft (default: the latest).",
      schema: z.object({ draft: z.string().optional() }).strict(),
      readOnly: false,
      run: (a) => preview("cancel_order_draft", a.draft ? { draft: a.draft } : {}),
    },
    // ---------------- commit / discard
    {
      name: "confirm_operation",
      title: "Confirm a previewed change",
      description:
        "Saves a previewed change permanently. Call ONLY after you read the preview's 'say' text to the shopkeeper and they clearly said yes in their next turn. Never call it in the same turn as the preview. Calling it twice with the same id is safe: it returns the same receipt.",
      schema: z.object({ operation: z.string().describe("operation id from the preview") }).strict(),
      readOnly: false,
      run: ({ operation }) => {
        const receipt = ledger.confirm(token, operation);
        return { recorded: true, receipt, say: describeReceipt(receipt, state()) };
      },
    },
    {
      name: "discard_operation",
      title: "Discard a preview",
      description: "Throws away a preview the shopkeeper said no to. Nothing is saved.",
      schema: z.object({ operation: z.string() }).strict(),
      readOnly: false,
      run: ({ operation }) => ({ ...ledger.discard(token, operation), say: "Okay, not recorded." }),
    },
  ];
}

/** Helpers the simulator uses to talk about the latest sale. */
export function latestSale(state: State) {
  const e = latestReceipt(state, SALE_KINDS);
  return e ? { id: e.id, version: e.version, data: saleData(e) } : undefined;
}
export function latestPayment(state: State) {
  return latestReceipt(state, PAYMENT_KINDS);
}
