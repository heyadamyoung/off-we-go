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
    reducedMotion: 'reduce',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        /* The same economies as the sample-mode suite (see playwright.config):
           half the device pixels of a map nothing reads, no service worker
           registering itself on every fresh context, and a browser that
           neither optimises code that runs once nor hands each frame to
           another process. The specs seal their contexts through
           tests/fixture.js too, so the basemap and the encyclopaedia are
           answered here rather than fetched over the internet on every page
           a test opens — the server behind this suite is the real one, the
           rest of the world need not be. */
        deviceScaleFactor: 0.5,
        serviceWorkers: 'block',
        launchOptions: {
          ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
            ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
            : {}),
          args: ['--js-flags=--no-opt --no-maglev', '--in-process-gpu'],
        },
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
