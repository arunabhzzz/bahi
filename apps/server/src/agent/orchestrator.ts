/**
 * The browser simulator's "assistant". It plays the part Alexa+ plays in
 * production: understand the shopkeeper, call Bahi's MCP tools over real
 * Streamable HTTP, and reply in a sentence. Every read and write goes
 * through the MCP server; the ledger is only read directly to draw the
 * side panel.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { configuredProvider, type Turn } from "./providers";
import { parseCommand, type Context } from "./parser";
import type { Ledger } from "../../../../packages/domain/src/ledger";

const provider = configuredProvider();

export async function withMcp<T>(
  url: string,
  token: string,
  work: (
    call: (name: string, args: any) => Promise<any>,
    client: Client,
  ) => Promise<T>,
) {
  const client = new Client({ name: "bahi-simulator", version: "2.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url + "/mcp"), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  try {
    return await work(async (name, args) => {
      const result = await client.callTool(
        { name, arguments: args },
        undefined,
        { timeout: 10000 },
      );
      if (result.isError) throw Error((result.content as any[])[0].text);
      return (
        result.structuredContent ??
        JSON.parse((result.content as any[])[0].text)
      );
    }, client);
  } finally {
    await client.close();
  }
}
export function initContexts(ledger: Ledger) {
  ledger.db.exec(
    "CREATE TABLE IF NOT EXISTS contexts(token TEXT PRIMARY KEY,data TEXT NOT NULL)",
  );
}
export function getContext(ledger: Ledger, token: string): Context & { history?: Turn[] } {
  const row = ledger.db
    .prepare("SELECT data FROM contexts WHERE token=?")
    .get(token) as any;
  return row ? JSON.parse(row.data) : {};
}
const YES_NO =
  /^\s*(confirm|yes|yes yes|yeah|yep|haan|haa|ha|han|haan ji|ok|okay|theek hai|thik hai|sahi hai|correct|record it|save it|do it|go ahead|sure|no|nahi|nahin|na|discard|cancel it|cancel that|don'?t|leave it|rehne do|chhodo|forget it|stop)[\s.!]*$/i;

export async function command(
  ledger: Ledger,
  url: string,
  token: string,
  text: string,
  confirmationOperation?: string,
) {
  const context = getContext(ledger, token);
  return withMcp(url, token, async (call, client) => {
    const state = ledger.state(token);
    const results: { tool: string; result: any }[] = [];
    let message = "";
    let mode = "built-in phrase parser";
    if (confirmationOperation) {
      results.push({
        tool: "confirm_operation",
        result: await call("confirm_operation", { operation: confirmationOperation }),
      });
    } else if (provider.enabled && !YES_NO.test(text)) {
      mode = "language model";
      const { tools } = await client.listTools();
      const out = await provider.agent(
        text,
        token,
        tools as any,
        async (name, args) => {
          const result = await call(name, args);
          results.push({ tool: name, result });
          return result;
        },
        context.history ?? [],
      );
      message = out.text;
    } else {
      const parsed = parseCommand(text, state, context);
      results.push({ tool: parsed.tool, result: await call(parsed.tool, parsed.args) });
    }

    let receipt: any, plan: any, previous: any, insight: any;
    for (const { tool, result } of results) {
      if (tool === "discard_operation") context.pending = undefined;
      else if (tool === "confirm_operation") {
        receipt = result.receipt;
        context.pending = undefined;
        if (receipt.kind === "save_order_draft") {
          context.lastDraft = receipt.id;
          context.plan = undefined;
        }
      } else if (tool === "plan_restock" || tool === "revise_plan") {
        previous = context.plan;
        plan = result;
        context.plan = result;
        context.pending = undefined;
      } else if (result?.needsConfirmation) {
        context.pending = {
          id: result.operation,
          kind: result.kind,
          data: result.data,
          say: result.say,
          version: result.version,
        };
      }
      if (result?.chart || ["who_owes", "check_stock", "recent_entries"].includes(tool))
        insight = { tool, ...result };
    }
    const last = results.at(-1);
    if (!message) message = last?.result?.say ?? "Done.";
    context.history = [
      ...(context.history ?? []),
      { role: "user" as const, content: text },
      { role: "assistant" as const, content: message },
    ].slice(-8);
    ledger.db
      .prepare(
        "INSERT INTO contexts VALUES(?,?) ON CONFLICT(token) DO UPDATE SET data=excluded.data",
      )
      .run(token, JSON.stringify(context));
    return {
      message,
      mode,
      tool: last?.tool,
      tools: results.map((r) => r.tool),
      pending: context.pending,
      plan,
      previous,
      receipt,
      insight,
      state: ledger.state(token),
      context: publicContext(context),
    };
  });
}

/** What the browser needs (no conversation history). */
export function publicContext(context: any) {
  const { history, ...rest } = context ?? {};
  return rest;
}
