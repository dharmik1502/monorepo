import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

// ─── Types ────────────────────────────────────────────────────────────────────

type DownloadItem = { quality: string; url: string; format: string; size?: number | null };
type MediaResult = {
  title: string;
  thumbnail: string | null;
  downloads: DownloadItem[];
  description?: string | null;
  author?: string | null;
  duration?: number | null;
};

// ─── Config ───────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min
const NO_MEDIA_ERROR_MESSAGE =
  "Could not extract media. The content may be private, deleted, or temporarily unavailable.";

// Simple in-process cache (resets on each cold start, fine for serverless)
const cache = new Map<string, { data: object; exp: number }>();

function fromCache(key: string): object | null {
  const entry = cache.get(key);
  if (!entry || Date.now() > entry.exp) return null;
  return entry.data;
}
function toCache(key: string, data: object) {
  cache.set(key, { data, exp: Date.now() + CACHE_TTL_MS });
}

function normalizeQuality(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim().toLowerCase();
}

function selectDownloadsByQuality(downloads: DownloadItem[], quality?: string | null): DownloadItem[] {
  if (!quality) return downloads;
  const normalized = quality.toLowerCase();
  const exactMatches = downloads.filter((item) => item.quality.toLowerCase() === normalized);
  if (exactMatches.length) return exactMatches;

  const containsMatches = downloads.filter(
    (item) =>
      item.quality.toLowerCase().includes(normalized) ||
      item.format.toLowerCase() === normalized ||
      (normalized === "hd" && item.quality.toLowerCase().includes("hd")) ||
      (normalized === "sd" && item.quality.toLowerCase().includes("sd"))
  );
  return containsMatches.length ? containsMatches : downloads;
}

// ─── Platform detection ───────────────────────────────────────────────────────

type PlatformInfo = { platform: string; type: string };

