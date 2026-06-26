# Social Downloader — Backend

NestJS 10 service that extracts direct media URLs from public social posts (Instagram, Facebook, Twitter/X, Pinterest), with optional Supabase-backed auth, per-user download history, and basic analytics. Deployed as a Vercel serverless function, but runs equally well as a standalone Node process.

> This README documents the backend exactly as implemented in `apps/backend/src`. Where the code's behavior differs from what you might expect (see **Known gaps** at the bottom), that's called out explicitly rather than glossed over.

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | NestJS 10 (Express platform) |
| Language | TypeScript 5 |
| Database / Auth | Supabase (Postgres + Supabase Auth) |
| Caching | `@nestjs/cache-manager` (in-memory) |
| Rate limiting | `@nestjs/throttler` |
| HTML scraping | `axios` + `cheerio` |
| Security headers | `helmet` |
| Deployment | Vercel serverless (`@vercel/node`), via `api/index.ts` |

---

## Project structure

```
apps/backend/
├── api/
│   └── index.ts            # Vercel serverless entrypoint (wraps the Nest app)
├── src/
│   ├── main.ts              # Local/standalone entrypoint (npm run start:dev)
│   ├── app.module.ts         # Root module — wires everything together
│   ├── auth/                 # Signup/signin/signout, JWT verification guards
│   ├── download/              # Core media-extraction logic
│   │   ├── parsers/            # One parser per platform + URL detection
│   │   └── dto/
│   ├── history/                # Per-user download history (Supabase-backed)
│   ├── analytics/                # Aggregate download stats
│   ├── supabase/                  # Supabase client wrapper
│   └── health/                     # Liveness check
├── supabase/
│   └── schema.sql            # Table definitions + RLS policies
├── scripts/
│   └── download_reels.js     # Standalone CLI script (uses ScrapeCreators API)
├── vercel.json
└── .env.example
```

---

## Getting started

### Prerequisites

