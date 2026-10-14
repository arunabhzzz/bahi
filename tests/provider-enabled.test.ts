import { it, expect } from "vitest";
import { CompatibleProvider } from "../apps/server/src/agent/providers";

const config = {
  enabled: true,
  url: "http://127.0.0.1:9876/v1/chat/completions",
  model: "fixture",
  key: "fixture",
  maxCallsPerSession: 2,
};
const reply = (message: any) =>
  new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 });

it("calls MCP tools the model asks for, stops at a preview, and never lets the model confirm", async () => {
  const requests: any[] = [];
  const script = [
    { content: null, tool_calls: [{ id: "1", type: "function", function: { name: "confirm_operation", arguments: '{"operation":"x"}' } }] },
    { content: null, tool_calls: [{ id: "2", type: "function", function: { name: "record_sale", arguments: '{"items":[{"item":"sugar","quantity":2}]}' } }] },
  ];
  const fetcher: typeof fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init!.body)));
    return reply(script.shift());
  };
  const used: string[] = [];
  const p = new CompatibleProvider(config, fetcher);
  const out = await p.agent(
    "sold 2 kg sugar",
    "session",
    [
      { name: "record_sale", description: "sale", inputSchema: { type: "object" } },
      { name: "confirm_operation", description: "confirm", inputSchema: { type: "object" } },
    ],
    async (name, args) => {
      used.push(name);
      return { needsConfirmation: true, operation: "op", say: `Cash sale of ${args.items[0].quantity} kg sugar. Shall I record it?` };
    },
  );
  expect(used).toEqual(["record_sale"]);
  expect(out.text).toBe("Cash sale of 2 kg sugar. Shall I record it?");
  expect(out.calls[0]).toMatchObject({ name: "confirm_operation", error: expect_refused() });
  expect(requests[0].tools.map((t: any) => t.function.name)).toEqual(["record_sale"]);
  expect(requests[1].messages.at(-1).content).toMatch(/Refused/);
  await expect(p.agent("again", "session", [], async () => ({}))).rejects.toThrow(/limit/);
});

function expect_refused() {
  return "Refused: only the shopkeeper can confirm, by saying yes.";
}
