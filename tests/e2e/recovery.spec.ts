import { test, expect } from "@playwright/test";
import { kg, say } from "./helpers";

test("refresh keeps the pending preview; a lost confirm response recovers without double-counting", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("stock-Sugar")).toBeVisible();
  const start = await kg(page);
  await say(page, "sell 1 kg sugar to Ramesh paid 0");
  await expect(page.getByRole("button", { name: "Yes, record it" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Yes, record it" })).toBeVisible();
  await page.route("**/api/command", async (route) => {
    await route.fetch();
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Yes, record it" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.unroute("**/api/command");
  await page.getByRole("button", { name: "Retry same request" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(await kg(page)).toBe(start - 1);
  await page.reload();
  expect(await kg(page)).toBe(start - 1);
});
