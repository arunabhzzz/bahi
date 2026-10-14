import type { State } from "../../../../packages/domain/src/ledger";
import { money } from "../../../../packages/contracts/src/money";
import { Lines } from "./LedgerLines";

export function ActionPreview({
  pending,
  state,
  send,
  busy,
}: {
  pending: any;
  state: State;
  send: (s: string, requestId?: string, confirmationOperation?: string) => void;
  busy: boolean;
}) {
  const d = pending.data,
    financial = d.replacement ?? d;
  return (
    <section className="preview" data-testid="action-preview">
      <div className="eyebrow">Waiting for your yes · nothing saved yet</div>
      <h2>{pending.kind.replaceAll("_", " ")}</h2>
      {pending.say && <p className="say">{pending.say}</p>}
      {financial.lines && financial.lines.length > 0 && (
        <Lines lines={financial.lines} state={state} />
      )}
      {financial.total !== undefined && (
        <p className="total">
          Total <b>{money(financial.total)}</b>
        </p>
      )}
      {financial.paid !== undefined && financial.customer && (
        <p>
          {financial.customer} · paid {money(financial.paid)} · on credit{" "}
          {money(financial.total - financial.paid)}
        </p>
      )}
      {financial.amount !== undefined && (
        <p className="total">
          Payment <b>{money(financial.amount)}</b>
        </p>
      )}
      {d.original && pending.kind === "correct_entry" && (
        <p className="muted">
          Replaces receipt {d.original.id.slice(0, 8)} ({money(d.original.data.total)}).
          The original stays in the history.
        </p>
      )}
      {d.snapshot && (
        <>
          <Lines lines={d.snapshot.lines} state={state} />
          <p className="total">
            Estimate <b>{money(d.snapshot.total)}</b>
          </p>
        </>
      )}
      <small>
        Operation {pending.id} · valid for 5 minutes
      </small>
      <div className="actions">
        <button
          className="primary"
          onClick={() => send("confirm", undefined, pending.id)}
          disabled={busy}
        >
          Yes, record it
        </button>
        <button onClick={() => send("discard")} disabled={busy}>
          No
        </button>
      </div>
    </section>
  );
}