function detectPlatform(url: string): PlatformInfo | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    const path = parsed.pathname.toLowerCase();

    const normalizedHost =
      host === "instagram.com" || host === "instagr.am" || host.endsWith(".instagram.com")
        ? "instagram.com"
        : host;

    if (normalizedHost === "instagram.com" || normalizedHost === "instagr.am") {
      if (/\/reels?(\/|$)/.test(path)) return { platform: "instagram", type: "reel" };
      if (/\/p\//.test(path)) return { platform: "instagram", type: "post" };
      if (/\/stories\//.test(path)) return { platform: "instagram", type: "story" };
      if (/\/tv\//.test(path)) return { platform: "instagram", type: "igtv" };
      if (/^\/[^/]+\/?$/.test(path)) return { platform: "instagram", type: "profile" };
      return { platform: "instagram", type: "post" };
    }
    if (["facebook.com", "fb.com", "fb.watch", "m.facebook.com"].includes(host)) {
      if (/\/watch/.test(path) || /\/videos\//.test(path) || host === "fb.watch")
        return { platform: "facebook", type: "video" };
      if (/\/reels?(\/|$)/.test(path)) return { platform: "facebook", type: "reel" };
      if (/\/stories\//.test(path)) return { platform: "facebook", type: "story" };
      if (/\/photo\//.test(path)) return { platform: "facebook", type: "photo" };
      return { platform: "facebook", type: "video" };
    }
    if (["tiktok.com", "vm.tiktok.com", "vt.tiktok.com"].includes(host)) {
      return { platform: "tiktok", type: "video" };
    }
    if (["youtube.com", "youtu.be", "m.youtube.com"].includes(host)) {
      if (/\/shorts\//.test(path)) return { platform: "youtube", type: "shorts" };
      return { platform: "youtube", type: "video" };
    }
    if (["twitter.com", "x.com", "t.co"].includes(host)) {
      return { platform: "twitter", type: "post" };
    }
    if (["pinterest.com", "pin.it"].includes(host)) {
      return { platform: "pinterest", type: "pin" };
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Shared fetch helper ──────────────────────────────────────────────────────

async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

// ─── ScrapeCreators ───────────────────────────────────────────────────────────

async function tryScrapeCreators(url: string): Promise<MediaResult | null> {
  const key = process.env.SCRAPE_CREATORS_API_KEY;
  if (!key) return null;

  try {
    const target = new URL("https://api.scrapecreators.com/v1/instagram/post");
    target.searchParams.set("url", url);
    target.searchParams.set("trim", "true");
    target.searchParams.set("download_media", "true");

    const res = await apiFetch(target.toString(), {
      headers: {
        "x-api-key": key,
        "Accept": "application/json",
      },
    });

    if (!res.ok) return null;
    const body = await res.json();
    if (!body || body.success === false) return null;

    const downloads: DownloadItem[] = [];
    const media = body?.data?.xdt_shortcode_media;

    const tryPush = (cdnUrl: string, type: string, quality: string, format: string) => {
      if (cdnUrl && !downloads.some((d) => d.url === cdnUrl)) {
        downloads.push({ quality, url: cdnUrl, format });
      }
    };

    // A. Prefer cached Supabase URLs
    if (Array.isArray(body?.download_media_urls) && body.download_media_urls.length > 0) {
      for (const item of body.download_media_urls) {
        if (item?.cdn_url) {
          const isVideo = item.type !== "image";
          tryPush(item.cdn_url, isVideo ? "video" : "image", "HD", isVideo ? "mp4" : "jpg");
        }
      }
    }

    // B. Direct CDN URLs from xdt_shortcode_media
    if (media) {
      if (media.video_url) {
        tryPush(media.video_url, "video", "HD", "mp4");
      }

      if (!media.video_url) {
        if (media.display_url) {
          tryPush(media.display_url, "image", "Original", "jpg");
        }
        if (Array.isArray(media.display_resources)) {
          const sorted = [...media.display_resources]
            .filter((r) => r?.src)
            .sort((a, b) => (b.config_width ?? 0) - (a.config_width ?? 0));
          for (const r of sorted) {
            tryPush(r.src, "image", "Original", "jpg");
          }
        }
      }

      // Carousel / sidecar
      const sidecarEdges = media?.edge_sidecar_to_children?.edges;
      if (Array.isArray(sidecarEdges)) {
        for (const item of sidecarEdges) {
          const node = item?.node;
          if (!node) continue;
          if (node.video_url) {
            tryPush(node.video_url, "video", "HD", "mp4");
          }
          if (!node.video_url) {
            if (node.display_url) {
              tryPush(node.display_url, "image", "Original", "jpg");
            }
            if (node.thumbnail_src) {
              tryPush(node.thumbnail_src, "image", "Thumbnail", "jpg");
            }
            if (Array.isArray(node.display_resources)) {
              const sorted = [...node.display_resources]
                .filter((r) => r?.src)
                .sort((a, b) => (b.config_width ?? 0) - (a.config_width ?? 0));
              for (const r of sorted) {
                tryPush(r.src, "image", "Original", "jpg");
              }
            }
          }
        }
      }

      // Thumbnail fallback
      if (downloads.length === 0 && media.thumbnail_src) {
        tryPush(media.thumbnail_src, "image", "Thumbnail", "jpg");
      }
    }

    if (downloads.length === 0) return null;

    const caption = media?.edge_media_to_caption?.edges?.[0]?.node?.text ?? "";
    const title = caption || media?.title || "Instagram Post";
    const thumbnail = media?.thumbnail_src || media?.display_url || null;

    return {
      title,
      thumbnail,
      downloads,
      description: caption || null,
      author: media?.owner?.username || null,
    };
  } catch (err) {
    console.error("ScrapeCreators error:", err);
    return null;
  }
}

// ─── Cobalt ───────────────────────────────────────────────────────────────────

async function tryCobalt(url: string): Promise<MediaResult | null> {
  try {
    const res = await apiFetch("https://api.cobalt.tools/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        url,
        videoQuality: "max",
        audioFormat: "best",
        downloadMode: "auto",
        filenameStyle: "classic",
      }),
    });
    if (!res.ok) {
      console.warn(`[cobalt] HTTP ${res.status}`);
      return null;
    }
    const d = await res.json() as {
      status?: string;
      url?: string;
      filename?: string;
      picker?: { url?: string; type?: string; thumb?: string }[];
    };
    console.log("[cobalt] status:", d?.status);

    if (d?.status === "error") return null;

    const downloads: DownloadItem[] = [];

    if (["stream", "redirect", "tunnel"].includes(d?.status ?? "") && d?.url) {
      const fname: string = d.filename ?? "";
      const format = fname.endsWith(".mp3") ? "mp3" : fname.endsWith(".jpg") ? "jpg" : "mp4";
      downloads.push({ quality: "HD", url: d.url, format });
    } else if (d?.status === "picker" && Array.isArray(d?.picker)) {
      d.picker
        .filter((item) => item?.url)
        .slice(0, 4)
        .forEach((item, i) => {
          downloads.push({
            quality: i === 0 ? "HD" : `Item ${i + 1}`,
            url: item.url!,
            format: item.type === "photo" ? "jpg" : "mp4",
          });
        });
    }

    if (!downloads.length) return null;

    const pickerThumb =
      d?.status === "picker" ? (d.picker?.[0]?.thumb ?? null) : null;

    return {
      title: d.filename?.replace(/\.[^.]+$/, "") ?? "Downloaded Content",
      thumbnail: pickerThumb,
      downloads,
    };
  } catch (err) {
    console.error("[cobalt] error:", err instanceof Error ? err.message : err);
    return null;
  }
}

// ─── SnapInsta ────────────────────────────────────────────────────────────────

async function trySnapInsta(url: string): Promise<MediaResult | null> {
  try {
    const body = new URLSearchParams({ url, lang: "en" });
    const res = await apiFetch("https://snapinsta.app/api", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        Referer: "https://snapinsta.app/",
        Origin: "https://snapinsta.app",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
      body: body.toString(),
    });
    if (!res.ok) return null;
    const d = await res.json() as { data?: string };
    const html: string = typeof d?.data === "string" ? d.data : "";
    if (!html) return null;

    const downloads: DownloadItem[] = [];

    const videoRe = /href="(https?:\/\/[^"]*\.mp4[^"]*)"/g;
    let m: RegExpExecArray | null;
    while ((m = videoRe.exec(html)) !== null && downloads.length < 3) {
      downloads.push({
        quality: downloads.length === 0 ? "HD" : "SD",
        url: m[1],
        format: "mp4",
      });
    }

    if (!downloads.length) {
      const imgRe = /href="(https?:\/\/[^"]*\.jpg[^"]*)"/g;
      const im = imgRe.exec(html);
      if (im) downloads.push({ quality: "HD", url: im[1], format: "jpg" });
    }

    if (!downloads.length) return null;

    const thumbMatch = html.match(/src="(https?:\/\/[^"]+\.jpg[^"]*)"/);
    return {
      title: "Instagram Content",
      thumbnail: thumbMatch?.[1] ?? null,
      downloads,
    };
  } catch {
    return null;
  }
}

// ─── Igram ────────────────────────────────────────────────────────────────────

async function tryIgram(url: string): Promise<MediaResult | null> {
  try {
    const body = new URLSearchParams({ q: url, t: "media", lang: "en" });
    const res = await apiFetch("https://igram.world/api/ajaxSearch", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        Referer: "https://igram.world/",
        Origin: "https://igram.world",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "application/json, text/javascript, */*; q=0.01",
      },
      body: body.toString(),
    });
    if (!res.ok) return null;
    const d = await res.json() as { data?: string };
    const html: string = typeof d?.data === "string" ? d.data : "";
    if (!html) return null;

    const downloads: DownloadItem[] = [];
    const seen = new Set<string>();

    const videoRe = /href="(https?:\/\/[^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = videoRe.exec(html)) !== null && downloads.length < 4) {
      const link = m[1];
      if (
        !seen.has(link) &&
        (link.includes(".mp4") || link.includes("download") || link.includes("cdn"))
      ) {
        seen.add(link);
        downloads.push({
          quality: downloads.length === 0 ? "HD" : "SD",
          url: link,
          format: link.includes(".mp3") ? "mp3" : "mp4",
        });
      }
    }

    if (!downloads.length) {
      const imgRe = /href="(https?:\/\/[^"]+\.(?:jpg|jpeg|png)[^"]*)"/;
      const im = imgRe.exec(html);
      if (im) downloads.push({ quality: "HD", url: im[1], format: "jpg" });
    }

    if (!downloads.length) return null;

    const thumbMatch = html.match(/src="(https?:\/\/[^"]+\.(?:jpg|jpeg|png)[^"]*)"/);
    return {
      title: "Instagram Content",
      thumbnail: thumbMatch?.[1] ?? null,
      downloads,
    };
  } catch {
    return null;
  }
}

// ─── Instagram Direct ─────────────────────────────────────────────────────────

async function tryInstagramDirect(url: string): Promise<MediaResult | null> {
  const match = url.match(/instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
  if (!match) return null;
  const code = match[1];

  const attempts = [
    { fetchUrl: `https://www.instagram.com/p/${code}/?__a=1&__d=dis`, expectJson: true },
    { fetchUrl: `https://www.instagram.com/reel/${code}/?__a=1&__d=dis`, expectJson: true },
    { fetchUrl: `https://www.instagram.com/p/${code}/`, expectJson: false },
  ];

  for (const { fetchUrl, expectJson } of attempts) {
    try {
      const res = await apiFetch(fetchUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21A329 Instagram 307.0.0.37.107 (iPhone14,3; iOS 17_0; en_US; en-US; scale=3.00; 1284x2778; 550358942)",
          Accept: expectJson
            ? "application/json, text/plain, */*"
            : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "X-IG-App-ID": "936619743392459",
          "X-IG-WWW-Claim": "0",
          Referer: "https://www.instagram.com/",
          "Cache-Control": "no-cache",
          "Sec-Fetch-Site": expectJson ? "same-origin" : "none",
          "Sec-Fetch-Mode": expectJson ? "cors" : "navigate",
        },
      });
      if (!res.ok) continue;

      const text = await res.text();

      if (expectJson) {
        try {
          const data = JSON.parse(text) as {
            graphql?: { shortcode_media?: Record<string, unknown> };
            items?: Record<string, unknown>[];
            data?: { shortcode_media?: Record<string, unknown> };
          };
          const media =
            data?.graphql?.shortcode_media ||
            data?.items?.[0] ||
            data?.data?.shortcode_media;

          if (media && typeof media === "object") {
            const videoUrl = typeof media["video_url"] === "string" ? media["video_url"] : undefined;
            const thumbUrl =
              typeof media["thumbnail_src"] === "string"
                ? media["thumbnail_src"]
                : typeof media["display_url"] === "string"
                ? media["display_url"]
                : undefined;
            const edges = (media["edge_media_to_caption"] as { edges?: { node?: { text?: string } }[] } | undefined)?.edges;
            const caption = edges?.[0]?.node?.text;

            if (videoUrl) {
              return {
                title: caption?.slice(0, 80) || "Instagram Video",
                thumbnail: thumbUrl || null,
                downloads: [{ quality: "HD", url: videoUrl, format: "mp4" }],
              };
            }
            if (thumbUrl) {
              return {
                title: caption?.slice(0, 80) || "Instagram Photo",
                thumbnail: thumbUrl,
                downloads: [{ quality: "HD", url: thumbUrl, format: "jpg" }],
              };
            }
          }
        } catch {
          // not JSON, fall through
        }
      }

      const videoPatterns = [
        /"video_url":"(https:[^"]+)"/,
        /"playable_url":"(https:[^"]+)"/,
        /"video_url_quality_hd":"(https:[^"]+)"/,
        /"contentUrl"\s*:\s*"(https:[^"]+)"/,
        /property="og:video(?::secure_url)?"\s+content="([^"]+)"/i,
        /<meta[^>]+property="og:video(?::secure_url)?"[^>]+content="([^"]+)"/i,
      ];
      for (const p of videoPatterns) {
        const m2 = text.match(p);
        if (m2?.[1]) {
          const videoUrl = m2[1].replace(/\\u0026/g, "&").replace(/\\(?!u)/g, "");
          return {
            title: "Instagram Video",
            thumbnail: null,
            downloads: [{ quality: "HD", url: videoUrl, format: "mp4" }],
          };
        }
      }
    } catch {
      continue;
    }
  }
  return null;
}

