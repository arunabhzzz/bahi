import { test, expect } from "@playwright/test";
import { kg, say } from "./helpers";

test("the displayed preview ID is sent by the button and by typed yes, never an unseen replacement", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("stock-Sugar")).toBeVisible();
  const start = await kg(page);
  await say(page, "sell 1 kg sugar to Ramesh paid 0");
  const preview = page.getByTestId("action-preview");
  await expect(preview).toContainText("₹48");
  const shownId = (await preview.locator("small").innerText()).match(/Operation ([\w-]+)/)![1];
  // Process B through real MCP, then drop its response: the UI still displays A.
  await page.route("**/api/command", async (route) => {
    await route.fetch();
    await route.abort("failed");
  });
  await page.getByLabel("Your command").fill("sell 2 kg sugar to Ramesh paid 0");
  await page.getByRole("button", { name: "Send command", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.unroute("**/api/command");
  await expect(preview).toContainText("₹48");
  const token = await page.evaluate(() => sessionStorage.getItem("bahi-token"));
  const unseen = await page.request.get("/api/state", { headers: { Authorization: `Bearer ${token}` } });
  const before = await unseen.json();
  expect(before.context.pending.id).not.toBe(shownId);
  for (const typed of [false, true]) {
    const request = page.waitForRequest(
      (r) => r.url().endsWith("/api/command") && /^(confirm|haan)$/.test(r.postDataJSON().text),
    );
    if (typed) await say(page, "haan");
    else await page.getByRole("button", { name: "Yes, record it" }).click();
    expect((await request).postDataJSON().confirmationOperation).toBe(shownId);
    await expect(page.getByRole("alert")).toContainText("Preview changed");
    const state = await page.request.get("/api/state", { headers: { Authorization: `Bearer ${token}` } });
    expect((await state.json()).state.version).toBe(before.state.version);
    expect(await kg(page)).toBe(start);
  }
});
