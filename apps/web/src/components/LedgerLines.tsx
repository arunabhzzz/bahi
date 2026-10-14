import type { State } from "../../../../packages/domain/src/ledger";
import { money } from "../../../../packages/contracts/src/money";
export function Quantity({ qty, unit }: { qty: number; unit: string }) {
  const n = qty / 1000;
  return (
    <>
      {n} {unit === "kg" || n === 1 || !unit ? unit : unit + "s"}
    </>
  );
}
export function Lines({ lines, state }: { lines: any[]; state: State }) {
  return (
    <ul className="lines">
      {lines.map((l: any) => (
        <li key={l.item}>
          <span>
            <strong>
              {l.name ?? state.items.find((i) => i.id === l.item)?.name}
            </strong>{" "}
            ·{" "}
            <Quantity
              qty={l.qty}
              unit={
                l.unit ?? state.items.find((i) => i.id === l.item)?.unit ?? ""
              }
            />
          </span>
          {l.price !== undefined && <span>{money(l.price)} / unit</span>}
          {(l.cost ?? l.total) !== undefined && (
            <b>{money(l.cost ?? l.total)}</b>
          )}
        </li>
      ))}
    </ul>
  );
}
