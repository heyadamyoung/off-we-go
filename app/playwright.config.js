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
  /* One worker per core at a desk, where the suite is bound by the cores.
     On the runner, six on four: a shard's tests ran forty-five seconds with
     the machine busy for half of it — each test spends as long waiting on the
     browser, the network fixture and the server as it does computing, and
     two more workers fill that gap without the timing of any one test
     stretching past what the retry there absorbs. It was two on CI, from the
     days an idle page burned a core and a half on compositor animations;
     with motion reduced (see tests/fixture.js) a waiting page costs nothing. */
  workers: process.env.CI ? 6 : os.cpus().length,
  /* CI only, one retry: the sights and place-search specs lean on live
     Wikipedia, which throttles GitHub's runner addresses in waves — the same
     two tests failed different runs on different afternoons with the code
     untouched. Locally a failure stays loud. */
  retries: process.env.CI ? 1 : 0,
  /* The suite is done in three minutes or it is broken: the run stops at
     the first failure and is cut off at the budget, so a slow suite is a
     red suite and not a slow one. The budget binds at a desk; the runner
     that gates a deploy runs half the suite per shard and is not cut off,
     because a deploy that never runs is worse than a slow one. */
  maxFailures: 1,
  globalTimeout: process.env.CI ? 0 : 180_000,
  timeout: process.env.CI ? 90_000 : 30_000,
  expect: { timeout: process.env.CI ? 15_000 : 8_000 },
  /* On CI the annotations, and the list as well: what each test took is the
     only way to see where a shard's time went from its log. */
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
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
        /* After the device, which brings a pixel ratio of one: half the
           device pixels. Every pixel of a headless map is rasterised in
           software on every page a test opens, and no test reads one; CSS
           pixels — every box a test measures — are unchanged. Set at the top
           level this was quietly overridden by the device. The device's
           1280×720 stays: the photo stacks group by screen cell, and the
           zoom a narrower window frames at regroups them. */
        deviceScaleFactor: 0.5,
        /* No service worker unless a spec asks for one: every context is
           new, so every test was registering the worker and filling its
           cache with the app afresh. The offline specs, which are about the
           worker, allow it on their own page. */
        serviceWorkers: 'block',
        /* A machine that already has a browser can say so. Playwright resolves
           its own by exact build number, and a container with a different one
           pre-installed would otherwise be told to download one it cannot
           reach. Unset — as on CI, which installs its own — this changes
           nothing. */
        launchOptions: {
          ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
            ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
            : {}),
          /* A test's page lives for seconds: the optimising compilers spent
             a sixth of every boot compiling code that would run a few times.
             The interpreter and the baseline compiler are enough. And the GPU
             service — software rendering, here — lives in the browser
             process: every map frame was a command buffer handed to another
             process and waited on, a fourteenth of each test's CPU. */
          args: ['--js-flags=--no-opt --no-maglev', '--in-process-gpu'],
        },
      },
    },
  ],
  webServer: {
    /* Built here, unless the caller built already and says so: on CI a shard
       builds while its tests are being dealt, and serves what it built. */
    command: `${process.env.PREBUILT ? '' : 'pnpm build && '}node scripts/serve-release.mjs dist/client 4180`,
    url: 'http://localhost:4180',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { VITE_API_URL: '' },
  },
})
