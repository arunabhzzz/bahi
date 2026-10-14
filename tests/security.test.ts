import { it, expect } from "vitest";
import { Ledger } from "../packages/domain/src/ledger";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
it("rejects stale previews and expired/tampered confirmations; survives restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "bahi-"));
  const path = join(dir, "ledger.sqlite");
  let l = new Ledger(path);
  const t = l.session();
  const payload = {
    name: "Rice",
    unit: "kg",
    stock: 10000,
    price: 6000,
    cost: 4500,
    pack: 5000,
    leadDays: 2,
  };
  const a = l.preview(t, "add_item", payload),
    b = l.preview(t, "add_item", { ...payload, name: "Sugar" }),
    duplicate = l.preview(t, "add_item", { ...payload, name: "rice" });
  l.confirm(t, a.id);
  // An unrelated entry in between doesn't invalidate a preview...
  expect(l.confirm(t, b.id).kind).toBe("add_item");
  // ...but one that makes it wrong does.
  expect(() => l.confirm(t, duplicate.id)).toThrow(/State changed/);
  const c = l.preview(t, "add_customer", { name: "A", balance: 0 });
  l.db.prepare("UPDATE operations SET expires=0 WHERE id=?").run(c.id);
  expect(() => l.confirm(t, c.id)).toThrow(/expired/);
  const d = l.preview(t, "add_customer", { name: "B", balance: 0 });
  l.db
    .prepare("UPDATE operations SET data=? WHERE id=?")
    .run('{"name":"C","balance":0}', d.id);
  expect(() => l.confirm(t, d.id)).toThrow(/mismatch/);
  l.db.close();
  l = new Ledger(path);
  expect(l.state(t).items[0].name).toBe("Rice");
  expect(l.confirm(t, a.id).id).toBe(l.state(t).events[0].id);
  l.db.close();
  rmSync(dir, { recursive: true });
});
