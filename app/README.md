# Wayfare

Wayfare is a private trip app with its own iPhone client and a fully self-hosted backend. The VPS owns the PostgreSQL database, resized photo copies, authentication, invitations, GPS history, and web app. No third-party backend-as-a-service is used.

## What runs on the VPS

- PostgreSQL 17 stores users, one-time login tokens, sessions, trips, members, invitations, stops, route points, comments, likes, phones, GPS positions, photo metadata, and attractions.
- The Fastify API performs authorization, receives uploads and GPS fixes, sends login email, and signs private media URLs.
- Photo uploads are auto-rotated and stored as a maximum 2048 px JPEG plus a 480 px thumbnail. The Apple Photos/iCloud original remains untouched.
- Caddy serves the React app, proxies `/api`, and automatically provisions HTTPS.
- Docker Compose keeps the database, API, and web server isolated and restartable.
- A daily cron backup captures both PostgreSQL and `data/uploads`; the default retention is 14 days.

## VPS requirements

Use a current Debian or Ubuntu VPS with a public IP, ports 80/443 open, a domain pointing to it, at least 2 GB RAM, sufficient photo storage, and SMTP credentials. SMTP is required because sign-in uses one-time email links.

## One-command VPS installation

Copy this `app` directory to the VPS, point your domain at it, and run from the directory:

```bash
sudo bash deploy/install.sh
```

The installer refuses to replace an existing `.env` unless explicitly run with `--force`. It installs Docker when needed, asks for the domain/owner/SMTP values, generates secrets, creates storage directories, builds the containers, runs database migrations, waits for HTTPS health, and installs the nightly backup job.

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

## Configuration

The installer writes a root-readable `.env`. [.env.vps.example](.env.vps.example) lists every variable. Never expose `.env`, database/session secrets, or SMTP credentials to the browser.

The web build uses `VITE_API_URL=/api`. For an iPhone build, set the public absolute API URL before syncing:

```bash
VITE_API_URL=https://wayfare.threadway.ai/api pnpm ios:sync
```

The native app uses the regular Apple Photos picker and sends background Core Location fixes to `/api/ingest/track`. iOS still requires photo access and Always Location permission.

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
docker compose config
```

The iOS project is in `ios/`. Compiling, signing, and running it still requires Xcode on macOS (local Mac, rented Mac, or macOS CI); the VPS replaces the backend, not Apple’s signing requirement.
