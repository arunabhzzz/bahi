import { expect, type Page } from "@playwright/test";

export const kg = async (page: Page, item = "Sugar") =>
  Number((await page.getByTestId("stock-" + item).locator("b").innerText()).split(" ")[0]);

export async function say(page: Page, text: string) {
  await page.getByLabel("Your command").fill(text);
  await page.getByRole("button", { name: "Send command", exact: true }).click();
  await expect(page.getByRole("button", { name: "Send command", exact: true })).toBeEnabled();
}
export async function yes(page: Page) {
  await page.getByRole("button", { name: "Yes, record it" }).click();
  await expect(page.getByRole("button", { name: "Yes, record it" })).toHaveCount(0);
}
