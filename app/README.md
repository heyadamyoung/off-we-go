# Wayfare

Wayfare is a private trip app with native iPhone and Android clients and a fully self-hosted backend. The VPS owns the PostgreSQL database, resized photo copies, authentication, invitations, GPS history, and web app. No third-party backend-as-a-service is used.

## What runs on the VPS

- PostgreSQL 17 stores users, one-time login tokens, sessions, trips, members, invitations, stops, route points, comments, likes, phones, GPS positions, photo metadata, and attractions.
- The Fastify API performs authorization, receives uploads and GPS fixes, sends login email, and signs private media URLs.
- Photo uploads are auto-rotated and stored as a maximum 2048 px JPEG plus a 480 px thumbnail. The Apple Photos/iCloud original remains untouched.
- Caddy serves the React app, proxies `/api`, and automatically provisions HTTPS.
- Docker Compose keeps the database, API, and web server isolated and restartable.
- A daily cron backup captures both PostgreSQL and `data/uploads`; the default retention is 14 days.

## VPS requirements

Use a current Debian or Ubuntu VPS with Docker Engine and the Compose plugin already installed from a signed package repository. The VPS also needs a public IP, ports 80/443 open, a domain pointing to it, at least 2 GB RAM, sufficient photo storage, and SMTP credentials. SMTP is required because sign-in uses one-time email links.

## One-command VPS installation

Copy this `app` directory to the VPS, point your domain at it, and run from the directory:

```bash
sudo bash deploy/install.sh
```

On its first run the installer asks for the domain/owner/SMTP values, generates secrets, creates storage directories, builds the containers, runs database migrations, waits for HTTPS health, and installs the nightly backup job. Later runs preserve existing `.env` values; an upgrade from a pre-MCP installation adds the missing OAuth secret once without rotating the database, session, or SMTP secrets.

Afterward, open `https://your-domain`, enter the owner email supplied to the installer, and use the emailed link. That address is the initial administrator and can create the first trip.

Useful commands:

```bash
docker compose ps
docker compose logs -f api
docker compose up -d --build
sudo bash deploy/backup.sh
sudo bash deploy/restore.sh backups/20260830T031700Z
```

Backups stored only on the VPS do not protect against losing the VPS. Copy `backups/` to a second machine or object-storage provider.

Backups briefly pause API writes so the database and upload archive describe the same instant. Restore validates both archives, restores into staged database/storage locations, swaps only after validation, and automatically rolls back if the restored API fails its readiness check.

## Configuration

The installer writes a root-readable `.env`. [.env.vps.example](.env.vps.example) lists every variable. Never expose `.env`, database/session secrets, or SMTP credentials to the browser.

The web build uses `VITE_API_URL=/api`. For a native build, set the public absolute API URL before syncing:

```bash
VITE_API_URL=https://wayfare.threadway.ai/api pnpm ios:sync
VITE_API_URL=https://wayfare.threadway.ai/api pnpm android:sync
```

Both native apps use the system photo picker and send background location fixes to `/api/ingest/track`. iOS requires Always Location permission. Android requires precise location and notification permission because it keeps a visible foreground-service notification active while sharing location.

Android HTTPS sign-in links also require the SHA-256 certificate fingerprint used by Google Play App Signing. Add it to `ANDROID_SHA256_CERT_FINGERPRINTS` in the VPS `.env` (comma-separate multiple signing certificates), redeploy, and verify `/.well-known/assetlinks.json` before release.

