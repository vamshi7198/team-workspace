import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const env = {
  DATABASE_URL: "postgres://workspace:workspace_dev_only@127.0.0.1:5434/workspace_e2e",
  APP_URL: `http://localhost:${PORT}`,
  BETTER_AUTH_SECRET: "e2e-secret-e2e-secret-e2e-secret-e2e",
  UPLOAD_DIR: "./data/e2e-uploads",
  APP_TIMEZONE: "Asia/Kolkata",
  SMTP_HOST: "",
};

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1400, height: 900 } }, testIgnore: /mobile/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile/ },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { ...process.env, ...env } as Record<string, string>,
  },
});

export { env as e2eEnv };
