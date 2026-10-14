import { it, expect } from "vitest";
import { resolveName } from "../packages/domain/src/names";

const items = [
  { id: "1", name: "Sugar" },
  { id: "2", name: "Toor Dal" },
  { id: "3", name: "Mustard Oil", aliases: ["oil bottle"] },
  { id: "4", name: "Hair Oil" },
  { id: "5", name: "Eggs" },
];
const people = [{ name: "Ramesh" }, { name: "Ramesh Kumar" }, { name: "Meena" }];

it("matches items by case, plural, Hinglish alias, partial name and close spelling", () => {
  const name = (s: string) => resolveName(items, s, "item").name;
  expect(name("sugar")).toBe("Sugar");
  expect(name("SUGAR")).toBe("Sugar");
  expect(name("cheeni")).toBe("Sugar");
  expect(name("chini")).toBe("Sugar");
  expect(name("dal")).toBe("Toor Dal");
  expect(name("egg")).toBe("Eggs");
  expect(name("ande")).toBe("Eggs");
  expect(name("shugar")).toBe("Sugar");
  expect(name("oil bottle")).toBe("Mustard Oil");
  expect(name("1")).toBe("Sugar");
});

it("asks instead of guessing when a name is ambiguous or unknown", () => {
  expect(() => resolveName(items, "oil", "item")).toThrow(/Mustard Oil or Hair Oil/);
  expect(() => resolveName(items, "paneer", "item")).toThrow(/don't have an item/);
  expect(resolveName(people, "ramesh", "customer").name).toBe("Ramesh");
  expect(resolveName(people, "kumar", "customer").name).toBe("Ramesh Kumar");
  expect(resolveName(people, "meenaa", "customer").name).toBe("Meena");
  expect(() => resolveName(people, "suresh", "customer")).toThrow(/don't have a customer/);
});
