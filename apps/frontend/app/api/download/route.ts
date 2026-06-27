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

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY ?? "";
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
      if (/\/(reel|reels)\//.test(path)) return { platform: "instagram", type: "reel" };
      if (/\/p\//.test(path)) return { platform: "instagram", type: "post" };
      if (/\/stories\//.test(path)) return { platform: "instagram", type: "story" };
      if (/\/tv\//.test(path)) return { platform: "instagram", type: "igtv" };
      if (/^\/[^/]+\/?$/.test(path)) return { platform: "instagram", type: "profile" };
      return { platform: "instagram", type: "post" };
    }
    if (["facebook.com", "fb.com", "fb.watch", "m.facebook.com"].includes(host)) {
      if (/\/watch/.test(path) || /\/videos\//.test(path) || host === "fb.watch")
        return { platform: "facebook", type: "video" };
      if (/\/reel\//.test(path)) return { platform: "facebook", type: "reel" };
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

// ─── Provider: social-media-video-downloader (RapidAPI) ──────────────────────

async function trySocialDownloader(url: string): Promise<MediaResult | null> {
  if (!RAPIDAPI_KEY) return null;
  try {
    const res = await apiFetch(
      `https://social-media-video-downloader.p.rapidapi.com/smvd/get/all?url=${encodeURIComponent(url)}`,
      {
        headers: {
          "x-rapidapi-key": RAPIDAPI_KEY,
          "x-rapidapi-host": "social-media-video-downloader.p.rapidapi.com",
        },
      }
    );
    if (!res.ok) return null;
    const d = await res.json() as { success?: boolean; links?: { quality: string; link: string }[]; title?: string; picture?: string };
    if (!d?.success || !d.links?.length) return null;
    return {
      title: d.title || "Social Media Content",
      thumbnail: d.picture || null,
      downloads: d.links.map((l) => ({
        quality: l.quality || "HD",
        url: l.link,
        format: l.link.includes(".mp3") ? "mp3" : "mp4",
      })),
    };
  } catch {
    return null;
  }
}

// ─── Instagram providers ──────────────────────────────────────────────────────

async function tryInstagramRapid(url: string): Promise<MediaResult | null> {
  if (!RAPIDAPI_KEY) return null;
  try {
    const res = await apiFetch(
      `https://instagram-downloader-download-instagram-videos-stories4.p.rapidapi.com/index?url=${encodeURIComponent(url)}`,
      {
        headers: {
          "x-rapidapi-key": RAPIDAPI_KEY,
          "x-rapidapi-host":
            "instagram-downloader-download-instagram-videos-stories4.p.rapidapi.com",
        },
      }
    );
    if (!res.ok) return null;
    const d = await res.json() as {
      url?: string | string[];
      title?: string;
      thumbnail?: string;
      media?: { url?: string }[];
    };
    if (d?.url) {
      const urls: string[] = Array.isArray(d.url) ? d.url : [d.url];
      return {
        title: d.title || "Instagram Content",
        thumbnail: d.thumbnail || null,
        downloads: urls.map((u, i) => ({
          quality: i === 0 ? "HD" : "SD",
          url: u,
          format: u.includes(".mp3") ? "mp3" : "mp4",
        })),
      };
    }
    if (Array.isArray(d?.media) && d.media.length) {
      return {
        title: d.title || "Instagram Content",
        thumbnail: d.thumbnail || null,
        downloads: d.media.map((m, i) => ({
          quality: i === 0 ? "HD" : "SD",
          url: m.url || "",
          format: "mp4",
        })),
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ─── instagram120 helpers ─────────────────────────────────────────────────────

type Ig120Item = Record<string, unknown>;

function getNestedValue(obj: unknown, path: string[]): unknown {
  let current: unknown = obj;
  for (const key of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function getStringValue(obj: unknown, path: string[]): string | undefined {
  const value = getNestedValue(obj, path);
  return typeof value === "string" ? value : undefined;
}

function extractInstagram120Items(data: unknown): Ig120Item[] {
  if (typeof data !== "object" || data === null) return [];
  const source = data as Record<string, unknown>;
  const nestedData = source["data"];
  const candidates = [
    nestedData && typeof nestedData === "object"
      ? (nestedData as Record<string, unknown>)["reels"]
      : undefined,
    source["reels"],
    nestedData && typeof nestedData === "object"
      ? (nestedData as Record<string, unknown>)["posts"]
      : undefined,
    source["posts"],
    source["items"],
    source["result"],
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate as Ig120Item[];
  }
  return [];
}

function getInstagram120Username(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if (!host.endsWith("instagram.com") && host !== "instagr.am") return null;

    const path = parsed.pathname.replace(/^\/+|\/+$/g, "");
    const parts = path.split("/");
    if (!parts[0]) return null;

    const first = parts[0].toLowerCase();
    if (first === "stories" && parts[1]) return parts[1];
    if (["p", "reel", "reels", "tv", "explore", "tags", "accounts"].includes(first)) return null;
    return first;
  } catch {
    return null;
  }
}

function buildInstagram120Downloads(items: Ig120Item[]): DownloadItem[] {
  const downloads: DownloadItem[] = [];
  const seen = new Set<string>();

  for (const it of items.slice(0, 8)) {
    const candidates = [
      getStringValue(it, ["video", "url"]),
      getStringValue(it, ["video_url"]),
      getStringValue(it, ["playable_url"]),
      getStringValue(it, ["display_url"]),
      getStringValue(it, ["thumbnail_url"]),
      getStringValue(it, ["image"]),
      getStringValue(it, ["media_url"]),
      getStringValue(it, ["url"]),
    ];

    for (const c of candidates) {
      if (!c) continue;
      if (seen.has(c)) continue;
      seen.add(c);
      const lower = c.toLowerCase();
      const format = lower.includes(".mp3")
        ? "mp3"
        : lower.includes(".jpg") || lower.includes(".jpeg") || lower.includes(".png")
        ? "jpg"
        : "mp4";
      downloads.push({ quality: downloads.length === 0 ? "HD" : "SD", url: c, format });
      break;
    }
  }

  return downloads;
}

async function tryInstagram120Reels(username: string): Promise<MediaResult | null> {
  if (!RAPIDAPI_KEY) return null;
  try {
    const body = JSON.stringify({ username, maxId: "" });
    const res = await apiFetch("https://instagram120.p.rapidapi.com/api/instagram/reels", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-rapidapi-key": RAPIDAPI_KEY,
        "x-rapidapi-host": "instagram120.p.rapidapi.com",
      },
      body,
    });
    if (!res.ok) {
      console.warn(`[ig120-reels] HTTP ${res.status}`);
      return null;
    }
    const d: unknown = await res.json();
    const items = extractInstagram120Items(d);
    if (!items.length) return null;

    const downloads = buildInstagram120Downloads(items);
    if (!downloads.length) return null;

    const first = items[0];
    const thumb =
      (typeof first["display_url"] === "string" ? first["display_url"] : null) ??
      (typeof first["thumbnail_url"] === "string" ? first["thumbnail_url"] : null);

    return {
      title: `${username} — Instagram reels`,
      thumbnail: thumb,
      downloads,
      description: null,
      author: username,
    };
  } catch (err) {
    console.error("[ig120-reels] error:", err instanceof Error ? err.message : err);
    return null;
  }
}

async function tryInstagram120(url: string, type?: string): Promise<MediaResult | null> {
  if (!RAPIDAPI_KEY) return null;
  try {
    let username: string | null = null;
    try {
      username = getInstagram120Username(url);
      if (!username) {
        const parsed = new URL(url);
        const seg = parsed.pathname.replace(/^\//, "").split("/")[0];
        if (seg && seg !== "p" && seg !== "reel" && seg !== "reels" && seg !== "tv")
          username = seg;
      }
    } catch {
      username = typeof url === "string" ? url.split(/[\s/]/)[0] : null;
    }

    if (!username) return null;

    if (type === "profile" || type === "reel") {
      const reelsResult = await tryInstagram120Reels(username);
      if (reelsResult) return reelsResult;
    }

    const body = JSON.stringify({ username, maxId: "" });
    const res = await apiFetch("https://instagram120.p.rapidapi.com/api/instagram/posts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-rapidapi-key": RAPIDAPI_KEY,
        "x-rapidapi-host": "instagram120.p.rapidapi.com",
      },
      body,
    });
    if (!res.ok) {
      console.warn(`[ig120] HTTP ${res.status}`);
      return null;
    }

    const d: unknown = await res.json();
    const items = extractInstagram120Items(d);
    if (!items.length) return null;

    const downloads = buildInstagram120Downloads(items);
    if (!downloads.length) return null;

    const first = items[0];
    const thumb =
      (typeof first["display_url"] === "string" ? first["display_url"] : null) ??
      (typeof first["thumbnail_url"] === "string" ? first["thumbnail_url"] : null);

    return {
      title: `${username} — Instagram posts`,
      thumbnail: thumb,
      downloads,
      description: null,
      author: username,
    };
  } catch (err) {
    console.error("[ig120] error:", err instanceof Error ? err.message : err);
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

async function tryFacebookRapid(url: string): Promise<MediaResult | null> {
  if (!RAPIDAPI_KEY) return null;
  try {
    const res = await apiFetch(
      `https://facebook-video-downloader4.p.rapidapi.com/app/index.php?url=${encodeURIComponent(url)}`,
      {
        headers: {
          "x-rapidapi-key": RAPIDAPI_KEY,
          "x-rapidapi-host": "facebook-video-downloader4.p.rapidapi.com",
        },
      }
    );
    if (!res.ok) return null;
    const d = await res.json() as {
      links?: { Download_HD?: string; Download_SD?: string };
      title?: string;
      thumbnail?: string;
    };
    if (!d?.links) return null;
    const downloads: DownloadItem[] = [];
    if (d.links.Download_HD) downloads.push({ quality: "HD", url: d.links.Download_HD, format: "mp4" });
    if (d.links.Download_SD) downloads.push({ quality: "SD", url: d.links.Download_SD, format: "mp4" });
    if (!downloads.length) return null;
    return { title: d.title || "Facebook Video", thumbnail: d.thumbnail || null, downloads };
  } catch {
    return null;
  }
}

// ─── TikTok ───────────────────────────────────────────────────────────────────

async function tryTikTokRapid(url: string): Promise<MediaResult | null> {
  if (!RAPIDAPI_KEY) return null;
  try {
    const res = await apiFetch(
      `https://tiktok-video-no-watermark2.p.rapidapi.com/index?url=${encodeURIComponent(url)}&hd=1`,
      {
        headers: {
          "x-rapidapi-key": RAPIDAPI_KEY,
          "x-rapidapi-host": "tiktok-video-no-watermark2.p.rapidapi.com",
        },
      }
    );
    if (!res.ok) return null;
    const d = await res.json() as {
      data?: { play?: string; wmplay?: string; music?: string; title?: string; cover?: string };
    };
    const data = d?.data;
    if (!data?.play) return null;
    const downloads: DownloadItem[] = [
      { quality: "HD (No Watermark)", url: data.play, format: "mp4" },
    ];
    if (data.wmplay && data.wmplay !== data.play)
      downloads.push({ quality: "SD (Watermark)", url: data.wmplay, format: "mp4" });
    if (data.music)
      downloads.push({ quality: "Audio", url: data.music, format: "mp3" });
    return {
      title: data.title || "TikTok Video",
      thumbnail: data.cover || null,
      downloads,
    };
  } catch {
    return null;
  }
}

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

async function tryYouTubeRapid(url: string): Promise<MediaResult | null> {
  if (!RAPIDAPI_KEY) return null;
  try {
    const res = await apiFetch(
      `https://youtube-media-downloader.p.rapidapi.com/v2/video/details?url=${encodeURIComponent(url)}`,
      {
        headers: {
          "x-rapidapi-key": RAPIDAPI_KEY,
          "x-rapidapi-host": "youtube-media-downloader.p.rapidapi.com",
        },
      }
    );
    if (!res.ok) return null;
    const d = await res.json() as {
      videos?: { items?: { url: string; quality?: string; height?: number }[] };
      audios?: { items?: { url: string }[] };
      thumbnails?: { items?: { quality: string; url: string }[] };
      title?: string;
    };
    if (!d?.videos?.items?.length) return null;

    const downloads: DownloadItem[] = [];
    const videos = [...(d.videos.items)]
      .filter((v) => v.url)
      .sort((a, b) => (b.height || 0) - (a.height || 0))
      .slice(0, 3);

    videos.forEach((v) =>
      downloads.push({ quality: v.quality || `${v.height || ""}p`, url: v.url, format: "mp4" })
    );

    const audios = d.audios?.items ?? [];
    if (audios[0]?.url) downloads.push({ quality: "Audio Only", url: audios[0].url, format: "mp3" });

    const videoId = extractVideoId(url);
    const thumb =
      d.thumbnails?.items?.find((t) => t.quality === "maxresdefault")?.url ||
      (videoId ? `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg` : null);

    return { title: d.title || "YouTube Video", thumbnail: thumb ?? null, downloads };
  } catch {
    return null;
  }
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
        { name: "igram",           fn: () => tryIgram(url) },
        { name: "direct-page",     fn: () => tryInstagramDirect(url) },
        { name: "cobalt",          fn: () => tryCobalt(url) },
        { name: "rapidapi-social", fn: () => trySocialDownloader(url) },
        { name: "rapidapi-ig120",  fn: () => tryInstagram120(url, type) },
        { name: "rapidapi-ig",     fn: () => tryInstagramRapid(url) },
        { name: "snapinsta",       fn: () => trySnapInsta(url) },
        { name: "embed-scrape",    fn: () => tryInstagramEmbed(url) },
      ]);
      break;

    case "facebook":
      result = await tryProviders("facebook", [
        { name: "cobalt",          fn: () => tryCobalt(url) },
        { name: "rapidapi-fb",     fn: () => tryFacebookRapid(url) },
        { name: "rapidapi-social", fn: () => trySocialDownloader(url) },
      ]);
      break;

    case "tiktok":
      result = await tryProviders("tiktok", [
        { name: "tikwm-free",      fn: () => tryTikwmFree(url) },
        { name: "cobalt",          fn: () => tryCobalt(url) },
        { name: "rapidapi-tiktok", fn: () => tryTikTokRapid(url) },
        { name: "rapidapi-social", fn: () => trySocialDownloader(url) },
      ]);
      break;

    case "youtube":
      result = await tryProviders("youtube", [
        { name: "cobalt",          fn: () => tryCobalt(url) },
        { name: "rapidapi-yt",     fn: () => tryYouTubeRapid(url) },
        { name: "rapidapi-social", fn: () => trySocialDownloader(url) },
      ]);
      break;

    case "pinterest":
      result = await tryProviders("pinterest", [
        { name: "rapidapi-social", fn: () => trySocialDownloader(url) },
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
    const hint = !RAPIDAPI_KEY
      ? " For reliable downloads, add a free RAPIDAPI_KEY to your .env.local (see .env.local.example)."
      : "";
    return NextResponse.json({
      success: false,
      error: `${NO_MEDIA_ERROR_MESSAGE}${hint}`,
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