import { chromium, type FullConfig } from "@playwright/test";
import fs from "fs";
import path from "path";
import { BASE_URL, STORAGE_STATE_PATH, USERS } from "./helpers/env";
import { selectors } from "./helpers/selectors";
import { waitForReady } from "./helpers/wait";

const resolveBaseUrl = (config: FullConfig) => {
  const projectBaseUrl = config.projects[0]?.use?.baseURL;
  if (typeof projectBaseUrl === "string" && projectBaseUrl.length > 0) {
    return projectBaseUrl;
  }
  return BASE_URL;
};

const globalSetup = async (config: FullConfig) => {
  const baseUrl = resolveBaseUrl(config);
  await waitForReady(baseUrl);

  fs.mkdirSync(path.dirname(STORAGE_STATE_PATH), { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle" });
  await page.getByTestId(selectors.loginEmail).fill(USERS.standard.email);
  await page.getByTestId(selectors.loginPassword).fill(USERS.standard.password);
  await Promise.all([
    page.waitForURL("**/dongles"),
    page.getByTestId(selectors.loginSubmit).click(),
  ]);

  await page.context().storageState({ path: STORAGE_STATE_PATH });
  await browser.close();
};

export default globalSetup;
