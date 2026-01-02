import { test, expect } from "@playwright/test";
import { USERS } from "../helpers/env";
import { selectors } from "../helpers/selectors";

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("auth", () => {
  test("login flow establishes a session", async ({ page }) => {
    await page.goto("/login");

    await page.getByTestId(selectors.loginEmail).fill(USERS.standard.email);
    await page.getByTestId(selectors.loginPassword).fill(USERS.standard.password);

    await Promise.all([
      page.waitForURL("**/dongles"),
      page.getByTestId(selectors.loginSubmit).click(),
    ]);

    await expect(page.getByRole("heading", { name: "Dongles" })).toBeVisible();
  });

  test("invalid login credentials show an error", async ({ page }) => {
    await page.goto("/login");

    await page.getByTestId(selectors.loginEmail).fill(USERS.standard.email);
    await page.getByTestId(selectors.loginPassword).fill("wrong-password");
    await page.getByTestId(selectors.loginSubmit).click();

    await expect(page.getByRole("alert")).toContainText("Email or password is incorrect.");
  });

  test("disabled accounts are rejected", async ({ page }) => {
    await page.goto("/login");

    await page.getByTestId(selectors.loginEmail).fill(USERS.disabled.email);
    await page.getByTestId(selectors.loginPassword).fill(USERS.disabled.password);
    await page.getByTestId(selectors.loginSubmit).click();

    await expect(page.getByRole("alert")).toContainText("User is disabled.");
  });
});

test.describe("signup", () => {
  test("duplicate signup is rejected", async ({ page }) => {
    await page.goto("/signup");

    await page.getByTestId(selectors.signupEmail).fill(USERS.standard.email);
    await page.getByTestId(selectors.signupPassword).fill(USERS.standard.password);
    await page.getByTestId(selectors.signupConfirm).fill(USERS.standard.password);
    await page.getByTestId(selectors.signupSubmit).click();

    await expect(page.getByRole("alert")).toContainText("Email already in use.");
  });
});
