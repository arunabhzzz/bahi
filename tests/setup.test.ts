import { it, expect } from "vitest";
import { Ledger } from "../packages/domain/src/ledger";
it("shop setup confirms explicit name INR and timezone and rejects currency mixing", () => {
  const l = new Ledger(":memory:"),
    t = l.session();
  const operation = l.preview(t, "configure_shop", {
    name: "Synthetic Sharma Store",
    currency: "INR",
    timezone: "Asia/Kolkata",
  });
  expect(l.state(t).shop.name).not.toBe("Synthetic Sharma Store");
  l.confirm(t, operation.id);
  expect(l.state(t).shop).toEqual({
    name: "Synthetic Sharma Store",
    currency: "INR",
    timezone: "Asia/Kolkata",
  });
  expect(() =>
    l.preview(t, "configure_shop", {
      name: "Store",
      currency: "USD",
      timezone: "UTC",
    }),
  ).toThrow();
});
