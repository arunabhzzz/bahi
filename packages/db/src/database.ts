import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
export function openDatabase(path: string) {
  const db = new DatabaseSync(path);
  db.exec(
    readFileSync(
      new URL("./migrations/001-ledger.sql", import.meta.url),
      "utf8",
    ),
  );
  return db;
}
