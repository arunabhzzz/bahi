import { randomUUID } from "node:crypto";
import type { State } from "../../domain/src/ledger";
import { planningSchema, type Constraints } from "../../contracts/src/planning";
export function planRestock(
  state: State,
  input: Constraints,
  now = Date.now(),
) {
  const constraints = planningSchema.parse(input);
  const { budget, reserve, deliveryFee, exclude, priority } = constraints;
  for (const name of [...exclude, ...priority])
    if (!state.items.some((i) => i.name === name))
      throw Error(
        `Unknown constraint item: ${name}. Use exact catalogue name.`,
      );
  if (reserve > budget) throw Error("Reserve exceeds budget");
  if (deliveryFee === null)
    throw Error("Confirm delivery fee before establishing affordability");
  if (deliveryFee > budget - reserve)
    throw Error("Delivery fee exceeds spending envelope");
  const start = now - 14 * 86400000;
  const corrected = new Set(
    state.events
      .filter((e) => e.kind === "correct_entry")
      .map((e) => e.data.original.id),
  );
  const history = state.events.filter(
    (e) =>
      ["record_sale", "correct_entry"].includes(e.kind) &&
      !corrected.has(e.id) &&
      Date.parse(
        (e.kind === "correct_entry" ? e.data.replacement : e.data)
          .effectiveAt ?? e.at,
      ) >= start,
  );
  let remaining = budget - reserve - deliveryFee;
  const candidates = state.items
    .filter((i) => !exclude.includes(i.name))
    .map((item) => {
      const evidence = history.filter((e) =>
        (e.kind === "correct_entry" ? e.data.replacement : e.data).lines.some(
          (l: any) => l.item === item.id,
        ),
      );
      const sold = evidence.reduce(
        (sum, e) =>
          sum +
          (e.kind === "correct_entry" ? e.data.replacement : e.data).lines
            .filter((l: any) => l.item === item.id)
            .reduce((n: number, l: any) => n + l.qty, 0),
        0,
      );
      const outstanding = state.drafts
        .filter((d) => d.status === "unsent")
        .reduce(
          (sum, d) =>
            sum +
            d.lines
              .filter((l: any) => l.item === item.id)
              .reduce((n: number, l: any) => n + l.remaining, 0),
          0,
        );
      // Cover lead time + 2 days of recent demand, at least one pack.
      // Items with stock but no recent sales are dead stock: don't reorder.
      // A brand-new or empty item with no history gets one pack.
      const target =
        sold > 0
          ? Math.max(item.pack, Math.ceil((sold * (item.leadDays + 2)) / 14))
          : item.stock > 0
            ? 0
            : item.pack;
      const need = Math.max(0, target - item.stock - outstanding);
      const cover = sold > 0 ? item.stock / (sold / 14) : item.stock > 0 ? Infinity : 0;
      return {
        item,
        target,
        cover,
        need,
        sold,
        outstanding,
        evidence: evidence.map((e) => e.id),
      };
    })
    .sort((a, b) => {
      const pa = priority.indexOf(a.item.name),
        pb = priority.indexOf(b.item.name);
      if (pa >= 0 || pb >= 0) return (pa < 0 ? 999 : pa) - (pb < 0 ? 999 : pb);
      // Most urgent first: fewest days of stock left.
      return a.cover - b.cover || a.item.name.localeCompare(b.item.name);
    });
  const lines: any[] = [],
    unmet: any[] = [];
  for (const c of candidates) {
    const { item, need } = c;
    if (!need) continue;
    if (item.cost === null)
      throw Error(`Missing purchase cost for ${item.name}`);
    const product = BigInt(item.cost) * BigInt(item.pack);
    if (product % 1000n)
      throw Error(`Pack cost for ${item.name} has fractional paise`);
    const packCost = Number(product / 1000n);
    const wanted = Math.ceil(need / item.pack),
      packs = Math.min(wanted, Math.floor(remaining / packCost));
    if (packs) {
      const cost = packs * packCost;
      remaining -= cost;
      lines.push({
        item: item.id,
        name: item.name,
        unit: item.unit,
        qty: packs * item.pack,
        price: item.cost,
        cost,
        packs,
        pack: item.pack,
        leadDays: item.leadDays,
        stock: item.stock,
        outstanding: c.outstanding,
        target: c.target,
        sold14Days: c.sold,
        evidence: c.evidence,
      });
    }
    if (packs < wanted)
      unmet.push({
        name: item.name,
        qty: (wanted - packs) * item.pack,
        reason: "Budget constraint",
      });
  }
  return {
    id: randomUUID(),
    version: state.version,
    constraints,
    lines,
    unmet,
    total: budget - reserve - remaining,
    remaining,
    reserve,
    deliveryFee,
    evidence: {
      start: new Date(start).toISOString(),
      end: new Date(now).toISOString(),
      method:
        "Fewest days of stock first; explicit priorities override. Cover supplier lead time + 2 days of the last 14 days' average, at least one pack; items with no recent sales are not reordered; unsent draft quantities are subtracted.",
      warnings: [
        "Heuristic proposal, not a proven optimum. Sales can be censored by stockouts.",
        "Recent 14-day average; items with no sales in 14 days are treated as not needed.",
        "Supplier lead times are estimates; no guarantee of tomorrow delivery.",
        "Reserve and budget are owner inputs, not inferred cash. Supplier payments are separate.",
      ],
    },
  };
}
