import os from 'node:os'
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
  /* Every test opens its own page, so every test can run anywhere: the
     sixty-eight in trip.spec.js are spread across the workers rather than
     run one after another on whichever worker drew the file. */
  fullyParallel: true,
  /* One worker per core. An idle page used to burn a core and a half on
     compositor animations, so a worker per core left every browser a second
     behind; with motion reduced (see tests/fixture.js) a waiting page costs
     nothing, and the count stops mattering. */
  workers: process.env.CI ? 2 : os.cpus().length,
  /* CI only, one retry: the sights and place-search specs lean on live
     Wikipedia, which throttles GitHub's runner addresses in waves — the same
     two tests failed different runs on different afternoons with the code
     untouched. Locally a failure stays loud. */
  retries: process.env.CI ? 1 : 0,
  /* The suite is done in three minutes or it is broken: the run stops at
     the first failure and is cut off at the budget, so a slow suite is a
     red suite and not a slow one. The budget binds at a desk; the two-core
     runner that gates a deploy is not held to it until the suite fits,
     because a deploy that never runs is worse than a slow one. */
  maxFailures: 1,
  globalTimeout: process.env.CI ? 0 : 180_000,
  timeout: process.env.CI ? 90_000 : 30_000,
  expect: { timeout: process.env.CI ? 15_000 : 8_000 },
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4180',
    /* Tracing screenshots every action, and a screenshot of a software-drawn
       map is a raster pass: it was a quarter of the suite's time. A failure on
       CI records its trace on the retry; at a desk, `--trace on` when needed. */
    trace: process.env.CI ? 'on-first-retry' : 'off',
    /* The pulses and halos are compositor animations, and a headless
       compositor is software: at sixty frames a second an idle page was a
       core and a half. The stylesheet honours the preference already. */
    reducedMotion: 'reduce',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        /* After the device, which brings its own: desktop layout (the widest
           breakpoint is 1024) at half the device pixels. Every pixel of a
           headless map is rasterised in software on every page a test opens,
           and no test reads one; CSS pixels — every box a test measures —
           are unchanged. Set at the top level these were quietly overridden
           by the device's 1280×720 at a pixel ratio of one. */
        viewport: { width: 1100, height: 700 },
        deviceScaleFactor: 0.5,
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
