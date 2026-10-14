/**
 * Walks a fresh synthetic shop through the demo conversation against a
 * running local server, over the real HTTP API and MCP endpoint, and writes
 * docs/evidence/live-mcp.json. Usage: npm start, then npm run verify:local
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";

const base = process.env.BAHI_URL ?? "http://127.0.0.1:4317";
assert(["127.0.0.1", "localhost"].includes(new URL(base).hostname), "Local only; use npm run check:mcp for a deployed server");
const session = await fetch(base + "/api/session", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: '{"seed":true}',
});
assert.equal(session.status, 200);
const { token } = await session.json();
const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

const client = new Client({ name: "bahi-verifier", version: "2.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(base + "/mcp"), { requestInit: { headers } }));
const { tools } = await client.listTools();
await client.close();

const turns: any[] = [];
let latest: any;
const say = async (text: string, expect?: RegExp) => {
  const start = performance.now();
  const response = await fetch(base + "/api/command", {
    method: "POST",
    headers,
    body: JSON.stringify({ text, requestId: randomUUID() }),
  });
  const result = await response.json();
  assert.equal(response.status, 200, `${text}: ${JSON.stringify(result)}`);
  if (expect) assert.match(result.message, expect, text);
  turns.push({
    text,
    tools: result.tools,
    mode: result.mode,
    reply: result.message,
    elapsedMs: Math.round(performance.now() - start),
  });
  latest = result;
  return result;
};
const sugar = () => latest.state.items.find((i: any) => i.name === "Sugar").stock;

await say("Sold 2 kg cheeni to Ramesh, he paid 30", /^Sale to Ramesh: 2 kg Sugar/);
const before = sugar();
await say("yes", /^Recorded/);
assert.equal(sugar(), before - 2000);
await say("no, that was 1 kg", /^Change the/);
await say("yes", /^Corrected/);
await say("Who owes me money?", /owe you/);
await say("Why were sales down on Tuesday?", /Ramesh/);
await say("What's running low?");
await say("Who's a credit risk?", /Farooq/);
await say("Show me last month by item", /Last 30 days/);
await say("plan budget 2000 reserve 500 fee 0");
await say("leave out biscuits");
await say("save it");
await say("yes", /Order draft saved/);

const samples = turns.map((t) => t.elapsedMs).sort((a, b) => a - b);
const report = {
  generatedAt: new Date().toISOString(),
  base,
  synthetic: true,
  tools: tools.map((t) => ({ name: t.name, description: t.description })),
  turns,
  p95CommandMs: samples[Math.ceil(samples.length * 0.95) - 1],
};
mkdirSync("docs/evidence", { recursive: true });
writeFileSync("docs/evidence/live-mcp.json", JSON.stringify(report, null, 2));
for (const t of turns) console.log(`> ${t.text}\n  ${t.reply}`);
console.log(`\n${tools.length} tools · ${turns.length} turns · p95 ${report.p95CommandMs} ms · docs/evidence/live-mcp.json`);
