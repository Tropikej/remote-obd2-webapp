import { test, expect } from "@playwright/test";
import { STORAGE_STATE_PATH } from "../helpers/env";

test.use({ storageState: STORAGE_STATE_PATH });

test("standard users are blocked from admin tools", async ({ page }) => {
  await page.goto("/admin");

  await expect(
    page.getByText("You must be a super admin to view admin tools.")
  ).toBeVisible();
});
