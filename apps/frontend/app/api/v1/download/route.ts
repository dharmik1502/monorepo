import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/v1/download
 *
 * This route acts as a smart proxy:
 *  1. If BACKEND_URL is set, it forwards the request to the NestJS backend
 *     (POST /api/v1/download) and returns the response as-is.
 *  2. Otherwise, it falls back to the local Next.js download handler at
 *     /api/download (which uses RapidAPI directly).
 *
 * This lets both apps work in standalone mode AND as an integrated monorepo.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ success: false, error: "Missing JSON body" }, { status: 400 });
    }

    const backendUrl = process.env.BACKEND_URL;

    if (backendUrl) {
      // ── Forward to NestJS backend ──────────────────────────────────────────
      try {
        const target = `${backendUrl}/api/v1/download`;
        const authHeader = req.headers.get("authorization");
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (authHeader) headers["Authorization"] = authHeader;

        const fetchRes = await fetch(target, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30_000),
        });

        const contentType = fetchRes.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const data = await fetchRes.json().catch(() => null);
          return NextResponse.json(data ?? {}, { status: fetchRes.status });
        }

        const text = await fetchRes.text().catch(() => "");
        return new NextResponse(text, { status: fetchRes.status });
      } catch (backendErr) {
        console.warn("[proxy] Backend unreachable, falling back to local handler:", backendErr);
        // Fall through to local handler
      }
    }

    // ── Local fallback: delegate to /api/download ──────────────────────────
    const target = new URL("/api/download", req.url);
    const fetchRes = await fetch(target.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const contentType = fetchRes.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const data = await fetchRes.json().catch(() => null);
      return NextResponse.json(data ?? {}, { status: fetchRes.status });
    }

    const text = await fetchRes.text().catch(() => "");
    return new NextResponse(text, { status: fetchRes.status });
  } catch (err) {
    console.error("[proxy] error:", err);
    return NextResponse.json({ success: false, error: "Proxy error" }, { status: 502 });
  }
}
