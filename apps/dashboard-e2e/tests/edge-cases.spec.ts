import { test, expect } from "@playwright/test";
import { DONGLES, STORAGE_STATE_PATH } from "../helpers/env";
import { selectors } from "../helpers/selectors";

test.describe("unauthenticated", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("protected routes redirect to login", async ({ page }) => {
    await page.goto("/dongles");

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });
});

test.describe("authenticated", () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  test("session expiry forces a login redirect", async ({ page }) => {
    await page.goto("/dongles");

    await page.context().clearCookies();
    await page.reload();

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  test("group creation validation errors surface in the UI", async ({ page }) => {
    await page.goto("/groups");

    await page.getByTestId(selectors.groupDongleA).click();
    await page.getByRole("option", { name: new RegExp(DONGLES.ownedA.deviceId) }).click();

    await page.getByTestId(selectors.groupDongleB).click();
    await page.getByRole("option", { name: new RegExp(DONGLES.ownedA.deviceId) }).click();

    await page.getByTestId(selectors.groupCreateSubmit).click();

    await expect(
      page.getByRole("alert").filter({ hasText: "Select two distinct dongles to create a group." })
    ).toBeVisible();
  });

  test("offline dongle pairing shows a 503 error", async ({ page }) => {
    await page.goto(`/dongles/${DONGLES.offline.id}`);

    await page.getByTestId(selectors.pairingStart).click();

    const alert = page.getByRole("alert").filter({ hasText: "Agent is offline." });
    await expect(alert).toBeVisible();
  });

  test("server errors render without crashing", async ({ page }) => {
    await page.route("**/api/v1/dongles", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          code: "INTERNAL_ERROR",
          message: "Unexpected error.",
        }),
      });
    });

    await page.goto("/dongles");

    await expect(
      page.getByRole("alert").filter({ hasText: "Unexpected error." })
    ).toBeVisible();
  });
});
