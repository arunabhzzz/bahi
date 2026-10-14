/**
 * Optional language-model mode for the browser simulator.
 *
 * Stands in for Alexa+: an OpenAI-compatible chat model receives the
 * shopkeeper's words plus the real MCP tool list, calls tools through the
 * MCP client, and narrates the result. It can preview changes but can never
 * confirm them — confirmation only comes from the shopkeeper ("yes" or the
 * button), handled outside the model.
 *
 * Enable with BAHI_MODEL_ENABLED=true plus BAHI_MODEL_URL (a
 * /chat/completions endpoint), BAHI_MODEL_KEY and BAHI_MODEL_NAME.
 */
import { SERVER_INSTRUCTIONS } from "../mcp/tools";

export type ProviderConfig = {
  enabled: boolean;
  url?: string;
  key?: string;
  model?: string;
  maxCallsPerSession?: number;
  maxCallsPerProcess?: number;
};
export type McpTool = { name: string; description?: string; inputSchema: any };
export type ToolCaller = (name: string, args: any) => Promise<any>;
export type Turn = { role: "user" | "assistant"; content: string };
export type AgentResult = {
  text: string;
  calls: { name: string; args: any; result?: any; error?: string }[];
};

const SIMULATOR_RULES = `You are the voice assistant in a shop, standing in for Alexa+. Keep replies to one or two short spoken sentences.
- When a tool returns a "say" field, base your reply on it; don't recompute numbers.
- After a preview, read its "say" text and stop. The shopkeeper confirms with "yes" or a button; you can't call confirm_operation.
- If a name is unknown or ambiguous, ask which one the shopkeeper meant.
- Never invent sales, customers or prices.`;

export class CompatibleProvider {
  private calls = new Map<string, number>();
  private total = 0;
  constructor(
    private config: ProviderConfig,
    private request: typeof fetch = fetch,
  ) {}
  get enabled() {
    return this.config.enabled;
  }
  private budget(session: string) {
    const perSession = this.config.maxCallsPerSession ?? 60;
    const perProcess = this.config.maxCallsPerProcess ?? 1000;
    const count = this.calls.get(session) ?? 0;
    if (count >= perSession || this.total >= perProcess)
      throw Error(
        `Language-model request limit reached (${perSession} per session, ${perProcess} per server run).`,
      );
    this.calls.set(session, count + 1);
    this.total++;
  }
  private check() {
    const c = this.config;
    if (!c.enabled) throw Error("Language-model mode is disabled");
    if (!c.url || !c.key || !c.model)
      throw Error("Set BAHI_MODEL_URL, BAHI_MODEL_KEY and BAHI_MODEL_NAME");
    const url = new URL(c.url);
    if (
      url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))
    )
      throw Error("Model endpoint must use HTTPS (or local http)");
    return url;
  }
  async agent(
    text: string,
    session: string,
    tools: McpTool[],
    callTool: ToolCaller,
    history: Turn[] = [],
    maxSteps = 4,
  ): Promise<AgentResult> {
    const url = this.check();
    if (text.length > 1000) throw Error("Input limit");
    const messages: any[] = [
      { role: "system", content: `${SERVER_INSTRUCTIONS}\n\n${SIMULATOR_RULES}` },
      ...history.slice(-6),
      { role: "user", content: text },
    ];
    const functions = tools
      .filter((t) => t.name !== "confirm_operation")
      .map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description ?? "", parameters: t.inputSchema },
      }));
    const calls: AgentResult["calls"] = [];
    for (let step = 0; step < maxSteps; step++) {
      this.budget(session);
      const response = await this.request(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.key}`,
        },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          model: this.config.model,
          temperature: 0,
          max_tokens: 400,
          messages,
          tools: functions,
          tool_choice: "auto",
        }),
      });
      if (!response.ok) throw Error(`Model HTTP ${response.status}; nothing was recorded`);
      const raw = await response.text();
      if (raw.length > 64000) throw Error("Model response too large");
      const message = JSON.parse(raw).choices?.[0]?.message;
      if (!message) throw Error("Empty model response");
      const toolCalls: any[] = message.tool_calls ?? [];
      if (!toolCalls.length)
        return { text: String(message.content ?? "").trim() || "Done.", calls };
      messages.push({ role: "assistant", content: message.content ?? null, tool_calls: toolCalls });
      for (const call of toolCalls) {
        const name = call.function?.name;
        let args: any = {};
        try {
          args = JSON.parse(call.function?.arguments || "{}");
        } catch {
          args = {};
        }
        let content: string;
        if (name === "confirm_operation") {
          content = "Refused: only the shopkeeper can confirm, by saying yes.";
          calls.push({ name, args, error: content });
        } else {
          try {
            const result = await callTool(name, args);
            calls.push({ name, args, result });
            content = JSON.stringify(result).slice(0, 6000);
          } catch (e) {
            content = `Error: ${(e as Error).message}`;
            calls.push({ name, args, error: (e as Error).message });
          }
        }
        messages.push({ role: "tool", tool_call_id: call.id, content });
      }
      // A preview ends the turn: the shopkeeper has to answer it.
      const last = calls.at(-1);
      if (last?.result?.needsConfirmation) return { text: last.result.say, calls };
    }
    const last = calls.at(-1);
    return { text: last?.result?.say ?? last?.error ?? "Sorry, I couldn't finish that.", calls };
  }
}

export function configuredProvider() {
  return new CompatibleProvider({
    enabled: process.env.BAHI_MODEL_ENABLED === "true",
    url: process.env.BAHI_MODEL_URL,
    key: process.env.BAHI_MODEL_KEY,
    model: process.env.BAHI_MODEL_NAME,
    maxCallsPerSession: Number(process.env.BAHI_MODEL_MAX_CALLS_PER_SESSION) || undefined,
    maxCallsPerProcess: Number(process.env.BAHI_MODEL_MAX_CALLS) || undefined,
  });
}
