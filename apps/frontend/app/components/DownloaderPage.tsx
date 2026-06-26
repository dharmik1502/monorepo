"use client";

import { useState } from "react";

const features = [
  {
    icon: "⚡",
    title: "Lightning Fast",
    desc: "Download any social media content in seconds with our optimized servers.",
  },
  {
    icon: "🎯",
    title: "HD Quality",
    desc: "Get original quality videos and photos without any compression or watermark.",
  },
  {
    icon: "🔒",
    title: "100% Safe",
    desc: "No login required. We never store your data or account credentials.",
  },
  {
    icon: "♾️",
    title: "Unlimited Downloads",
    desc: "Download as many videos, photos, and reels as you want — completely free.",
  },
  {
    icon: "📱",
    title: "All Devices",
    desc: "Works perfectly on mobile, tablet, and desktop browsers.",
  },
  {
    icon: "🎵",
    title: "Audio Extract",
    desc: "Extract and save audio from any reel or video as MP3.",
  },
];

const steps = [
  {
    num: "1",
    title: "Copy Link",
    desc: "Open the app and copy the link of the content you want to download.",
  },
  {
    num: "2",
    title: "Paste & Submit",
    desc: "Paste the link into the input field above and click the Download button.",
  },
  {
    num: "3",
    title: "Save File",
    desc: "Preview your content and click Save to download it directly to your device.",
  },
];

type DownloadItem = { quality: string; url: string; format: string };

type DownloadResult = {
  success: boolean;
  platform: string;
  type: string;
  title: string;
  thumbnail: string | null;
  download: DownloadItem[];
  urls?: Array<{ url: string; quality: string; type: string; extension: string; size: number | null }>;
  metadata?: {
    platform: string;
    title: string;
    description?: string | null;
    thumbnail: string | null;
    author?: string | null;
    duration?: number | null;
  };
  // Legacy fields — kept for compatibility
  videoUrl?: string | null;
  imageUrl?: string | null;
};

type Props = {
  platform?: string;
  toolName: string;
  subtitle: string;
  tagline: string;
};

function formatIcon(format: string) {
  if (format === "mp3") return "🎵";
  if (format === "jpg" || format === "png") return "🖼️";
  return "🎬";
}

// The API can return the download list under a few different shapes
// depending on the source platform/legacy path. Normalize everything
// into a single DownloadItem[] so the render code never has to guess.
function normalizeDownload(data: DownloadResult): DownloadItem[] {
  if (Array.isArray(data.download) && data.download.length > 0) {
    return data.download;
  }
  if (Array.isArray(data.urls) && data.urls.length > 0) {
    return data.urls.map((u) => ({
      quality: u.quality,
      url: u.url,
      format: u.extension,
    }));
  }
  if (data.videoUrl) {
    return [{ quality: "Original", url: data.videoUrl, format: "mp4" }];
  }
  if (data.imageUrl) {
    return [{ quality: "Original", url: data.imageUrl, format: "jpg" }];
  }
  return [];
}

