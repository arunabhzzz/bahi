import { it, expect } from "vitest";
import { exact } from "../packages/contracts/src/money";
it("parses money and milliunits without float rounding and rejects unsupported precision", () => {
  expect(exact("12.34", 2)).toBe(1234);
  expect(exact("1.125", 3)).toBe(1125);
  for (const s of ["-1", "1.234", "NaN", "9007199254740991"])
    expect(() => exact(s, 2)).toThrow();
});
