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

  test("server settings updates api url", async ({ page }) => {
    await page.goto("/");

    const apiInput = page.getByRole("textbox", { name: "API base URL" });
    const saveButton = page.getByRole("button", { name: "Save settings" });

    await apiInput.fill("https://example.com");
    await saveButton.click();

    await page.getByRole("textbox", { name: "Email" }).fill("user@example.com");
    await page.getByRole("textbox", { name: "Password" }).fill("Password123");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByText("API: https://example.com")).toBeVisible();
  });
});
