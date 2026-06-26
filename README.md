# Social Downloader — Monorepo

A full-stack social media downloader with a **Next.js 15 frontend** and **NestJS backend**, organized as an npm workspace monorepo.

```
root/
├── apps/
│   ├── frontend/        Next.js 15 (App Router) — download UI + API routes
│   └── backend/         NestJS 10 — media extraction, auth, history, analytics
├── package.json         Workspace root with concurrently dev scripts
├── .env.example         Combined env reference for both apps
└── README.md
```

---

## Architecture

| Layer | Tech | Port |
|-------|------|------|
| Frontend | Next.js 15 + Tailwind CSS v4 | 3000 |
| Backend | NestJS 10 + Supabase | 4000 |

### How they communicate

1. The **frontend** UI calls `/api/v1/download` (a Next.js API route).
2. That route checks for `BACKEND_URL` env var:
   - **If set** → proxies the request to `NestJS POST /api/v1/download`
   - **If unset** → falls back to the local Next.js download handler (`/api/download`) which uses RapidAPI directly
3. Media files are streamed through the frontend `/api/proxy` route to avoid CORS issues on download.

---

## Prerequisites

- Node.js ≥ 20
- npm ≥ 9 (workspaces support)
- A [Supabase](https://supabase.com) project (for auth, history, analytics)
- A [RapidAPI](https://rapidapi.com) key (free tier works)

---

## Installation

```bash
# 1. Clone the repo
git clone <your-repo-url>
cd social-downloader-monorepo

# 2. Install all dependencies (root + both apps)
npm install

# 3. Set up environment variables
#    Frontend:
cp .env.example apps/frontend/.env.local
#    Backend:
cp .env.example apps/backend/.env
# Edit both files with your actual keys
```

---

## Environment Setup

### Frontend (`apps/frontend/.env.local`)

| Variable | Required | Description |
|----------|----------|-------------|
| `RAPIDAPI_KEY` | Recommended | RapidAPI key for social media APIs |
| `BACKEND_URL` | Optional | NestJS backend URL (e.g. `http://localhost:4000`) |
| `NEXT_PUBLIC_BACKEND_URL` | Optional | Same, exposed to client-side code |

### Backend (`apps/backend/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Port to run on (default: `4000`) |
| `SUPABASE_URL` | Yes | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | Yes | Supabase anon (public) key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key |
| `ALLOWED_ORIGINS` | Yes | Comma-separated allowed CORS origins |
| `THROTTLE_TTL` | No | Rate limit window in seconds (default: 60) |
| `THROTTLE_LIMIT` | No | Requests per window (default: 30) |
| `CACHE_TTL` | No | Download cache TTL in seconds (default: 300) |
| `SCRAPE_CREATORS_API_KEY` | Optional | ScrapeCreators API key for enhanced extraction |

---

## Development

```bash
# Run both apps simultaneously
npm run dev

# Or run individually
npm run dev:frontend     # Next.js on http://localhost:3000
npm run dev:backend      # NestJS on http://localhost:4000
```

---

## Build

```bash
# Build both apps
npm run build

# Build individually
npm run build:frontend
npm run build:backend
```

---

## Start (Production)

```bash
# Build first, then start
npm run build
npm run start
```

---

## Backend API Endpoints

Base URL: `http://localhost:4000/api/v1`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/download` | Extract media info from URL |
| `POST` | `/auth/signup` | Register a new user |
| `POST` | `/auth/signin` | Sign in and get JWT |
| `POST` | `/auth/signout` | Sign out |
| `GET` | `/history` | Get user download history (auth required) |
| `DELETE` | `/history/:id` | Delete a history item (auth required) |
| `DELETE` | `/history/all` | Clear all history (auth required) |
| `GET` | `/analytics/stats` | Platform download stats |

### Download endpoint

```http
POST /api/v1/download
Content-Type: application/json

{
  "url": "https://www.instagram.com/reel/ABC123/",
  "quality": "hd"   // optional: "hd" | "sd"
}
```

---

## Supported Platforms

| Platform | Supported Content |
|----------|------------------|
| Instagram | Reels, Posts, Stories, IGTV, Profiles |
| Facebook | Videos, Reels, Stories, Photos |
| TikTok | Videos (with/without watermark), Audio |
| YouTube | Videos, Shorts, Audio |
| Twitter/X | Videos, GIFs |
| Pinterest | Pins |

---

## Supabase Database Setup

Run the SQL schema to create required tables:

```bash
# The schema file is at:
apps/backend/supabase/schema.sql
```

Apply it via Supabase dashboard → SQL Editor, or use the Supabase CLI:
```bash
supabase db push --db-url "$DATABASE_URL"
```

---

## Deployment

### Frontend (Vercel)

```bash
cd apps/frontend
vercel deploy
# Set env vars in Vercel dashboard:
#   RAPIDAPI_KEY, BACKEND_URL (your deployed backend URL)
```

### Backend (Vercel / Railway / Render)

The backend includes a `vercel.json` for serverless deployment:

```bash
cd apps/backend
vercel deploy
# Set all backend env vars in Vercel dashboard
```

For Railway/Render, use:
```bash
npm run build && npm run start:prod
```

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Port 3000/4000 in use | Change `PORT` in `apps/backend/.env` and update `BACKEND_URL` in frontend |
| CORS errors | Add your frontend URL to `ALLOWED_ORIGINS` in backend `.env` |
| Download returns empty | Add `RAPIDAPI_KEY` to `apps/frontend/.env.local` |
| Supabase auth fails | Check `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are correct |
| Backend not reachable | Ensure backend is running: `npm run dev:backend` |
