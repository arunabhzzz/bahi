import { test, expect } from "@playwright/test";

test("speech consent and permission-denial states leave typing usable", async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).SpeechRecognition = class {};
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => {
        throw new DOMException("Denied by test fixture", "NotAllowedError");
      },
    });
  });
  await page.goto("/");
  await expect(page.getByTestId("stock-Sugar")).toBeVisible();
  await page.getByRole("button", { name: "Use microphone" }).click();
  await expect(page.getByRole("alert")).toContainText("Consent");
  await page.getByText("Speech privacy & things to say").click();
  await page.getByLabel("I consent to browser speech processing for this session").check();
  await page.getByRole("button", { name: "Use microphone" }).click();
  await expect(page.getByRole("alert")).toContainText("permission denied");
  await page.getByLabel("Your command").fill("how much rice do I have");
  await page.getByRole("button", { name: "Send command", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByTestId("insight")).toContainText(/Rice: \d+ kg in stock/);
});

test("unsupported speech is labelled; balances can be hidden on a shared screen", async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).SpeechRecognition = undefined;
    (window as any).webkitSpeechRecognition = undefined;
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Microphone unavailable" })).toBeVisible();
  await page.getByLabel("Your command").fill("who owes me money");
  await page.getByRole("button", { name: "Send command", exact: true }).click();
  await expect(page.getByTestId("insight")).toContainText("Farooq");
  await page.getByLabel("Show customer balances").uncheck();
  await expect(page.getByText("Balances hidden.")).toBeVisible();
});
