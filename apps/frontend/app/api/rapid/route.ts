import { NextRequest, NextResponse } from "next/server";

const RAPID_URL = 'https://instagram120.p.rapidapi.com/api/instagram/reels';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ success: false, error: 'Missing JSON body' }, { status: 400 });

    const key = process.env.RAPIDAPI_KEY;
    if (!key) return NextResponse.json({ success: false, error: 'Server not configured (missing RAPIDAPI_KEY)' }, { status: 500 });

    const res = await fetch(RAPID_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-rapidapi-key': key,
        'x-rapidapi-host': 'instagram120.p.rapidapi.com',
      },
      body: JSON.stringify(body),
    });

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await res.json().catch(() => null);
      return NextResponse.json(data ?? {}, { status: res.status });
    }

    const text = await res.text().catch(() => '');
    return new NextResponse(text, { status: res.status });
  } catch (err) {
    console.error('[rapid proxy] error:', err);
    return NextResponse.json({ success: false, error: 'Proxy error' }, { status: 502 });
  }
}
