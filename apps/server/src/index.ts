import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import express from "express";
import { createApp } from "./app";
import { seedDemo } from "./seed";
import { Ledger } from "../../../packages/domain/src/ledger";

const path = resolve(process.env.BAHI_DB ?? "data/bahi.sqlite");
mkdirSync(dirname(path), { recursive: true });
const ledger = new Ledger(path);

// A fixed secret that an MCP client such as Alexa+ sends as
// "Authorization: Bearer <token>". It maps to one shop, created on first run
// (seeded with the synthetic demo unless BAHI_CONNECTOR_SEED=false).
const connector = process.env.BAHI_CONNECTOR_TOKEN;
if (connector) {
  if (connector.length < 32)
    throw Error("BAHI_CONNECTOR_TOKEN must be at least 32 characters");
  const created = ledger.ensureSession(connector);
  if (created && process.env.BAHI_CONNECTOR_SEED !== "false")
    seedDemo(ledger, connector);
  console.log(
    `MCP connector shop ${created ? "created" : "ready"}: POST /mcp with the connector token.`,
  );
}

const app = createApp(ledger);
const port = Number(process.env.PORT ?? 4317);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw Error("Invalid PORT");
// Loopback only by default. Set BAHI_HOST=0.0.0.0 behind HTTPS hosting.
const host = process.env.BAHI_HOST ?? "127.0.0.1";
if (host !== "127.0.0.1" && !process.env.BAHI_PUBLIC_URL && !process.env.BAHI_ALLOWED_HOSTS)
  console.warn(
    "Listening beyond loopback without BAHI_PUBLIC_URL/BAHI_ALLOWED_HOSTS: requests with other Host headers will be refused.",
  );
if (process.env.NODE_ENV === "production") {
  app.use(express.static(resolve("dist")));
  app.get("/", (_req, res) => res.sendFile(resolve("dist/index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    configFile: resolve("apps/web/vite.config.ts"),
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
const server = app.listen(port, host, () =>
  console.log(
    `Bahi: http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}${process.env.BAHI_PUBLIC_URL ? ` (public: ${process.env.BAHI_PUBLIC_URL}/mcp)` : ""}`,
  ),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(() => {
      ledger.db.close();
      process.exit(0);
    }),
  );
