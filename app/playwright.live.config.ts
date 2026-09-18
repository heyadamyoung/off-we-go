import { defineConfig, devices } from '@playwright/test'

/* The suite that has a server behind it.

   The default config builds with VITE_API_URL cleared, which puts the app in
   sample mode: no sign-in, no database, and `uploadPhoto` never leaves the
   tab. That is the right shape for testing layout and interaction, and it is
   the wrong shape for testing whether anything is actually uploaded — the one
   question the default suite cannot answer about itself.

   So this one builds with the API URL set and runs the app signed in against
   a real Fastify, a real converter and a real file store. Separate config and
   separate command on purpose: the two builds would race over public/ if they
   ran together, and this one is slower because it converts real video. */
export default defineConfig({
  testDir: './tests/live',
  testMatch: '**/*.spec.js',
  /* Side by side, four at a time, each worker on a trip of its own (see
     tests/live/stack.js). One worker in a row was a minute and a quarter of
     which the machine was busy for twenty seconds: the rest was waiting on
     uploads, conversions and the server, which four can do at once. The
     stack seeds as many trips as there are workers here. */
  fullyParallel: true,
  workers: 4,
  // No retries: a flake here is a finding, not something to paper over.
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  /* On CI the annotations, and the list as well: what each test took is the
     only way to see where a shard's time went from its log. */
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:4190',
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
    command: 'node scripts/live-stack.mjs',
    url: 'http://localhost:4190',
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
