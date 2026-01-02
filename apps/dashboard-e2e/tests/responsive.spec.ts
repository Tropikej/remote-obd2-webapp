import { test, expect } from "@playwright/test";
import { STORAGE_STATE_PATH } from "../helpers/env";
import { selectors } from "../helpers/selectors";

const mobileViewport = { width: 390, height: 844 };

test.describe("mobile navigation", () => {
  test.use({ viewport: mobileViewport });

  test.describe("authenticated", () => {
    test.use({ storageState: STORAGE_STATE_PATH });

    test("hamburger drawer navigates between pages", async ({ page }) => {
      await page.goto("/dongles");

      await expect(page.getByTestId(selectors.navMenu)).toBeVisible();
      await expect(page.getByTestId(selectors.navDongles)).toBeHidden();

      await page.getByTestId(selectors.navMenu).click();
      await expect(page.getByTestId(selectors.navGroups)).toBeVisible();

      await page.getByTestId(selectors.navGroups).click();
      await expect(page).toHaveURL(/\/groups/);
    });
  });

  test.describe("anonymous", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test("hamburger drawer lists auth links", async ({ page }) => {
      await page.goto("/login");

      await expect(page.getByTestId(selectors.navMenu)).toBeVisible();
      await page.getByTestId(selectors.navMenu).click();

      await expect(page.getByTestId(selectors.navLogin)).toBeVisible();
      await expect(page.getByTestId(selectors.navSignup)).toBeVisible();
    });
  });
});