// ─── Instagram Embed ──────────────────────────────────────────────────────────

async function tryInstagramEmbed(url: string): Promise<MediaResult | null> {
  const match = url.match(/instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
  if (!match) return null;
  const code = match[1];
  const isReel = /\/(reel|reels)\//.test(url);

  const embedUrls = isReel
    ? [
        `https://www.instagram.com/reel/${code}/embed/`,
        `https://www.instagram.com/p/${code}/embed/captioned/`,
        `https://www.instagram.com/p/${code}/embed/`,
      ]
    : [
        `https://www.instagram.com/p/${code}/embed/captioned/`,
        `https://www.instagram.com/p/${code}/embed/`,
        `https://www.instagram.com/reel/${code}/embed/`,
      ];

  const headers = {
    "User-Agent":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://www.instagram.com/",
  };

  const videoPatterns = [
    /"video_url":"(https:[^"]+)"/,
    /"playable_url":"(https:[^"]+)"/,
    /"video_url_quality_hd":"(https:[^"]+)"/,
    /"contentUrl"\s*:\s*"(https:[^"]+)"/,
    /property="og:video"\s+content="([^"]+)"/i,
    /<meta[^>]+property="og:video"[^>]+content="([^"]+)"/i,
    /src="(https:\/\/[^"]+\.mp4[^"]*)"/,
  ];
  const thumbPatterns = [
    /"thumbnail_src":"(https:[^"]+)"/,
    /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i,
    /property="og:image"\s+content="([^"]+)"/i,
  ];
  const imgPatterns = [
    /"display_url":"(https:[^"]+)"/,
    /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i,
  ];

  function safeUnescape(raw: string): string {
    try {
      return JSON.parse(`"${raw}"`);
    } catch {
      return raw;
    }
  }

  for (const embedUrl of embedUrls) {
    try {
      const res = await apiFetch(embedUrl, { headers });
      if (!res.ok) continue;
      const html = await res.text();

      for (const p of videoPatterns) {
        const m2 = html.match(p);
        if (m2?.[1]) {
          const videoUrl = safeUnescape(m2[1]);
          let thumbnail: string | null = null;
          for (const tp of thumbPatterns) {
            const tm = html.match(tp);
            if (tm?.[1]) {
              thumbnail = safeUnescape(tm[1]);
              break;
            }
          }
          return {
            title: "Instagram Video",
            thumbnail,
            downloads: [{ quality: "HD", url: videoUrl, format: "mp4" }],
          };
        }
      }

      for (const p of imgPatterns) {
        const m2 = html.match(p);
        if (m2?.[1]) {
          const imageUrl = safeUnescape(m2[1]);
          return {
            title: "Instagram Photo",
            thumbnail: imageUrl,
            downloads: [{ quality: "HD", url: imageUrl, format: "jpg" }],
          };
        }
      }
    } catch {
      // try next URL
    }
  }
  return null;
}

