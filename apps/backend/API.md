# Social Downloader Backend — API Reference

Base URL (local): `http://localhost:4000/api/v1`
Base URL (deployed): `https://<your-vercel-app>.vercel.app/api/v1`

All request/response bodies are JSON. All responses go through Nest's global `ValidationPipe` with `whitelist: true, forbidNonWhitelisted: true` — unrecognized body fields cause a `400`, not a silent drop.

---

## Conventions

- **Auth header** (where noted): `Authorization: Bearer <supabase_access_token>`
- **Errors** follow Nest's default shape:
  ```json
  { "statusCode": 400, "message": "url must be a URL address", "error": "Bad Request" }
  ```
- **Rate limiting**: every route is subject to the global throttle (`THROTTLE_LIMIT` requests per `THROTTLE_TTL` seconds per IP, default 30/60s). `POST /download` has its own stricter limit of **10 requests / 60s**. Exceeding it returns `429 Too Many Requests`.

---

## Health

### `GET /health`

No auth, no rate-limit override.

**Response `200`**
```json
{
  "status": "ok",
  "timestamp": "2026-06-26T09:10:00.000Z",
  "uptime": 1234.56
}
```

---

## Auth

Thin wrapper around Supabase Auth. The backend does not issue its own JWTs — it returns whatever Supabase returns.

### `POST /auth/signup`

**Body**
```json
{ "email": "user@example.com", "password": "at-least-8-chars" }
```
| Field | Rule |
|---|---|
| `email` | must be a valid email |
| `password` | string, min length 8 |

**Response `201`** — Supabase `signUp` payload (`{ user, session }`; `session` is `null` if email confirmation is required on your Supabase project).

**Errors**: `401` if Supabase rejects the signup (e.g. email already registered) — note this comes back as 401, not 409, because the service wraps all Supabase auth errors in `UnauthorizedException`.

### `POST /auth/signin`

**Body**
```json
{ "email": "user@example.com", "password": "your-password" }
```

**Response `200`** — Supabase `signInWithPassword` payload, including `session.access_token` (use this as the Bearer token for other calls — see **Known gaps** below for what that token currently does and doesn't unlock).

**Errors**: `401` on invalid credentials.

### `POST /auth/signout`

**Headers**: `Authorization: Bearer <token>`

**Response `200`**
```json
{ "message": "Signed out successfully." }
```

**Errors**: `401` if Supabase rejects the sign-out call.

---

## Download

### `POST /download`

Extracts direct media URL(s) from a public post link.

**Body**
```json
{
  "url": "https://www.instagram.com/reel/ABC123/",
  "quality": "hd"
}
```
| Field | Required | Notes |
|---|---|---|
| `url` | yes | must be `http(s)` |
| `quality` | no | `"hd"` \| `"sd"` — accepted by validation but not currently read by any parser |

**Supported platforms** (checked via regex against the URL, see `src/download/parsers/url-validator.ts`):

| Platform | Matches |
|---|---|
| Instagram | `instagram.com/{p,reel,tv,stories}/...`, `instagr.am/...` |
| Facebook | `facebook.com/.../videos/...`, `facebook.com/watch`, `facebook.com/reel/...`, `fb.watch/...` |
| Twitter/X | `(twitter\|x).com/<user>/status/<id>`, `t.co/...` |
| Pinterest | `pinterest.<tld>/pin/...`, `pin.it/...` |

Anything else → `400 Bad Request`: `"Unsupported platform. Supported: Instagram, Facebook, Twitter/X, TikTok, Pinterest."` (note: the error message currently mentions TikTok, which isn't actually in the regex table above — the message and the implementation have drifted apart).

**Response `200`** (success)
```json
{
  "success": true,
  "metadata": {
    "platform": "instagram",
    "title": "string | undefined",
    "description": "string | undefined",
    "thumbnail": "string | undefined",
    "author": "string | undefined",
    "duration": 0
  },
  "urls": [
    { "url": "https://...", "quality": "hd", "type": "video", "extension": "mp4", "size": 0 }
  ]
}
```

**Response `200`** (parser ran but found nothing, or platform-specific failure) — `success: false` with the same shape; check `success` before reading `urls`.

**Behavior notes:**
- Results are cached (in-memory, per-instance) for `CACHE_TTL` seconds, keyed on a base64 hash of the exact URL string — a trailing slash or query param changes the cache key.
- On a successful extraction, the backend fires-and-forgets two side effects: saving a row to `download_history` and incrementing `analytics_events`. Both failures are caught and logged, never surfaced in the response — a 200 here doesn't guarantee the history/analytics write actually happened.
- `userId` attached to those side-effect writes comes from `req.user?.id`. See **Known gaps** — in the current wiring this is always `undefined`, so every download is currently recorded as anonymous (`user_id: null`) regardless of whether a token was sent.

---

## History

All three routes read `req.user?.id` to scope the query — see **Known gaps**: no guard currently populates this, so in practice these endpoints behave as if every caller has `userId = undefined`.

### `GET /history?page=1&limit=20`

| Query param | Default | Notes |
|---|---|---|
| `page` | `1` | 1-indexed |
| `limit` | `20` | capped at 50 server-side regardless of what you pass |

**Response `200`**
```json
{
  "data": [
    {
      "id": "uuid",
      "user_id": "uuid | null",
      "url": "string",
      "platform": "instagram",
      "title": "string | null",
      "thumbnail": "string | null",
      "media_count": 1,
      "created_at": "2026-06-26T09:10:00.000Z"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 }
}
```

### `DELETE /history/:id`

Deletes the row matching `id` **and** `user_id`. Response `204` regardless of whether a row actually matched (Supabase's `.delete()` doesn't error on zero rows affected).

### `DELETE /history/all`

Deletes every row for the caller's `user_id`. Response `204`.

---

## Analytics

No auth required at the route level (no guard is applied here either, but these endpoints were never user-scoped to begin with — they're aggregate, not per-user).

### `GET /analytics/platforms`

Counts of `analytics_events` rows from the last 30 days, grouped by platform.

**Response `200`**
```json
{
  "last30Days": { "instagram": 42, "facebook": 7 },
  "total": 49
}
```

### `GET /analytics/daily?days=7`

Counts grouped by day, then by platform, going back `days` days (default 7).

**Response `200`**
```json
{
  "2026-06-25": { "instagram": 10, "pinterest": 2 },
  "2026-06-26": { "instagram": 5 }
}
```

---

## Known gaps affecting this API's documented behavior

These are facts about the current implementation that change how the docs above should be read — not editorial opinions:

1. **No route actually enforces auth.** `AuthGuard` / `OptionalAuthGuard` exist in `src/auth/` but `@UseGuards(...)` is never applied to any controller. `req.user` is therefore always `undefined` on `/download` and every `/history/*` route, no matter what `Authorization` header is sent. A Bearer token obtained from `/auth/signin` doesn't currently unlock anything beyond `/auth/signout` itself.
2. **CORS differs by entrypoint.** The Vercel entrypoint (`api/index.ts`, what's actually live in production) allows `GET, POST` only. The local entrypoint (`src/main.ts`) additionally allows `DELETE, OPTIONS`. So `DELETE /history/:id` and `DELETE /history/all` work locally but would be blocked by CORS preflight from a browser hitting the deployed Vercel function.
3. **The 400 error message for unsupported platforms lists TikTok**, but TikTok has no matching pattern in `url-validator.ts` — a TikTok URL will hit the same "unsupported" branch the message is describing.
4. **`quality` is validated but unused** — sending `"sd"` has no effect on the response today.
