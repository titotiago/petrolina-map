import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  timeout: 120_000,
  use: { baseURL: "http://localhost:4173", viewport: { width: 1440, height: 900 } },
  webServer: { command: "npx vite preview --port 4173 --strictPort", url: "http://localhost:4173", reuseExistingServer: true, timeout: 60_000 },
});
