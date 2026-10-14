import { it, expect } from "vitest";
import { request } from "node:http";
import { createApp } from "../apps/server/src/app";
import { Ledger } from "../packages/domain/src/ledger";

const get = (port: number, host: string) =>
  new Promise<number>((resolve, reject) =>
    request({ port, host: "127.0.0.1", path: "/health", headers: { Host: host } }, (res) => {
      res.resume();
      resolve(res.statusCode!);
    })
      .on("error", reject)
      .end(),
  );

it("accepts the configured public host for Alexa+ and still refuses others", async () => {
  const l = new Ledger(":memory:");
  const server = createApp(l, { allowedHosts: ["bahi.example.com"] }).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const port = (server.address() as any).port;
  try {
    expect(await get(port, "bahi.example.com")).toBe(200);
    expect(await get(port, `127.0.0.1:${port}`)).toBe(200);
    expect(await get(port, "evil.example.com")).toBe(403);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    l.db.close();
  }
});
