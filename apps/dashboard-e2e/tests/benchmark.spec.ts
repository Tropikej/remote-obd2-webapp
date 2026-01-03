import { test, expect } from "@playwright/test";
import { STORAGE_STATE_PATH, USERS } from "../helpers/env";
import { selectors } from "../helpers/selectors";

test.describe("benchmark access", () => {
  test.describe("standard users", () => {
    test.use({ storageState: STORAGE_STATE_PATH });

    test("cannot access benchmark tools", async ({ page }) => {
      await page.goto("/benchmark");
      await expect(
        page.getByText("You must be a super admin to view benchmark tools.")
      ).toBeVisible();
    });
  });

  test.describe("admin users", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test("can access benchmark tools", async ({ page }) => {
      await page.goto("/login");
      await page.getByTestId(selectors.loginEmail).fill(USERS.admin.email);
      await page.getByTestId(selectors.loginPassword).fill(USERS.admin.password);
      await Promise.all([
        page.waitForURL("**/dongles"),
        page.getByTestId(selectors.loginSubmit).click(),
      ]);

      await expect(page.getByTestId(selectors.navBenchmark)).toBeVisible();
      await page.getByTestId(selectors.navBenchmark).click();
      await expect(page.getByRole("heading", { name: "Benchmark" })).toBeVisible();
      await expect(page.getByTestId(selectors.benchmarkTargetId)).toBeVisible();
    });
  });
});
