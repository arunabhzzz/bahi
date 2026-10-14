import { seedDemo } from "./seed";
import {
  command,
  initContexts,
  getContext,
  publicContext,
} from "./agent/orchestrator";
import { z } from "zod";
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Ledger } from "../../../packages/domain/src/ledger";
import { mcpServer } from "./mcp/server";
/** Words that confirm the preview currently on screen. */
export const CONFIRM_WORDS =
  /^\s*(confirm|yes|yes yes|yeah|yep|haan|haa|han|haan ji|ok|okay|theek hai|thik hai|sahi hai|record it|do it|go ahead|sure)[\s.!]*$/i;

export type AppOptions = {
  sessionLimit?: number;
  /** Extra host names allowed in the Host header (e.g. your public domain). */
  allowedHosts?: string[];
};

export function allowedHostsFromEnv() {
  const hosts = (process.env.BAHI_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (process.env.BAHI_PUBLIC_URL)
    hosts.push(new URL(process.env.BAHI_PUBLIC_URL).host.toLowerCase());
  return hosts;
}

export function createApp(ledger: Ledger, options: AppOptions = {}) {
  const app = express();
  app.disable("x-powered-by");
  if (process.env.BAHI_TRUST_PROXY === "true") app.set("trust proxy", 1);
  app.use(express.json({ limit: "32kb" }));
  app.locals.protocols = [];
  app.locals.trace = [];
  const extraHosts = new Set(options.allowedHosts ?? allowedHostsFromEnv());
  app.use((req, res, next) => {
    // Host allow-list blocks DNS-rebinding attacks on the local server.
    const host = (req.headers.host ?? "").toLowerCase();
    const local = /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host);
    if (!local && !extraHosts.has(host) && !extraHosts.has(host.replace(/:\d+$/, "")))
      return res.status(403).json({ error: "Invalid host" });
    if (
      req.headers.origin &&
      ![`http://${host}`, `https://${host}`].includes(req.headers.origin)
    )
      return res.status(403).json({ error: "Invalid origin" });
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  const limits = new Map<string, { count: number; until: number }>();
  const allowed = (key: string, max: number) => {
    const now = Date.now();
    for (const [k, v] of limits) if (v.until < now) limits.delete(k);
    let value = limits.get(key);
    if (!value) {
      value = { count: 0, until: now + 60000 };
      limits.set(key, value);
    }
    return ++value.count <= max;
  };
  app.use((req, res, next) => {
    const key =
      req.path === "/api/session"
        ? `session:${req.socket.remoteAddress}`
        : `requests:${req.headers.authorization ?? req.socket.remoteAddress}`;
    if (
      !allowed(
        key,
        req.path === "/api/session" ? (options.sessionLimit ?? 30) : 600,
      )
    ) {
      res.setHeader("Retry-After", "60");
      return res.status(429).json({
        error: "Local demo request limit reached; retry in one minute",
      });
    }
    next();
  });
  app.get("/health", (_req, res) =>
    res.json({ ok: true, mode: "synthetic demo", mcp: "/mcp" }),
  );
  app.all("/mcp", async (req, res) => {
    const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    try {
      ledger.scope(token);
    } catch {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res
        .status(405)
        .json({ error: "Standalone SSE not offered in stateless mode" });
    }
    if (req.body?.method === "initialize")
      app.locals.protocols.push(req.body.params?.protocolVersion);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const server = mcpServer(ledger, token, (name) => {
      app.locals.trace.push({ name, at: new Date().toISOString() });
      if (app.locals.trace.length > 1000) app.locals.trace.shift();
    });
    await server.connect(transport);
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await transport.handleRequest(req, res, req.body);
  });
  initContexts(ledger);
  ledger.db.exec(
    "CREATE TABLE IF NOT EXISTS requests(id TEXT NOT NULL,token TEXT NOT NULL,text TEXT NOT NULL,operation TEXT,response TEXT,PRIMARY KEY(id,token))",
  );
  if (
    !(ledger.db.prepare("PRAGMA table_info(requests)").all() as any[]).some(
      (column) => column.name === "binding",
    )
  )
    ledger.db.exec("ALTER TABLE requests ADD COLUMN binding TEXT");
  app.post("/api/session", (req, res) => {
    try {
      const { seed } = z
        .object({ seed: z.boolean().default(true) })
        .strict()
        .parse(req.body);
      const token = ledger.session();
      if (seed) seedDemo(ledger, token);
      res.json({ token, synthetic: true });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });
  app.use("/api", (req, res, next) => {
    try {
      ledger.scope((req.headers.authorization ?? "").replace(/^Bearer /, ""));
      next();
    } catch {
      res.status(401).json({ error: "Unauthorized" });
    }
  });
  const tokenOf = (req: express.Request) =>
    (req.headers.authorization ?? "").replace(/^Bearer /, "");
  const internal = (req: express.Request) =>
    `http://127.0.0.1:${req.socket.localPort}`;
  // Read-only view for the side panel. All changes still go through MCP.
  app.get("/api/state", (req, res) => {
    try {
      const token = tokenOf(req);
      res.json({
        state: ledger.state(token),
        context: publicContext(getContext(ledger, token)),
      });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });
  const busy = new Set<string>();
  app.post("/api/command", async (req, res) => {
    const token = tokenOf(req);
    if (busy.has(token))
      return res.status(409).json({ error: "Another command is in progress" });
    busy.add(token);
    try {
      const { text, requestId, confirmationOperation } = z
        .object({
          text: z.string().min(1).max(1000),
          requestId: z.uuid().optional(),
          confirmationOperation: z.uuid().optional(),
        })
        .strict()
        .parse(req.body);
      let request: any;
      const confirming = CONFIRM_WORDS.test(text);
      if (confirmationOperation && !confirming)
        throw Error("Confirmation binding requires confirm");
      const pendingId = getContext(ledger, token).pending?.id;
      if (requestId) {
        request = ledger.db
          .prepare("SELECT * FROM requests WHERE id=? AND token=?")
          .get(requestId, token);
        if (
          request &&
          (request.text !== text ||
            (request.binding ?? undefined) !== confirmationOperation)
        )
          return res
            .status(409)
            .json({ error: "Retry key used with different payload" });
        if (request?.response) {
          const response = JSON.parse(request.response);
          const context = getContext(ledger, token);
          return res.json({
            ...response,
            state: ledger.state(token),
            context: publicContext(context),
            pending: context.pending,
            retried: true,
          });
        }
        if (!request) {
          const operation =
            confirming &&
            (!confirmationOperation || confirmationOperation === pendingId)
              ? pendingId
              : undefined;
          ledger.db
            .prepare(
              "INSERT INTO requests(id,token,text,operation,response,binding) VALUES(?,?,?,?,NULL,?)",
            )
            .run(
              requestId,
              token,
              text,
              operation ?? null,
              confirmationOperation ?? null,
            );
          request = { operation };
        }
      }
      // A persisted NULL means the original request authorized nothing. Never
      // resolve a retry against whatever preview happens to be pending now.
      if (confirming && request && !request.operation)
        throw Error(
          confirmationOperation
            ? "Preview changed. Review the current action before confirming"
            : "No preview was authorized by this request",
        );
      if (
        confirming &&
        !request &&
        confirmationOperation &&
        confirmationOperation !== pendingId
      )
        throw Error(
          "Preview changed. Review the current action before confirming",
        );
      const response = await command(
        ledger,
        internal(req),
        token,
        text,
        confirming ? (request?.operation ?? confirmationOperation) : undefined,
      );
      if (requestId)
        ledger.db
          .prepare("UPDATE requests SET response=? WHERE id=? AND token=?")
          .run(JSON.stringify(response), requestId, token);
      res.json(response);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    } finally {
      busy.delete(token);
    }
  });
  return app;
}