- Node.js ≥ 20
- A [Supabase](https://supabase.com) project

### Install & run

```bash
cd apps/backend
npm install
cp .env.example .env     # then fill in real values
npm run start:dev        # http://localhost:4000, prefix /api/v1
```

Other scripts: `npm run build`, `npm run start:prod`, `npm run lint`, `npm run test`.

### Database setup

Apply the schema before running anything that touches `download_history` or `analytics_events`:

```bash
# Supabase dashboard → SQL Editor → paste contents of:
apps/backend/supabase/schema.sql
```

---

## Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `PORT` | No | `4000` | Local dev only — ignored on Vercel |
| `SUPABASE_URL` | Yes | — | Project URL |
| `SUPABASE_ANON_KEY` | Yes | — | Used for `signUp` / `signIn` / `signOut` |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | — | Used for all `download_history` / `analytics_events` reads/writes (bypasses RLS) |
| `ALLOWED_ORIGINS` | Recommended | `http://localhost:3000` | Comma-separated. `*` disables the allow-list check |
| `THROTTLE_TTL` | No | `60` (seconds) | Global rate-limit window |
| `THROTTLE_LIMIT` | No | `30` | Global max requests per window |
| `CACHE_TTL` | No | `300` (seconds) | How long a successful extraction is cached |
| `SCRAPE_CREATORS_API_KEY` | No | — | Only used by `scripts/download_reels.js`, not by the live API |
| `APP_SECRET` | Listed in `.env.example` | — | Not currently referenced anywhere in `src/` |
| `DATABASE_URL` | Listed in `.env.example` | — | Not currently referenced anywhere in `src/` (Supabase client only needs the two keys above) |

⚠️ The committed `.env.example` has a real-looking value in `SCRAPE_CREATORS_API_KEY` rather than a placeholder. Worth confirming that isn't a live key before this file goes anywhere public.

---

## API reference

Base URL: `/api/v1` (set via `setGlobalPrefix` in both entrypoints).

### Health

```
GET /api/v1/health
```
→ `{ status: "ok", timestamp, uptime }`

### Auth

| Method | Path | Body | Notes |
|---|---|---|---|
| `POST` | `/auth/signup` | `{ email, password }` (password ≥ 8 chars) | Proxies to Supabase `auth.signUp` |
| `POST` | `/auth/signin` | `{ email, password }` | Proxies to Supabase `auth.signInWithPassword`, returns session + JWT |
| `POST` | `/auth/signout` | — (`Authorization: Bearer <token>`) | Proxies to Supabase `auth.signOut` |

### Download

```
POST /api/v1/download
Content-Type: application/json

{
  "url": "https://www.instagram.com/reel/ABC123/",
  "quality": "hd"   // optional: "hd" | "sd" — accepted but not yet read by any parser
}
```

- Throttled separately at **10 requests / 60s** (tighter than the global default).
- Detects platform from the URL via regex (`src/download/parsers/url-validator.ts`), then dispatches to a per-platform parser.
- Successful results are cached for `CACHE_TTL` seconds, keyed by base64 of the URL.
- On success, fires-and-forgets a write to `history` and `analytics` (failures there are swallowed, not surfaced to the caller).

**Currently supported platforms:** Instagram (posts/reels/IGTV/stories), Facebook (videos/watch/reels), Twitter/X (status links), Pinterest (pins).

### History

| Method | Path | Notes |
|---|---|---|
| `GET` | `/history?page=1&limit=20` | `limit` capped at 50 server-side |
| `DELETE` | `/history/:id` | Deletes one row scoped to `user_id` |
| `DELETE` | `/history/all` | Deletes all rows for `user_id` |

### Analytics

| Method | Path | Notes |
|---|---|---|
| `GET` | `/analytics/platforms` | Counts per platform over the last 30 days |
| `GET` | `/analytics/daily?days=7` | Counts per platform, grouped by day |

---

## Caching & rate limiting

- **Cache**: in-memory (`CacheModule.register`), TTL = `CACHE_TTL` seconds, max 500 entries. Not shared across serverless instances — on Vercel, cache hit rate will be low/inconsistent because each cold-started function gets its own memory.
- **Rate limiting**: global default `THROTTLE_LIMIT` requests per `THROTTLE_TTL` seconds (per IP), with `/download` overridden to a stricter 10/60s.

---

## Database schema

Defined in `supabase/schema.sql`:

- **`download_history`** — `id, user_id, url, platform, title, thumbnail, media_count, created_at`. RLS lets a user `SELECT`/`DELETE` their own rows; the service role (used by the backend) bypasses RLS entirely.
- **`analytics_events`** — `id, platform, user_id, created_at`. Only the service role can read/write under the current policies (no end-user-facing read policy exists, even though `/analytics/*` is a public endpoint — see below).
- A `cleanup_old_history()` SQL function purges history > 90 days and analytics > 180 days old. It's defined but the `pg_cron` schedule line is commented out — it won't run on its own until someone enables `pg_cron` and uncomments the `cron.schedule(...)` call.

---

## Deployment

**Vercel** (primary target — `vercel.json` is preconfigured):
```bash
cd apps/backend
vercel deploy
# set all variables from the table above in the Vercel dashboard
```
`api/index.ts` is the actual serverless entrypoint; it prefers the compiled `dist/src/app.module` and falls back to `src/app.module` if `dist` wasn't built/included.

**Any Node host** (Railway, Render, a VM, etc.):
```bash
npm run build
npm run start:prod   # runs dist/src/main.js, uses src/main.ts's bootstrap
```

---

## Known gaps (accurate as of this codebase snapshot)

A few things worth knowing before relying on this service, found while writing this doc:

1. **Auth guards aren't wired up.** `AuthGuard` and `OptionalAuthGuard` exist and are exported from `AuthModule`, but no controller applies `@UseGuards(...)` anywhere in `src/`. In practice, `/download` and `/history/*` never populate `req.user` from a token — `history` calls will run with `user_id = undefined`, and the "auth required" framing in the root monorepo README doesn't match current behavior.
2. **CORS differs between the two entrypoints.** `src/main.ts` (local/standalone) allows `GET, POST, DELETE, OPTIONS`. `api/index.ts` (the Vercel entrypoint actually used in production) only allows `GET, POST` — so cross-origin `DELETE /history/:id` and `DELETE /history/all` calls would currently be blocked by the browser in the deployed environment.
3. **`quality` is accepted but unused.** The DTO validates `quality?: 'hd' | 'sd'`, but no parser currently branches on it.
4. **`DATABASE_URL` and `APP_SECRET`** are listed in `.env.example` but never read in `src/`.
