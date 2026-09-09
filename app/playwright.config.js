import { defineConfig, devices } from '@playwright/test'

/* The suite runs against the production build in sample mode — no credentials,
   no database — so it exercises the real bundle and needs nothing set up.
   With VITE_API_URL present the app would show a sign-in gate instead, which
   is why the web server is started with them explicitly cleared.

   It is served the way Caddy serves it rather than by `vite preview`, which
   server-renders each request: that hid a hydration failure in the prerendered
   index.html the deployed site actually sends. */
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  /* tests/live is a different suite with a different world behind it — a real
     server, and a build made against it. It has its own config and its own
     command; picked up here it would run against the sample build with
     nothing listening, and fail for reasons that are not about the app. */
  testIgnore: '**/live/**',
  fullyParallel: false,
  workers: process.env.CI ? 2 : 4,
  /* CI only, one retry: the sights and place-search specs lean on live
     Wikipedia, which throttles GitHub's runner addresses in waves — the same
     two tests failed different runs on different afternoons with the code
     untouched. Locally a failure stays loud. */
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4180',
    viewport: { width: 1600, height: 950 },
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        /* A machine that already has a browser can say so. Playwright resolves
           its own by exact build number, and a container with a different one
           pre-installed would otherwise be told to download one it cannot
           reach. Unset — as on CI, which installs its own — this changes
           nothing. */
        ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
          ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } }
          : {}),
      },
    },
  ],
  webServer: {
    command: 'pnpm build && node scripts/serve-release.mjs dist/client 4180',
    url: 'http://localhost:4180',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { VITE_API_URL: '' },
  },
})
