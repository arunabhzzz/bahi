import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Ledger } from "../packages/domain/src/ledger";
import { seedDemo } from "../apps/server/src/seed";
const path = resolve(process.env.BAHI_DB ?? "data/bahi.sqlite");
mkdirSync(dirname(path), { recursive: true });
const ledger = new Ledger(path);
const token = ledger.session();
const state = seedDemo(ledger, token);
const credentials = resolve("data/demo-session.json");
mkdirSync(dirname(credentials), { recursive: true });
writeFileSync(
  credentials,
  JSON.stringify({ token, synthetic: true, expiresInHours: 24 }, null, 2),
  { mode: 0o600 },
);
ledger.db.close();
console.log(
  `Seeded isolated synthetic shop: ${state.version} events, ${state.items.length} products, 28 days. Local credential file: ${credentials} (do not publish). Browser creates its own isolated shop.`,
);
