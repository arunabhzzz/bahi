import { DatabaseSync } from "node:sqlite";
import { existsSync, copyFileSync, constants, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
export function backup(source: string, destination: string) {
  if (!existsSync(source)) throw Error("Source does not exist");
  if (existsSync(destination))
    throw Error("Destination exists; choose a new path");
  mkdirSync(dirname(resolve(destination)), { recursive: true });
  const db = new DatabaseSync(source);
  try {
    db.exec(`VACUUM INTO '${resolve(destination).replaceAll("'", "''")}'`);
  } finally {
    db.close();
  }
}
export function restore(source: string, destination: string) {
  if (
    existsSync(destination) ||
    existsSync(destination + "-wal") ||
    existsSync(destination + "-shm")
  )
    throw Error("Destination exists; stop service and use a new path");
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    const row = db.prepare("PRAGMA integrity_check").get() as any;
    if (row.integrity_check !== "ok")
      throw Error("Backup integrity check failed");
  } finally {
    db.close();
  }
  mkdirSync(dirname(resolve(destination)), { recursive: true });
  copyFileSync(source, destination, constants.COPYFILE_EXCL);
}
