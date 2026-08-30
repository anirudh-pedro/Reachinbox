# ReachInbox — Email Job Scheduler

A production-oriented email scheduling service and dashboard. Accepts schedule requests via API,
persists them, fires them at the right time using BullMQ delayed jobs (no cron, no polling loops),
sends through Ethereal SMTP, enforces per-sender rate limits backed by Redis, and notifies Slack the
moment a limit trips.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Local Setup](#local-setup)
- [Running the App](#running-the-app)
- [API Usage](#api-usage)
- [How Scheduling Works](#how-scheduling-works)
- [Restart Persistence](#restart-persistence)
- [Idempotency](#idempotency)
- [Concurrency & Minimum Delay](#concurrency--minimum-delay)
- [Redis-Backed Hourly Rate Limiting](#redis-backed-hourly-rate-limiting)
- [Slack Setup](#slack-setup)
- [Elasticsearch Setup](#elasticsearch-setup)
- [Google OAuth Status](#google-oauth-status)
- [Known Limitations](#known-limitations)
- [Production Deployment](#production-deployment)

## Architecture Overview

```
Compose UI / API caller
        │
        ▼
POST /api/emails/schedule  ──────────►  PostgreSQL (EmailJob row, status=SCHEDULED)
        │
        ▼
BullMQ delayed job added to Redis (jobId = EmailJob.id, deterministic)
        │
        ▼  (delay elapses — no polling, Redis wakes the worker)
BullMQ Worker picks up the job
        │
        ├─► Idempotency check: fetch EmailJob by id, skip if already SENT
        │
        ├─► Redis-backed hourly rate limit check (atomic Lua script, per sender)
        │        │
        │        ├─ allowed  ─► continue
        │        └─ blocked  ─► status=RATE_LIMITED, reschedule into next hour window,
        │                       emit RATE_LIMIT_TRIPPED event (Slack listener picks it up)
        │
        ├─► Redis-backed per-sender minimum delay throttle
        │
        ├─► Send via Ethereal SMTP (nodemailer)
        │
        └─► status=SENT + sentAt + Ethereal preview URL, or status=FAILED after
             retries exhaust (BullMQ: 3 attempts, exponential backoff)

Elasticsearch (optional) is indexed on every status transition; if unreachable,
search transparently falls back to PostgreSQL ILIKE queries.
```

**Backend:** Express + TypeScript, Prisma (PostgreSQL), BullMQ + ioredis, Nodemailer (Ethereal),
Zod validation, Bull-Board (live queue dashboard), optional Elasticsearch client.

**Frontend:** React + TypeScript + Tailwind CSS, polling the API every 4s for live status updates.

## Local Setup

### Prerequisites

- Node.js 18+
- Docker Desktop (for PostgreSQL + Redis + optional Elasticsearch)

### 1. Clone and install dependencies

```powershell
cd server
npm install

cd ../client
npm install
```

### 2. Start infrastructure

```powershell
docker compose up -d postgres redis
# Elasticsearch is optional and slow to pull on first run (~600MB image):
docker compose up -d elasticsearch
```

> **Note on ports:** `docker-compose.yml` publishes PostgreSQL on host port **5433** (not 5432).
> This is intentional — many dev machines already have a native PostgreSQL service bound to 5432
> (e.g. a Windows PostgreSQL installer, or Postgres.app on macOS), and reusing 5432 here would
> silently connect to the wrong database or fail outright. Redis uses the standard 6379 with no
> conflict. If your `DATABASE_URL` doesn't match, connections will fail with
> `Can't reach database server at ... 5433` — check nothing else grabbed that port.

### 3. Configure environment variables

```powershell
cd server
Copy-Item .env.example .env
```

Fill in `server/.env`. At minimum, `DATABASE_URL`, `REDIS_HOST`, `REDIS_PORT` must point at the
containers above. Everything else has a working default — see [`.env.example`](server/.env.example)
for the full list with comments. **Never commit `.env`** — it's already covered by
`server/.gitignore`.

### 4. Run Prisma migrations

```powershell
cd server
npx prisma migrate dev
```

### 5. Ethereal SMTP — zero setup required

The backend automatically creates a fresh Ethereal test account on first boot
(`nodemailer.createTestAccount()`) if no sender exists in the database, and stores it as the
default `SenderAccount`. You don't need to sign up for anything — just start the server and the
first scheduled email will have a real, clickable Ethereal preview URL in the API response and in
the dashboard's email detail view.

## Running the App

Two separate processes, both required:

```powershell
# Terminal 1 — backend (Express API + BullMQ worker, same process)
cd server
npm run dev

# Terminal 2 — frontend
cd client
npm run dev
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:5000
- Live queue dashboard (Bull-Board): http://localhost:5000/admin/queues
- Health check: http://localhost:5000/health

> The API and worker currently run in the same Node process (`server/src/index.ts` imports the
> worker module directly). This is a known simplification — see
> [Known Limitations](#known-limitations).

## API Usage

### Schedule email(s)

```http
POST /api/emails/schedule
Content-Type: application/json

{
  "recipients": ["test@example.com"],
  "subject": "ReachInbox Test",
  "body": "This is a scheduled email.",
  "startTime": "2026-08-30T12:00:00.000Z",
  "delayBetweenEmails": 2,
  "hourlyLimit": 200,
  "senderId": null
}
```

- `recipients` is an array (supports bulk scheduling from a single request); a single-recipient
  send is just an array of length 1.
- `startTime` is optional — omit it to send immediately. If provided, it must not be more than
  ~60 seconds in the past (a small grace window absorbs request latency/clock skew).
- `delayBetweenEmails` (seconds) and `hourlyLimit` fall back to `DEFAULT_MIN_DELAY_SECONDS` /
  `DEFAULT_MAX_HOURLY_LIMIT` from `.env` if omitted.
- Returns `201` with the created `EmailJob` record(s), `400` on validation failure.

### Other endpoints

| Method | Path                        | Description                                          |
|--------|------------------------------|-------------------------------------------------------|
| GET    | `/api/emails/scheduled`     | Paginated list of SCHEDULED/PROCESSING/RATE_LIMITED   |
| GET    | `/api/emails/sent`          | Paginated list of SENT/FAILED                         |
| GET    | `/api/emails/:id`           | Single email by id — `404` if not found               |
| GET    | `/api/emails/search`        | Elasticsearch-backed search (Postgres fallback)       |
| GET    | `/api/emails/stats`         | Counts by status                                      |
| GET    | `/api/emails/senders`       | List sender accounts (SMTP credentials never exposed) |
| GET    | `/api/auth/slack/url`       | Slack OAuth authorize URL (400 if not configured)     |
| GET    | `/api/auth/slack/status`    | Current Slack connection status                       |
| POST   | `/api/auth/slack/connect-webhook` | Connect via a plain incoming webhook URL        |
| POST   | `/api/auth/slack/test`      | Fire a live test rate-limit alert to Slack            |
| GET    | `/health`                   | Real dependency check — Postgres + Redis reachability |
| GET    | `/api/health`               | Basic liveness check (no dependency checks)           |

## How Scheduling Works

Every schedule request writes a `EmailJob` row to PostgreSQL first, then adds a **BullMQ delayed
job** to Redis with `delay = scheduledAt - now`. There is no cron job, no `setInterval`, and no
loop that periodically scans the database for due emails anywhere in this codebase. Redis itself
tracks the delay and wakes the worker exactly when the job becomes due — this is what BullMQ's
delayed-job mechanism is for, and it's the reason the constraint "no cron" matters: a cron-based
design would require the process to be alive and polling on a fixed interval, which breaks the
moment you want exact per-email timing at scale or want the schedule to survive a restart without
re-deriving state.

## Restart Persistence

Verified manually: schedule an email ~1-2 minutes out, kill the backend process entirely (`Ctrl+C`
or process kill — leave the Postgres/Redis **containers** running), wait, then restart
`npm run dev`. The delayed job is still present in Redis (BullMQ persists it there, independent of
the Node process), and it fires at the correct time after restart with no re-scheduling code
required on boot. Confirmed via direct Redis inspection during testing:

```powershell
docker exec reachinbox_redis redis-cli HGETALL "bull:email-send-queue:<jobId>"
```

showed the job's full data and delay intact while the Node process was completely stopped.

## Idempotency

The BullMQ `jobId` is set to the `EmailJob.id` (a UUID), which is also stored in the `jobId`
column with a unique constraint. Before sending, the worker always re-fetches the email from
PostgreSQL and checks its status:

```ts
if (emailRecord.status === 'SENT') {
  console.log(`Email ${emailJobId} is already marked as SENT. Skipping.`);
  return;
}
```

This was verified directly: manually re-enqueuing a duplicate job pointing at an already-`SENT`
email ID causes the worker to skip it immediately, with `sentAt` and the Ethereal message ID left
untouched — no second send occurs.

**Honest limitation:** this does not provide true exactly-once delivery in the strictest sense. If
the process crashes *after* Ethereal accepts the SMTP message but *before* the `status: SENT`
write commits to PostgreSQL, the database would still show `PROCESSING` while the email was
actually delivered — a retry would then send a second copy. This is an inherent limitation of any
system built on SMTP without transactional outbox patterns or idempotency keys on the receiving
end (which Ethereal, as a test SMTP service, doesn't support). It is not something this
implementation claims to solve, and it's called out explicitly rather than glossed over.

## Concurrency & Minimum Delay

- **Worker concurrency** is configurable via `WORKER_CONCURRENCY` (default `5`) and passed
  directly to BullMQ's `Worker` options — this many jobs can be processed in parallel by a single
  worker process.
- **Minimum delay between sends per sender** is enforced two ways:
  1. At scheduling time, the API stages each recipient's `scheduledAt` `delayBetweenEmails`
     seconds apart from the previous one in the same batch.
  2. At send time, `enforcePerSenderDelay()` uses a Redis key (`throttle:last_send:<senderId>`)
     to track the last send timestamp for that sender and blocks the current job until the
     minimum interval has elapsed — this is safe across multiple concurrent workers because the
     check reads/writes through Redis, not in-memory state.

Verified: two emails scheduled 3 seconds apart from the same sender had `sentAt` timestamps ~2.8s
apart in practice (within normal processing overhead).

## Redis-Backed Hourly Rate Limiting

Enforced with an atomic Lua script (`checkAndIncrementHourlyLimit`) executed via
`redis.eval()`, keyed by `ratelimit:emails:<senderId>:<YYYYMMDDHH>`. The check-and-increment
happens as a single atomic Redis operation, so it's safe under concurrent workers or multiple
backend instances — there's no read-then-write race window.

When the limit is reached:
- The job is **not dropped and not marked FAILED**. Its status becomes `RATE_LIMITED` and its
  `scheduledAt` is updated to the start of the next hour window; a new BullMQ delayed job is
  enqueued for that time.
- A `RATE_LIMIT_TRIPPED` event fires, which the Slack listener picks up (see below).

Verified directly: with a temporary `hourlyLimit: 2` and 3 recipients queued, the third job logged
`Rate limit REACHED for sender default (2/2 this hour)`, was rescheduled to the next hour boundary
with `status: RATE_LIMITED`, while the first two sent normally.

**Trade-off:** the limit is enforced per `senderId` (falling back to `'default'` for the shared
Ethereal test sender), not globally across all senders — this matches the assignment's
"per-sender" option and supports the multi-sender schema already in place
(`SenderAccount.hourlyLimit`), but means a global cross-sender cap isn't separately enforced.

## Slack Setup

Two independent connection methods exist:

**1. Incoming Webhook (no OAuth app required, works today):**
1. In Slack, add an [Incoming Webhook](https://api.slack.com/messaging/webhooks) to any channel.
2. Copy the webhook URL (`https://hooks.slack.com/services/...`).
3. In the dashboard, open the Slack modal (profile menu → Connect Slack) and paste it in.

**2. Real OAuth flow (requires your own Slack app):**
1. Create an app at [api.slack.com/apps](https://api.slack.com/apps).
2. Add scopes: `incoming-webhook`, `chat:write`, `chat:write.public`.
3. Set the OAuth redirect URL to match `SLACK_REDIRECT_URI` (default
   `http://localhost:5000/api/auth/slack/callback`).
4. Copy the Client ID and Client Secret into `server/.env` as `SLACK_CLIENT_ID` /
   `SLACK_CLIENT_SECRET`.
5. Restart the backend. The "Authorize with Slack OAuth" button in the dashboard will now work.

**Verified graceful degradation:** with `SLACK_CLIENT_ID`/`SLACK_CLIENT_SECRET` left blank (as
shipped), `GET /api/auth/slack/url` returns a clean `400` with an explanatory message instead of
crashing, and a rate-limit trip logs `No active Slack integration found. Rate limit event skipped
(graceful no-op)` instead of throwing. No restart is needed after adding credentials later —
they're read from `process.env` at request time.

## Elasticsearch Setup

Optional. Start it with:

```powershell
docker compose up -d elasticsearch
```

The image is ~600MB and can be slow to pull on a first run. The backend checks Elasticsearch's
health on boot (`initElasticsearch()`); if it's unreachable, every indexing call and the
`/api/emails/search` endpoint transparently falls back to a PostgreSQL `ILIKE` query — confirmed
by the boot log `Elasticsearch not reachable. Search fallback to PostgreSQL will be enabled` and
the search endpoint continuing to return results with `"source": "postgres_fallback"` in that
case. No manual configuration is needed either way; it self-detects.

## Google OAuth Status

**Currently mocked.** `client/src/components/LoginView.tsx`'s "Login with Google" button calls
`onLogin(DEMO_USER)` directly with a hardcoded demo profile — there is no real redirect to Google,
no token exchange, and no server-side verification. This was a deliberate scope decision for this
sprint: implementing real Google OAuth requires a Google Cloud project, an OAuth client ID/secret,
and consent-screen configuration that depends on external setup, and a rushed implementation late
in a time-boxed sprint risked destabilizing a working dashboard for a login flow that doesn't
block any of the core scheduling functionality being evaluated.

To make this real: register an OAuth client at
[Google Cloud Console](https://console.cloud.google.com/apis/credentials), add the client ID to
the frontend (e.g. via `@react-oauth/google` or a direct `google.accounts.id` integration), verify
the returned ID token server-side, and create/look up a `User` row (the schema already has a
`User` model with a `googleId` field ready for this).

## Known Limitations

- **Local dev runs API and worker in one process by default** (`npm run dev`), for a simple
  single-command local workflow. In production (see below), they run as two independent
  containers (`server/src/worker.ts` as a standalone entrypoint, `RUN_WORKER_IN_PROCESS=false` on
  the API side) - this was verified by actually starting/stopping each container independently
  and confirming jobs still survive and execute exactly once.
- **No true exactly-once SMTP delivery** — see [Idempotency](#idempotency) above.
- **Google OAuth is mocked** — see above.
- **Slack OAuth requires your own Slack app credentials** to test the full authorize flow; the
  webhook path works without any external app registration.
- **Rate limiting is per-sender, not cross-sender global** by default (configurable per sender via
  `SenderAccount.hourlyLimit`, or via the `hourlyLimit` field on a schedule request).
- **Elasticsearch is optional infrastructure** — search works either way, but relevance
  ranking/fuzzy matching only applies when Elasticsearch is actually running.

## Production Deployment

Target architecture: React frontend on **Vercel**, Express API + BullMQ worker + PostgreSQL +
Redis + Elasticsearch on a single **AWS EC2** instance via Docker Compose, behind an Nginx
reverse proxy.

```
                    ┌─────────────────────┐
                    │       Vercel        │
                    │   React Frontend    │
                    └──────────┬──────────┘
                               │ HTTPS API (VITE_API_URL)
                               ▼
                    ┌─────────────────────┐
                    │   Nginx (80/443)    │  ← only public port besides SSH
                    └──────────┬──────────┘
                               ▼
                    ┌─────────────────────┐
                    │      AWS EC2        │
                    │  reachinbox_api     │  (Express, container)
                    │  reachinbox_worker  │  (BullMQ worker, separate container)
                    │  reachinbox_postgres│  (Docker network only, no public port)
                    │  reachinbox_redis   │  (Docker network only, no public port)
                    │  reachinbox_es      │  (Docker network only, no public port)
                    └─────────────────────┘
                               │
                               ▼
                         Ethereal SMTP
```

**Status of this section:** the code changes required to make this deployable (Dockerfile,
production compose override, env-driven CORS/API URLs, graceful shutdown, split API/worker
containers) are complete and were verified locally by actually running
`docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build`, confirming both
containers connect over the Docker network, and re-running the schedule → send → restart tests
against that exact topology. **The application has not yet been provisioned on an actual AWS EC2
instance or deployed to Vercel** — that requires AWS/Vercel account access, credentials, and
decisions (region, domain, key pair) that were intentionally left for the project owner to
provide rather than invented. See the command sequence below for exactly what to run once that
access is available.

### AWS EC2 setup

1. Launch a Linux EC2 instance (Amazon Linux 2023 or Ubuntu 22.04+) with Docker installed. A
   `t3.small` or `t3.medium` is sufficient for this workload (Elasticsearch is the main memory
   consumer at ~512MB-1GB).
2. Security group: allow `22` (SSH, ideally restricted to your IP), `80`/`443` (HTTP/HTTPS)
   publicly. Do **not** open `5432`, `6379`, or `9200` — the production compose file
   (`docker-compose.prod.yml`) already removes their host port bindings entirely, so even a
   misconfigured security group couldn't expose them without also changing that file.
3. Install Docker + Docker Compose plugin, then:
   ```bash
   mkdir -p /opt/reachinbox && cd /opt/reachinbox
   git clone <your-repo-url> .
   cp server/.env.example server/.env      # fill in real values, see below
   cp .env.example .env                    # optional: override POSTGRES_PASSWORD etc.
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
   ```
4. Run migrations against the running Postgres container (use `migrate deploy`, not `migrate dev`,
   in production — it applies existing migrations without generating new ones or prompting):
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml exec api \
     npx prisma migrate deploy
   ```
5. Verify: `curl http://localhost:5000/health` should return `{"status":"ok",...}`.

### Reverse proxy + HTTPS

Point Nginx at the `api` container's published port:

```nginx
server {
    listen 80;
    server_name api.yourdomain.com;
    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Then obtain a free certificate with [Certbot](https://certbot.eff.org/) (`certbot --nginx -d
api.yourdomain.com`) for HTTPS. If no domain is available yet, the assignment can be demoed
temporarily over plain HTTP using the EC2 instance's public IP directly against port 5000 — not
recommended beyond a demo, since traffic (including any future auth tokens) would be unencrypted.

### Frontend (Vercel)

1. Import the repo into Vercel, set the project root to `client/`.
2. Add an environment variable in the Vercel project settings:
   `VITE_API_URL=https://api.yourdomain.com` (or the temporary EC2 IP-based URL).
3. Deploy. `client/src/services/api.ts` reads `VITE_API_URL` at build time — no source changes
   needed, and local dev is unaffected (leaving it unset locally keeps using Vite's dev proxy).
4. On the backend, set `ALLOWED_ORIGINS` in `server/.env` to the exact Vercel URL(s) (comma
   separated if you have both a production and preview URL) so CORS allows the deployed frontend.

### Database, Redis, BullMQ in production

- `npx prisma migrate deploy` applies migrations without interactive prompts or drift detection -
  the correct command for CI/production, as opposed to `migrate dev` which is for local
  iteration and can prompt to reset the database.
- The worker runs as its own container (`reachinbox_worker`, `command: node dist/worker.js`),
  completely separate from the API container. Verified: stopping and restarting both containers
  while a job is delayed in Redis results in the job resuming and sending exactly once, with no
  "recreate jobs from the database" logic anywhere — Redis's own persistence (`--appendonly yes`)
  is what survives the restart.
- No cron, no `setInterval`, no polling loop exists anywhere in this codebase.

### Elasticsearch in production

Runs as its own container with no published host port (internal Docker network only, reachable
by the `api`/`worker` containers as `http://elasticsearch:9200`). Both the API and the standalone
worker call `initElasticsearch()` independently on boot — this matters because the "is ES
available" flag lives in each process's own memory; if only one of the two processes initialized
it, the other would silently skip indexing even with a healthy cluster. If Elasticsearch is slow
to start or unreachable, both processes log a warning and every search call transparently falls
back to a PostgreSQL `ILIKE` query — this was true before this deployment work and is unchanged.

### Slack / Google OAuth in production

No different from local: the OAuth **redirect URI** must be updated to the real public backend
URL, e.g. `SLACK_REDIRECT_URI=https://api.yourdomain.com/api/auth/slack/callback`, in
`server/.env` on the EC2 instance. Google OAuth remains mocked regardless of environment — see
[Google OAuth Status](#google-oauth-status).

### Bull-Board in production

`https://api.yourdomain.com/admin/queues` has **no authentication** in the current code. For a
short-lived hiring-assignment demo this is a reasonable, explicitly-documented trade-off to let a
reviewer see live queue state easily; it should not be left exposed unauthenticated for anything
longer-lived. The straightforward fix (not implemented, since it wasn't requested) would be
wrapping the `/admin/queues` route with HTTP Basic Auth middleware using a dedicated env-configured
username/password.

### What still requires the project owner to provide

- AWS account/credentials, chosen region, and an EC2 key pair.
- A domain name and DNS configuration (or an explicit decision to demo over plain HTTP/IP).
- A Vercel account/login to actually trigger the frontend deployment.
- Real Slack app credentials if the live OAuth flow (not the webhook path) needs to be
  demonstrated in production.
- Google OAuth client credentials if real Google login is desired (still mocked otherwise, in
  production exactly as it is locally).

None of the above were invented or assumed - see the corresponding conversation for the exact
points where they were flagged as blocking further progress.
