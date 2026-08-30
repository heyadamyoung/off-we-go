import { defineConfig, devices } from '@playwright/test'

/* The suite runs against the production build in sample mode — no credentials,
   no database — so it exercises the real bundle and needs nothing set up.
   With VITE_API_URL present the app would show a sign-in gate instead, which
   is why the web server is started with them explicitly cleared. */
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4180',
    viewport: { width: 1600, height: 950 },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm build && pnpm preview --port 4180 --strictPort',
    url: 'http://localhost:4180',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { VITE_API_URL: '' },
  },
})