Public release pages are served at [privacy.html](https://wayfare.threadway.ai/privacy.html) and [support.html](https://wayfare.threadway.ai/support.html). App Store copy, privacy answers, review notes, and the release checklist are in `docs/app-store/`.

## Remote MCP server and OAuth consent

The VPS also exposes a private remote MCP server at `https://your-domain/mcp`. It is protected by the same Wayfare users and trip membership rules as the web and iPhone apps. No Cloudflare service or third-party identity provider is involved.

When an MCP client connects, Wayfare publishes OAuth discovery metadata, dynamically registers the public client, requires OAuth authorization code flow with S256 PKCE, and opens a branded consent page. The user can grant either read-only access or trip editing. Access tokens last one hour; rotated refresh tokens last 30 days, detect replay, and can be revoked through the OAuth revocation endpoint.

The MCP tools can list and read trips; create and update trips; create, update, or delete stops; replace routes; update or delete photo metadata; manage comments and likes; and manage invitations. Photo uploads remain in the Wayfare app because they require an image file.

To connect, give a Streamable HTTP-capable MCP client this server URL:

```text
https://your-domain/mcp
```

The client should discover the OAuth endpoints automatically. If the browser is not already signed into Wayfare, the consent page can send the normal one-time email link and return to the pending authorization request afterward. `WAYFARE_OAUTH_SECRET` signs pending consent requests and must remain server-side; the installer generates it automatically for both new and existing VPS installations.

## One-time migration from the previous Supabase project

The production runtime has no Supabase dependency. If the previous project contains real data, run the resumable one-time importer before inviting people to the VPS version. It copies users, trips, membership, invitations, stops, routes, photos, comments, and likes; private photo objects are downloaded with the legacy service-role key, resized into Wayfare's current display/thumbnail format, and recorded in a checksum manifest.

First check row counts without writing anything:

```bash
LEGACY_DATABASE_URL='postgresql://...' \
DATABASE_URL='postgresql://wayfare:...@127.0.0.1:5432/wayfare' \
DRY_RUN=true pnpm migrate:supabase
```

Then perform the migration from the VPS application directory:

```bash
LEGACY_DATABASE_URL='postgresql://...' \
LEGACY_SUPABASE_URL='https://old-project.supabase.co' \
LEGACY_SUPABASE_SERVICE_ROLE_KEY='...' \
DATABASE_URL='postgresql://wayfare:...@127.0.0.1:5432/wayfare' \
UPLOAD_DIR='./data/uploads' \
pnpm migrate:supabase
```

The importer is safe to rerun because it preserves legacy IDs and uses conflict updates. It stops on a missing/corrupt image by default so a migration cannot silently lose media. Set `SKIP_MISSING_MEDIA=true` only after reviewing the skipped entries that will be written to `legacy-migration-manifest.json`. Delete the legacy service-role key from shell history and revoke it when migration is complete.

## Local development

With no `VITE_API_URL`, `pnpm dev` opens the bundled sample trip and needs no database:

```bash
pnpm install
pnpm dev
```

To run the real backend locally, start PostgreSQL, set the server variables from [.env.vps.example](.env.vps.example), set `DATABASE_URL`, and run `node server/src/index.js`. Then run Vite with `VITE_API_URL=http://localhost:3000/api`.

## Database migrations and GPS retention

Migrations live in `server/migrations/` and execute automatically before the API starts. Applied migrations are checksummed; add future changes as a new numbered SQL file.

GPS fixes use an indexed, deduplicated table. To retain only 30 days:

```bash
docker compose exec -T db psql -U wayfare -d wayfare -c "select wayfare_prune_positions(interval '30 days');"
```

## Maintenance scripts

The optional attraction and itinerary scripts connect directly to PostgreSQL. Use an SSH tunnel instead of exposing PostgreSQL publicly.

```bash
DATABASE_URL='postgresql://wayfare:password@localhost:5432/wayfare' pnpm seed:attractions
DATABASE_URL='postgresql://wayfare:password@localhost:5432/wayfare' node scripts/real-itinerary.mjs
```

## Verification

```bash
pnpm test:unit
pnpm test:server
pnpm build
pnpm test
pnpm ios:sync
pnpm android:sync
./android/gradlew -p android testDebugUnitTest assembleDebug
docker compose config
```

The iOS project is in `ios/`. `.github/workflows/ios-build.yml` performs an unsigned iPhone/iPad simulator compile, while `.github/workflows/testflight.yml` creates an automatically signed archive and uploads it to App Store Connect from a GitHub-hosted Mac. Apple credentials remain in GitHub Actions secrets; see `docs/app-store/release-checklist.md`.

The Kotlin Android project is in `android/`. `.github/workflows/android-build.yml` compiles and tests a debug APK with JDK 21 and Android SDK 35. Open it with `pnpm android:open`; release and App Links setup are documented in `docs/google-play/release-checklist.md`.