// ─── Facebook ─────────────────────────────────────────────────────────────────

async function tryTikwmFree(url: string): Promise<MediaResult | null> {
  try {
    const body = new URLSearchParams({ url, count: "12", cursor: "0", web: "1", hd: "1" });
    const res = await apiFetch("https://www.tikwm.com/api/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) return null;
    const d = await res.json() as {
      data?: {
        play?: string;
        hdplay?: string;
        wmplay?: string;
        music?: string;
        title?: string;
        cover?: string;
      };
    };
    const data = d?.data;
    if (!data?.play) return null;
    const base = "https://www.tikwm.com";
    const downloads: DownloadItem[] = [
      { quality: "HD (No Watermark)", url: `${base}${data.hdplay || data.play}`, format: "mp4" },
    ];
    if (data.wmplay) downloads.push({ quality: "SD (Watermark)", url: `${base}${data.wmplay}`, format: "mp4" });
    if (data.music) downloads.push({ quality: "Audio", url: `${base}${data.music}`, format: "mp3" });
    return {
      title: data.title || "TikTok Video",
      thumbnail: data.cover ? `${base}${data.cover}` : null,
      downloads,
    };
  } catch {
    return null;
  }
}

// ─── YouTube ──────────────────────────────────────────────────────────────────

function extractVideoId(url: string): string | null {
  const patterns = [
    /youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})/,
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}



