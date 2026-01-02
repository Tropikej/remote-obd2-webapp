import { test, expect } from "@playwright/test";
import { DONGLES, STORAGE_STATE_PATH, USERS } from "../helpers/env";
import { dongleViewButton, selectors } from "../helpers/selectors";

test.describe("authenticated", () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  test("loads the seeded dongle list", async ({ page }) => {
    await page.goto("/dongles");

    await expect(page.getByText(DONGLES.ownedA.deviceId)).toBeVisible();
    await expect(page.getByText(DONGLES.ownedB.deviceId)).toBeVisible();
    await expect(page.getByTestId(dongleViewButton(DONGLES.ownedA.deviceId))).toBeVisible();
  });

  test("creates a new group", async ({ page }) => {
    await page.goto("/groups");

    await page.getByTestId(selectors.groupDongleA).click();
    await page.getByRole("option", { name: new RegExp(DONGLES.ownedA.deviceId) }).click();

    await page.getByTestId(selectors.groupDongleB).click();
    await page.getByRole("option", { name: new RegExp(DONGLES.ownedB.deviceId) }).click();

    await page.getByTestId(selectors.groupCreateSubmit).click();

    await expect(
      page.getByText("Group created. Activate it to start relaying.")
    ).toBeVisible();
  });
});

test.describe("logout", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("logout clears the session", async ({ page }) => {
    await page.goto("/login");

    await page.getByTestId(selectors.loginEmail).fill(USERS.standard.email);
    await page.getByTestId(selectors.loginPassword).fill(USERS.standard.password);
    await Promise.all([
      page.waitForURL("**/dongles"),
      page.getByTestId(selectors.loginSubmit).click(),
    ]);

    await page.getByTestId(selectors.navLogout).click();

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });
});
