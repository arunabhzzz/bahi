import { it, expect } from "vitest";
import { Ledger } from "../packages/domain/src/ledger";
import { seedDemo } from "../apps/server/src/seed";
import { backup, restore } from "../packages/db/src/backup";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
it("creates consistent SQLite online backup and restores to a new path without overwriting work", () => {
  const dir = mkdtempSync(join(tmpdir(), "bahi-backup-")),
    live = join(dir, "live.sqlite"),
    copy = join(dir, "copy.sqlite"),
    destination = join(dir, "restore.sqlite");
  const l = new Ledger(live),
    t = l.session();
  seedDemo(l, t);
  const expected = l.state(t);
  backup(live, copy);
  restore(copy, destination);
  const recovered = new Ledger(destination);
  expect(recovered.state(t)).toEqual(expected);
  expect(() => restore(copy, destination)).toThrow(/exists/);
  recovered.db.close();
  l.db.close();
  rmSync(dir, { recursive: true });
});