export default function DownloaderPage({
  platform = "Social Media",
  toolName,
  subtitle,
  tagline,
}: Props) {
  const [url, setUrl] = useState("");
  const [pasteError, setPasteError] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DownloadResult | null>(null);
  const [fetchError, setFetchError] = useState("");
  const [downloadingIdx, setDownloadingIdx] = useState<number | null>(null);
  const [downloadError, setDownloadError] = useState("");

  async function handlePaste() {
    setPasteError("");
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) {
        setUrl(text.trim());
        setResult(null);
        setFetchError("");
      } else {
        setPasteError("Clipboard is empty — copy a link first.");
      }
    } catch {
      setPasteError("Clipboard blocked — paste manually with Ctrl+V.");
    }
  }

  async function handleDownload(e: React.SyntheticEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;

    setLoading(true);
    setFetchError("");
    setResult(null);
    setDownloadError("");

    try {
      const res = await fetch("/api/v1/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setFetchError(data.error || "Failed to fetch download link.");
      } else {
        const normalized = normalizeDownload(data as DownloadResult);
        if (normalized.length === 0) {
          setFetchError("No downloadable files were found for this link.");
        } else {
          setResult({ ...(data as DownloadResult), download: normalized });
        }
      }
    } catch {
      setFetchError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function triggerDownload(mediaUrl: string, ext: string, idx: number) {
    setDownloadingIdx(idx);
    setDownloadError("");
    try {
      const res = await fetch(`/api/proxy?url=${encodeURIComponent(mediaUrl)}`);
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setDownloadError(
          (json as { error?: string }).error ||
            `Download failed (${res.status}). Try the direct link below.`
        );
        return;
      }
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `download.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch {
      setDownloadError("Download failed. Use the direct link below to save manually.");
    } finally {
      setDownloadingIdx(null);
    }
  }

  // Pick the best preview URL from the result
  const downloadItems = result?.download ?? [];
  const previewVideoUrl = downloadItems.find(
    (d) => d.format === "mp4" || d.format === "webm"
  )?.url;
  const previewImageUrl = result?.thumbnail ?? result?.imageUrl ?? null;

  return (
    <div className="gradient-bg min-h-screen flex flex-col">
      <div className="hero-glow fixed inset-0 pointer-events-none" />

      <main className="relative z-10 flex flex-col items-center flex-1 px-4">
        <section className="flex flex-col items-center pt-12 pb-2 w-full max-w-2xl mx-auto text-center">
          <h1 className="text-4xl sm:text-5xl font-extrabold leading-tight mb-3 tracking-tight">
            <span className="text-purple-400">{platform} </span>
            <span
              style={{
                background: "linear-gradient(135deg, #f43f5e, #ec4899)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              {toolName}{" "}
            </span>
            <span className="text-white">Downloader</span>
          </h1>
          <p className="text-purple-300 text-sm sm:text-base">{subtitle}</p>
          <p className="text-purple-400 text-sm font-medium mb-8">{tagline}</p>

          {/* Input form */}
          <div className="w-full">
            <form onSubmit={handleDownload} className="flex flex-col gap-3">
              <div className="flex items-center glass-card rounded-full px-4 py-2 gap-2 shadow-lg">
                <svg
                  className="w-5 h-5 text-purple-400 flex-shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
                <input
                  type="text"
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    setPasteError("");
                    setFetchError("");
                    setResult(null);
                  }}
                  placeholder="Paste Instagram, Facebook, TikTok or YouTube link..."
                  className="flex-1 bg-transparent outline-none text-sm text-white placeholder-purple-400 min-w-0"
                />
                <button
                  type="button"
                  onClick={handlePaste}
                  className="btn-primary rounded-full px-5 py-2.5 text-sm font-semibold text-white flex items-center gap-2 flex-shrink-0"
                >
                  <svg
                    className="w-4 h-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <rect x="9" y="2" width="6" height="4" rx="1" />
                    <path d="M9 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2h-2" />
                  </svg>
                  Paste
                </button>
              </div>

              {pasteError && (
                <p className="text-pink-400 text-xs text-center">{pasteError}</p>
              )}

              <button
                type="submit"
                disabled={!url.trim() || loading}
                className="btn-primary rounded-full w-full py-3 text-sm font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
              >
                {loading ? (
                  <>
                    <svg
                      className="w-4 h-4 animate-spin"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                    Fetching...
                  </>
                ) : (
                  <>
                    <svg
                      className="w-4 h-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    Download
                  </>
                )}
              </button>
            </form>

            {fetchError && (
              <p className="text-pink-400 text-xs mt-3 text-center">{fetchError}</p>
            )}

            {/* Result card */}
            {result && (
              <div className="glass-card rounded-2xl p-5 mt-4 flex flex-col sm:flex-row gap-5 text-left">
                {/* Preview */}
                <div className="sm:w-44 flex-shrink-0 rounded-xl overflow-hidden bg-black">
                  {previewVideoUrl ? (
                    <video
                      src={`/api/proxy?url=${encodeURIComponent(previewVideoUrl)}`}
                      controls
                      className="w-full h-full object-cover max-h-56 sm:max-h-none"
                    />
                  ) : previewImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/proxy?url=${encodeURIComponent(previewImageUrl)}`}
                      alt="Content preview"
                      className="w-full object-cover"
                    />
                  ) : null}
                </div>

                {/* Download buttons */}
                <div className="flex flex-col gap-3 flex-1 justify-center">
                  <div className="mb-1">
                    <p className="text-white text-sm font-medium line-clamp-2">
                      {result.title}
                    </p>
                    <span className="text-xs text-purple-400 capitalize">
                      {result.platform} · {result.type}
                    </span>
                  </div>

                  {downloadItems.length > 0 ? (
                    downloadItems.map((item, idx) => (
                      <button
                        key={idx}
                        onClick={() => triggerDownload(item.url, item.format, idx)}
                        disabled={downloadingIdx !== null}
                        className={`rounded-xl w-full py-3 text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                          idx === 0
                            ? "btn-primary text-white"
                            : "text-purple-300 border border-purple-500/40 hover:border-purple-400"
                        }`}
                      >
                        {downloadingIdx === idx ? (
                          <>
                            <svg
                              className="w-4 h-4 animate-spin"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                            </svg>
                            Downloading…
                          </>
                        ) : (
                          <>
                            <span>{formatIcon(item.format)}</span>
                            <span>
                              Download {item.quality}{" "}
                              <span className="opacity-60 uppercase text-xs">
                                .{item.format}
                              </span>
                            </span>
                          </>
                        )}
                      </button>
                    ))
                  ) : (
                    <p className="text-sm text-pink-400 text-center py-2">
                      No downloadable files were found for this link.
                    </p>
                  )}

                  {downloadError && (
                    <div className="text-xs text-pink-400 text-center px-1">
                      <p className="mb-1">{downloadError}</p>
                      {downloadItems[0]?.url && (
                        <a
                          href={downloadItems[0].url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline text-purple-400 hover:text-purple-200"
                        >
                          Open direct link → right-click &amp; Save As
                        </a>
                      )}
                    </div>
                  )}

                  <button
                    onClick={() => {
                      setResult(null);
                      setUrl("");
                      setFetchError("");
                      setDownloadError("");
                    }}
                    className="rounded-xl w-full py-3 text-sm font-semibold text-purple-400 border border-purple-700/40 hover:border-purple-500 flex items-center justify-center gap-2 transition-colors"
                  >
                    <svg
                      className="w-4 h-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <polyline points="1 4 1 10 7 10" />
                      <path d="M3.51 15a9 9 0 1 0 .49-4.95" />
                    </svg>
                    Download Again
                  </button>
                </div>
              </div>
            )}
          </div>

          <a
            href="#"
            className="mt-4 text-xs text-purple-500 hover:text-purple-300 flex items-center gap-1 transition-colors"
          >
            <svg
              className="w-3.5 h-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            Report an issue
          </a>
        </section>

        <div className="divider-glow h-px w-full max-w-4xl my-4 rounded-full" />

        {/* Features */}
        <section id="features" className="py-16 w-full max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-2">
            Why choose <span className="gradient-text">InstaGrab?</span>
          </h2>
          <p className="text-purple-300 text-center mb-10">
            Everything you need, nothing you don&apos;t.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {features.map((f) => (
              <div
                key={f.title}
                className="glass-card rounded-2xl p-5 flex flex-col gap-3 hover:border-purple-500/30 transition-colors"
              >
                <div className="feature-icon-bg w-11 h-11 rounded-xl flex items-center justify-center text-xl">
                  {f.icon}
                </div>
                <h3 className="font-semibold text-white">{f.title}</h3>
                <p className="text-sm text-purple-300 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="divider-glow h-px w-full max-w-4xl my-4 rounded-full" />

        {/* How it works */}
        <section id="how-it-works" className="py-16 w-full max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-2">
            How it <span className="gradient-text">works</span>
          </h2>
          <p className="text-purple-300 text-center mb-10">
            Three simple steps to save any content.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {steps.map((s) => (
              <div
                key={s.num}
                className="flex flex-col items-center text-center gap-4"
              >
                <div className="step-number w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold text-white shadow-lg">
                  {s.num}
                </div>
                <h3 className="font-semibold text-white">{s.title}</h3>
                <p className="text-sm text-purple-300 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="divider-glow h-px w-full max-w-4xl my-4 rounded-full" />

        {/* FAQ */}
        <section id="faq" className="py-16 w-full max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-10">
            Frequently Asked <span className="gradient-text">Questions</span>
          </h2>
          <div className="flex flex-col gap-4">
            {[
              {
                q: "Is InstaGrab free to use?",
                a: "Yes, InstaGrab is completely free with no hidden fees or subscriptions.",
              },
              {
                q: "Do I need to log in?",
                a: "No. You only need the public URL of the content. No account credentials required.",
              },
              {
                q: "What platforms are supported?",
                a: "Instagram (Reels, Posts, Stories, IGTV, Profiles), Facebook (Videos, Reels), TikTok, and YouTube (Videos & Shorts).",
              },
              {
                q: "What formats can I download?",
                a: "Videos as MP4, photos as JPG/PNG, and audio as MP3.",
              },
              {
                q: "Can I download private account content?",
                a: "No. The downloader only works with content from public accounts.",
              },
            ].map((item) => (
              <div key={item.q} className="glass-card rounded-xl p-5">
                <h4 className="font-semibold text-white mb-2">{item.q}</h4>
                <p className="text-sm text-purple-300 leading-relaxed">{item.a}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}