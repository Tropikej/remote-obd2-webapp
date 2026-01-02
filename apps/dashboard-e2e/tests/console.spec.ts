import { test, expect } from "@playwright/test";
import { STORAGE_STATE_PATH } from "../helpers/env";
import { selectors } from "../helpers/selectors";

test.describe("console layout", () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  test("renders filters, tabs, and events", async ({ page }) => {
    await page.goto("/console");

    await expect(page.getByTestId(selectors.consoleTargetType)).toBeVisible();
    await expect(page.getByTestId(selectors.consoleFiltersCard)).toBeVisible();
    await expect(page.getByTestId(selectors.consoleEventsCard)).toBeVisible();

    await expect(page.getByTestId(selectors.consoleTabCan)).toBeVisible();
    await expect(page.getByTestId(selectors.consoleTabCommand)).toBeVisible();

    await expect(page.getByTestId(selectors.consolePanelCan)).toBeVisible();
    await expect(page.getByTestId(selectors.consoleCanForm)).toBeVisible();

    await page.getByTestId(selectors.consoleTabCommand).click();
    await expect(page.getByTestId(selectors.consolePanelCommand)).toBeVisible();
    await expect(page.getByTestId(selectors.consoleCommandForm)).toBeVisible();
    await expect(page.getByTestId(selectors.consoleCommandLog)).toBeVisible();

    await expect(page.getByTestId(selectors.consoleEventsCard)).toBeVisible();
  });

  test("filters are interactive", async ({ page }) => {
    await page.goto("/console");

    const canFilter = page.getByTestId(selectors.consoleFilterCan);
    const commandFilter = page.getByTestId(selectors.consoleFilterCommands);
    const rxFilter = page.getByTestId(selectors.consoleFilterRx);

    await expect(canFilter).toBeChecked();
    await canFilter.click();
    await expect(canFilter).not.toBeChecked();

    await expect(commandFilter).toBeChecked();
    await commandFilter.click();
    await expect(commandFilter).not.toBeChecked();

    await expect(rxFilter).toBeChecked();
    await rxFilter.click();
    await expect(rxFilter).not.toBeChecked();
  });
});
