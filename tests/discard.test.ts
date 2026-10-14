import { it, expect } from "vitest";
import { Ledger } from "../packages/domain/src/ledger";
it("discarding pending confirmation invalidates its exact operation without a ledger write", () => {
  const l = new Ledger(":memory:"),
    t = l.session(),
    other = l.session();
  const op = l.preview(t, "add_customer", { name: "A", balance: 0 });
  expect(() => l.discard(other, op.id)).toThrow();
  l.discard(t, op.id);
  expect(() => l.confirm(t, op.id)).toThrow(/expired/);
  expect(l.state(t).version).toBe(0);
});