// ─── Provider chain runner ────────────────────────────────────────────────────

async function tryProviders(
  label: string,
  providers: { name: string; fn: () => Promise<MediaResult | null> }[]
): Promise<MediaResult | null> {
  for (const { name, fn } of providers) {
    try {
      console.log(`[download] trying provider: ${label}:${name}`);
      const result = await fn();
      if (result && result.downloads.length > 0) {
        console.log(`[download] SUCCESS: ${label}:${name}`);
        return result;
      }
      console.warn(`[download] EMPTY:  ${label}:${name}`);
    } catch (err) {
      console.error(`[download] ERROR:  ${label}:${name} →`, err instanceof Error ? err.message : err);
    }
  }
  console.error(`[download] ALL providers exhausted for ${label}`);
  return null;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let url: string;
  let requestedQuality: string | null = null;
  try {
    const body = await req.json() as { url?: unknown; quality?: unknown };
    url = (typeof body?.url === "string" ? body.url : "").trim();
    requestedQuality = normalizeQuality(body?.quality);
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
  }

  if (!url) {
    return NextResponse.json({ success: false, error: "URL is required." }, { status: 400 });
  }

  try {
    new URL(url);
  } catch {
    return NextResponse.json({ success: false, error: "Invalid URL." }, { status: 400 });
  }

  const detected = detectPlatform(url);
  if (!detected) {
    return NextResponse.json(
      {
        success: false,
        error: "Unsupported platform. Supported: Instagram, Facebook, TikTok, YouTube, Pinterest.",
      },
      { status: 400 }
    );
  }

  const { platform, type } = detected;

  const cacheKey = `${platform}:${url}`;
  const cached = fromCache(cacheKey);
  if (cached) {
    return NextResponse.json(cached);
  }

  let result: MediaResult | null = null;

  switch (platform) {
    case "instagram":
      result = await tryProviders("instagram", [
        { name: "scrape-creators", fn: () => tryScrapeCreators(url) },
        { name: "igram",           fn: () => tryIgram(url) },
        { name: "direct-page",     fn: () => tryInstagramDirect(url) },
        { name: "cobalt",          fn: () => tryCobalt(url) },
        { name: "snapinsta",       fn: () => trySnapInsta(url) },
        { name: "embed-scrape",    fn: () => tryInstagramEmbed(url) },
      ]);
      break;

    case "facebook":
      result = await tryProviders("facebook", [
        { name: "cobalt",          fn: () => tryCobalt(url) },
      ]);
      break;

    case "tiktok":
      result = await tryProviders("tiktok", [
        { name: "tikwm-free",      fn: () => tryTikwmFree(url) },
        { name: "cobalt",          fn: () => tryCobalt(url) },
      ]);
      break;

    case "youtube":
      result = await tryProviders("youtube", [
        { name: "cobalt",          fn: () => tryCobalt(url) },
      ]);
      break;

    case "pinterest":
      result = await tryProviders("pinterest", [
        { name: "cobalt",          fn: () => tryCobalt(url) },
      ]);
      break;

    default:
      return NextResponse.json(
        { success: false, error: `Platform "${platform}" is not supported yet.` },
        { status: 400 }
      );
  }

  if (!result || !result.downloads.length) {
    return NextResponse.json({
      success: false,
      error: NO_MEDIA_ERROR_MESSAGE,
    });
  }

  const selectedDownloads = selectDownloadsByQuality(result.downloads, requestedQuality);
  const urls = selectedDownloads.map((item) => ({
    url: item.url,
    quality: item.quality,
    type:
      item.format === "mp3"
        ? "audio"
        : item.format === "jpg" || item.format === "png"
        ? "image"
        : "video",
    extension: item.format,
    size: item.size ?? null,
  }));

  const response = {
    success: true,
    metadata: {
      platform,
      title: result.title,
      description: result.description ?? null,
      thumbnail: result.thumbnail,
      author: result.author ?? null,
      duration: result.duration ?? null,
    },
    platform,
    type,
    title: result.title,
    thumbnail: result.thumbnail,
    download: selectedDownloads,
    urls,
    videoUrl:
      selectedDownloads.find((d) => d.format !== "jpg" && d.format !== "png")?.url ?? null,
    imageUrl:
      result.thumbnail ??
      selectedDownloads.find((d) => d.format === "jpg" || d.format === "png")?.url ??
      null,
    type_legacy: selectedDownloads[0].format === "mp4" ? "video" : "image",
  };

  toCache(cacheKey, response);
  return NextResponse.json(response);
}