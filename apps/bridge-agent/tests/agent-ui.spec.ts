import { expect, test } from "@playwright/test";

test.describe("bridge agent renderer", () => {
  test("login flow renders status", async ({ page }) => {
    await page.goto("/");

    const emailInput = page.getByRole("textbox", { name: "Email" });
    const passwordInput = page.getByRole("textbox", { name: "Password" });
    const signInButton = page.getByRole("button", { name: "Sign in" });

    await expect(signInButton).toBeDisabled();

    await emailInput.fill("user@example.com");
    await passwordInput.fill("Password123");

    await expect(signInButton).toBeEnabled();
    await signInButton.click();

    await expect(page.getByText("Agent status and controls.")).toBeVisible();
    await expect(page.getByText("Agent ID: dev-agent-001")).toBeVisible();
    await expect(page.getByText("Connected")).toBeVisible();
  });
});
