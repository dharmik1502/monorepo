import { NextRequest, NextResponse } from "next/server";

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function headersForDomain(url: string): Record<string, string> {
  if (url.includes("fastsaver.co")) {
    return {
      "User-Agent": UA,
      Referer: "https://fastsaver.co/",
      Origin: "https://fastsaver.co",
      Accept: "*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "identity",
    };
  }
  // Instagram CDN (scontent-*.cdninstagram.com, etc.)
  return {
    "User-Agent": UA,
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "identity",
    Referer: "https://www.instagram.com/",
    Origin: "https://www.instagram.com",
    "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Linux"',
    "sec-fetch-dest": "video",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "cross-site",
    Connection: "keep-alive",
  };
}

export async function GET(req: NextRequest) {
  const mediaUrl = req.nextUrl.searchParams.get("url");

  if (!mediaUrl) {
    return NextResponse.json({ error: "URL parameter required" }, { status: 400 });
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(mediaUrl);
  } catch {
    return NextResponse.json({ error: "Invalid URL encoding" }, { status: 400 });
  }

  if (!decoded.startsWith("https://") && !decoded.startsWith("http://")) {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  const rangeHeader = req.headers.get("range");

  try {
    // Step 1: fetch with domain-appropriate headers, but handle redirects manually
    // so we can switch headers when a redirect crosses to a different domain.
    const step1Headers: Record<string, string> = { ...headersForDomain(decoded) };
    if (rangeHeader) step1Headers["Range"] = rangeHeader;

    const step1 = await fetch(decoded, {
      headers: step1Headers,
      redirect: "manual", // we'll follow manually to pick correct headers per hop
    });

    let finalResponse: Response;

    if (step1.status >= 300 && step1.status < 400) {
      // Follow the redirect with headers appropriate for the destination
      const location = step1.headers.get("location");
      if (!location) {
        return NextResponse.json({ error: "Redirect with no location" }, { status: 502 });
      }
      const step2Headers: Record<string, string> = { ...headersForDomain(location) };
      if (rangeHeader) step2Headers["Range"] = rangeHeader;

      finalResponse = await fetch(location, {
        headers: step2Headers,
        redirect: "follow", // follow any further hops automatically
      });
    } else {
      finalResponse = step1;
    }

    if (!finalResponse.ok && finalResponse.status !== 206) {
      return NextResponse.json(
        {
          error: `Upstream returned ${finalResponse.status}. The media link may have expired — try fetching again.`,
        },
        { status: 502 }
      );
    }

    const contentType =
      finalResponse.headers.get("content-type") || "application/octet-stream";
    const ext = contentType.includes("video")
      ? "mp4"
      : contentType.includes("jpeg") || contentType.includes("jpg")
      ? "jpg"
      : contentType.includes("png")
      ? "png"
      : "mp4";

    const responseHeaders: Record<string, string> = {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="instagram-download.${ext}"`,
      "Cache-Control": "no-store",
    };

    const contentLength = finalResponse.headers.get("content-length");
    if (contentLength) responseHeaders["Content-Length"] = contentLength;

    const contentRange = finalResponse.headers.get("content-range");
    if (contentRange) responseHeaders["Content-Range"] = contentRange;

    return new NextResponse(finalResponse.body, {
      status: finalResponse.status,
      headers: responseHeaders,
    });
  } catch (err) {
    console.error("[proxy] error:", err);
    return NextResponse.json({ error: "Proxy error. Please try again." }, { status: 500 });
  }
}
