import type { State } from "../../../../packages/domain/src/ledger";
import { money } from "../../../../packages/contracts/src/money";
import { Lines } from "./LedgerLines";
export function RestockPlanCard({
  plan,
  previous,
  state,
  send,
}: {
  plan: any;
  previous: any;
  state: State;
  send: (s: string) => void;
}) {
  return (
    <section className="plan" data-testid="restock-plan">
      <div className="eyebrow">Plan only · nothing ordered</div>
      <h2>Your restock proposal</h2>
      <div className="plan-money">
        <span>
          Proposed spend <b>{money(plan.total)}</b>
        </span>
        <span>
          Keep aside <b>{money(plan.reserve)}</b>
        </span>
        <span>
          Unallocated <b>{money(plan.remaining)}</b>
        </span>
      </div>
      <Lines lines={plan.lines} state={state} />
      {plan.lines.some((l: any) => l.leadDays > 1) && (
        <p>
          <strong>Timing caution:</strong>{" "}
          {plan.lines
            .filter((l: any) => l.leadDays > 1)
            .map((l: any) => `${l.name}: ${l.leadDays} days lead time`)
            .join("; ")}
          .
        </p>
      )}
      <p>
        Includes {money(plan.deliveryFee)} delivery. Spending envelope{" "}
        {money(plan.constraints.budget)}. Excluded:{" "}
        {plan.constraints.exclude.join(", ") || "none"}.
      </p>
      {previous && (
        <p className="comparison" data-testid="plan-comparison">
          Compared with previous scenario: {money(previous.total)} →{" "}
          {money(plan.total)}.
        </p>
      )}
      {plan.unmet.length > 0 && (
        <p>
          Not covered:{" "}
          {plan.unmet
            .map((u: any) => `${u.name} (${u.qty / 1000} more units)`)
            .join(", ")}{" "}
          — over budget.
        </p>
      )}
      <details>
        <summary>Why these quantities?</summary>
        <p>{plan.evidence.method}</p>
        <p>
          {plan.evidence.start.slice(0, 10)} to {plan.evidence.end.slice(0, 10)}{" "}
          · recent 14-day window
        </p>
        {plan.lines.map((l: any) => (
          <p key={l.item}>
            <b>{l.name}</b>: {l.sold14Days / 1000} {l.unit} sold;{" "}
            {l.stock / 1000} on hand; {l.outstanding / 1000} already
            outstanding; target {l.target / 1000}. Pack {l.pack / 1000}, lead{" "}
            {l.leadDays} day(s). {l.evidence.length} supporting receipts.
            <small className="ids">{l.evidence.join(", ")}</small>
          </p>
        ))}
        <ul>
          {plan.evidence.warnings.map((w: string) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      </details>
      {plan.say && <p className="say">{plan.say}</p>}
      <button onClick={() => send("save draft")}>Save as order draft</button>
    </section>
  );
}
