import { test, expect } from "@playwright/test";

test("typed yes cannot authorize an action that was never displayed", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("stock-Sugar")).toBeVisible();
  const token = await page.evaluate(() => sessionStorage.getItem("bahi-token"));
  await page.route("**/api/command", async (route) => {
    await route.fetch();
    await route.abort("failed");
  });
  await page.getByLabel("Your command").fill("sell 1 kg sugar to Ramesh paid 0");
  await page.getByRole("button", { name: "Send command", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.unroute("**/api/command");
  await expect(page.getByTestId("action-preview")).toHaveCount(0);
  const before = await page.request.get("/api/state", { headers: { Authorization: `Bearer ${token}` } });
  const version = (await before.json()).state.version;
  await page.getByLabel("Your command").fill("yes");
  await page.getByRole("button", { name: "Send command", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("No displayed preview");
  const after = await page.request.get("/api/state", { headers: { Authorization: `Bearer ${token}` } });
  expect((await after.json()).state.version).toBe(version);
});
