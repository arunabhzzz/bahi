import { it, expect } from "vitest";
import { CompatibleProvider } from "../apps/server/src/agent/providers";

it("language-model mode fails closed when disabled or unconfigured and never calls the network", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    throw Error("no network");
  };
  const off = new CompatibleProvider({ enabled: false }, fetcher);
  await expect(off.agent("hi", "s", [], async () => ({}))).rejects.toThrow(/disabled/);
  const unconfigured = new CompatibleProvider({ enabled: true }, fetcher);
  await expect(unconfigured.agent("hi", "s", [], async () => ({}))).rejects.toThrow(/BAHI_MODEL_URL/);
  const plainHttp = new CompatibleProvider(
    { enabled: true, url: "http://example.com/v1/chat/completions", key: "k", model: "m" },
    fetcher,
  );
  await expect(plainHttp.agent("hi", "s", [], async () => ({}))).rejects.toThrow(/HTTPS/);
  expect(calls).toBe(0);
});
