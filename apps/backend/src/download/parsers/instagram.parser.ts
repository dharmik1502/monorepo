import { Injectable, Logger } from '@nestjs/common';
import { BaseParser } from './base.parser';
import { MediaInfoDto } from '../dto/download.dto';
import * as cheerio from 'cheerio';

@Injectable()
export class InstagramParser extends BaseParser {
  private readonly logger = new Logger(InstagramParser.name);
  private readonly instagramMobileUA = 'Instagram 155.0.0.37.107';

  // ScrapeCreators API key — override via SCRAPE_CREATORS_API_KEY env var if needed
  private readonly scrapeCreatorsApiKey =
    process.env.SCRAPE_CREATORS_API_KEY ?? 'DjNUud0o2nN8M3fzFXteSekUXEU2';

  async parse(url: string): Promise<MediaInfoDto> {
    try {
      const cleanUrl = this.normalizeUrl(url);

      // ── 1. ScrapeCreators v1 with download_media=true (primary) ───────────
      const scResult = await this.tryScrapeCreators(cleanUrl);
      if (scResult) return scResult;

      // ── 2. Direct HTML scrape ─────────────────────────────────────────────
      const response = await this.http.get(cleanUrl, {
        headers: {
          ...this.http.defaults.headers.common,
          'User-Agent':
            'Mozilla/5.0 (Linux; Android 9; GM1903) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.5060.129 Mobile Safari/537.36',
          Referer: 'https://www.instagram.com/',
          'X-IG-App-ID': '936619743392459',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
      });

      const html = response.data as string;
      const htmlResult = this.extractFromHtml(html, cleanUrl);
      if (htmlResult.success) return htmlResult;

      // ── 3. Mobile oEmbed + session-based media info ───────────────────────
      const mobileOEmbed = await this.fetchInstagramMobileOEmbed(cleanUrl);
      if (mobileOEmbed?.media_id) {
        const mediaId = mobileOEmbed.media_id as string;
        const sessionId = process.env.INSTAGRAM_SESSIONID;
        if (sessionId) {
          const mobileMediaInfo = await this.fetchInstagramMobileMediaInfo(mediaId, sessionId);
          const urls = this.extractUrlsFromInstagramMediaInfo(mobileMediaInfo);
          if (urls.length) {
            return {
              success: true,
              metadata: {
                platform: 'instagram',
                title: mobileOEmbed.title || '',
                description: mobileOEmbed.title || '',
                thumbnail: mobileOEmbed.thumbnail_url || '',
              },
              urls,
            };
          }
        }
      }

      return htmlResult;
    } catch (error) {
      this.logAxiosError(error, 'Instagram parse');
      return this.buildError(
        'Instagram media could not be extracted. The post may be private or unavailable.',
      );
    }
  }

  // ── ScrapeCreators v1 with download_media=true ─────────────────────────────
  //
  // Response shape (confirmed):
  // {
  //   success: true,
  //   data: {
  //     xdt_shortcode_media: {
  //       video_url: "...",          ← direct CDN mp4
  //       display_url: "...",        ← thumbnail/image
  //       thumbnail_src: "...",
  //       edge_media_to_caption: { edges: [{ node: { text } }] }
  //       edge_sidecar_to_children: { edges: [...] }   ← carousel
  //     }
  //   },
  //   download_media_urls: [         ← cached Supabase URLs (needs download_media=true)
  //     { cdn_url: "...", type: "video", post_id, cached }
  //   ]
  // }

  private async tryScrapeCreators(url: string): Promise<MediaInfoDto | null> {
    try {
      const response = await this.http.get('https://api.scrapecreators.com/v1/instagram/post', {
        headers: {
          'x-api-key': this.scrapeCreatorsApiKey,
          Accept: 'application/json',
        },
        params: {
          url,
          trim: true,
          download_media: true,   // ← required to get download_media_urls
        },
      });

      const body = response.data as any;
      this.logger.debug(
        `ScrapeCreators response — success: ${body?.success}, ` +
        `has xdt_shortcode_media: ${!!body?.data?.xdt_shortcode_media}, ` +
        `download_media_urls count: ${body?.download_media_urls?.length ?? 0}`,
      );

      const urls: MediaInfoDto['urls'] = [];
      const media = body?.data?.xdt_shortcode_media;

      // ── A. Prefer cached Supabase URLs from download_media_urls ───────────
      if (Array.isArray(body?.download_media_urls) && body.download_media_urls.length > 0) {
        for (const item of body.download_media_urls) {
          if (typeof item?.cdn_url === 'string' && item.cdn_url.trim()) {
            const type: 'video' | 'image' = item.type === 'image' ? 'image' : 'video';
            const ext = type === 'video' ? 'mp4' : 'jpg';
            this.tryPushUrl(urls, item.cdn_url, type, 'hd', ext);
          }
        }
      }

      // ── B. Direct CDN video_url from xdt_shortcode_media ──────────────────
      if (media) {
        this.tryPushUrl(urls, media.video_url, 'video', 'hd', 'mp4');

        // Single image post (no video)
        if (!media.video_url) {
          this.tryPushUrl(urls, media.display_url, 'image', 'original', 'jpg');
          if (Array.isArray(media.display_resources)) {
            // Pick highest resolution display_resource
            const sorted = [...media.display_resources]
              .filter((r: any) => r?.src)
              .sort((a: any, b: any) => (b.config_width ?? 0) - (a.config_width ?? 0));
            for (const r of sorted) {
              this.tryPushUrl(urls, r.src, 'image', 'original', 'jpg');
            }
          }
        }

        // Carousel / sidecar
        const sidecarEdges = media?.edge_sidecar_to_children?.edges;
        if (Array.isArray(sidecarEdges)) {
          for (const item of sidecarEdges) {
            const node = item?.node;
            if (!node || typeof node !== 'object') continue;
            this.tryPushUrl(urls, node.video_url, 'video', 'hd', 'mp4');
            if (!node.video_url) {
              this.tryPushUrl(urls, node.display_url, 'image', 'original', 'jpg');
              this.tryPushUrl(urls, node.thumbnail_src, 'image', 'thumbnail', 'jpg');
              if (Array.isArray(node.display_resources)) {
                const sorted = [...node.display_resources]
                  .filter((r: any) => r?.src)
                  .sort((a: any, b: any) => (b.config_width ?? 0) - (a.config_width ?? 0));
                for (const r of sorted) {
                  this.tryPushUrl(urls, r.src, 'image', 'original', 'jpg');
                }
              }
            }
          }
        }

        // Thumbnail fallback (last resort)
        if (!urls.length) {
          this.tryPushUrl(urls, media.thumbnail_src, 'image', 'thumbnail', 'jpg');
        }
      }

      if (!urls.length) {
        this.logger.warn(
          `ScrapeCreators: no URLs extracted. Body snippet: ${JSON.stringify(body).slice(0, 600)}`,
        );
        return null;
      }

      const caption = media?.edge_media_to_caption?.edges?.[0]?.node?.text ?? '';
      const title = caption || media?.title || '';
      const thumbnail = media?.thumbnail_src || media?.display_url || '';

      return {
        success: true,
        metadata: {
          platform: 'instagram',
          title,
          description: caption,
          thumbnail,
        },
        urls,
      };
    } catch (error) {
      this.logAxiosError(error, 'ScrapeCreators');
      return null;
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private tryPushUrl(
    urls: MediaInfoDto['urls'],
    url: any,
    type: 'video' | 'image',
    quality: string,
    extension: string,
  ) {
    if (typeof url === 'string' && url.trim() && !urls.some((u) => u.url === url.trim())) {
      urls.push({ url: url.trim(), type, quality, extension });
    }
  }

  // ── Mobile oEmbed + Media Info ─────────────────────────────────────────────

  private async fetchInstagramMobileOEmbed(url: string): Promise<any | null> {
    try {
      const response = await this.http.get(
        `https://i.instagram.com/api/v1/oembed/?url=${encodeURIComponent(url)}`,
        {
          headers: {
            'User-Agent': this.instagramMobileUA,
            Accept: 'application/json',
          },
        },
      );
      return response.data;
    } catch (e) {
      this.logger.debug(
        `Instagram mobile oEmbed failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }

  private async fetchInstagramMobileMediaInfo(mediaId: string, sessionId: string): Promise<any | null> {
    try {
      const response = await this.http.get(
        `https://i.instagram.com/api/v1/media/${encodeURIComponent(mediaId)}/info/`,
        {
          headers: {
            'User-Agent': this.instagramMobileUA,
            Accept: 'application/json',
            'X-IG-App-ID': '936619743392459',
            'X-Requested-With': 'XMLHttpRequest',
            Cookie: `sessionid=${sessionId}`,
          },
        },
      );
      return response.data;
    } catch (e) {
      this.logger.debug(
        `Instagram mobile media info failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }

  private extractUrlsFromInstagramMediaInfo(data: any): MediaInfoDto['urls'] {
    const urls: MediaInfoDto['urls'] = [];
    const items = Array.isArray(data?.items) ? data.items : [];
    for (const item of items) {
      this.extractUrlsFromInstagramMediaItem(item, urls);
    }
    return urls;
  }

  private extractUrlsFromInstagramMediaItem(item: any, urls: MediaInfoDto['urls']): void {
    if (!item || typeof item !== 'object') return;

    if (item.media_type === 8 && Array.isArray(item.carousel_media)) {
      for (const child of item.carousel_media) {
        this.extractUrlsFromInstagramMediaItem(child, urls);
      }
      return;
    }

    if (Array.isArray(item.video_versions)) {
      const sorted = item.video_versions
        .filter((v: any) => typeof v?.url === 'string')
        .sort((a: any, b: any) => (b?.width || 0) - (a?.width || 0));
      for (const video of sorted) {
        urls.push({ url: video.url, type: 'video', quality: 'hd', extension: 'mp4' });
      }
    }

    if (Array.isArray(item.image_versions2?.candidates) && urls.length === 0) {
      const sorted = item.image_versions2.candidates
        .filter((c: any) => typeof c?.url === 'string')
        .sort((a: any, b: any) => (b?.width || 0) - (a?.width || 0));
      if (sorted.length) {
        urls.push({ url: sorted[0].url, type: 'image', quality: 'original', extension: 'jpg' });
      }
    }
  }

  // ── HTML extraction ────────────────────────────────────────────────────────

  private normalizeUrl(url: string): string {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`.replace(/\/$/, '');
  }

  private extractFromHtml(html: string, url: string): MediaInfoDto {
    const $ = cheerio.load(html);

    const ogTitle = $('meta[property="og:title"]').attr('content') ?? '';
    const ogDescription = $('meta[property="og:description"]').attr('content') ?? '';
    const ogImage = $('meta[property="og:image"]').attr('content') ?? '';
    const ogVideo = $('meta[property="og:video"]').attr('content') ?? '';
    const ogVideoSecure = $('meta[property="og:video:secure_url"]').attr('content') ?? '';

    const urls: MediaInfoDto['urls'] = [];
    const videoUrl = ogVideoSecure || ogVideo;

    if (videoUrl) {
      urls.push({ url: videoUrl, type: 'video', quality: 'hd', extension: 'mp4' });
    } else if (ogImage) {
      urls.push({ url: ogImage, type: 'image', quality: 'original', extension: 'jpg' });
    }

    if (urls.length === 0) {
      const jsonLd = $('script[type="application/ld+json"]').first().html();
      if (jsonLd) {
        try {
          const data = JSON.parse(jsonLd);
          if (data?.contentUrl) {
            urls.push({ url: data.contentUrl, type: 'video', quality: 'hd', extension: 'mp4' });
          }
        } catch {
          this.logger.debug('Instagram JSON-LD parse failed');
        }
      }
    }

    if (urls.length === 0) {
      const scripts = $('script')
        .map((_, el) => $(el).html())
        .get()
        .filter(Boolean);

      for (const s of scripts) {
        if (!s.includes('window._sharedData')) continue;
        try {
          const m = s.match(/window\._sharedData\s*=\s*(\{.*\});/s);
          if (m?.[1]) {
            const shared = JSON.parse(m[1]);
            const media =
              shared?.entry_data?.PostPage?.[0]?.graphql?.shortcode_media ||
              shared?.entry_data?.VideoPage?.[0]?.graphql?.shortcode_media;
            if (media) {
              if (media.video_url) {
                urls.push({ url: media.video_url, type: 'video', quality: 'hd', extension: 'mp4' });
              } else if (media.display_url) {
                urls.push({ url: media.display_url, type: 'image', quality: 'original', extension: 'jpg' });
              } else if (media.edge_sidecar_to_children?.edges) {
                for (const edge of media.edge_sidecar_to_children.edges) {
                  const node = edge.node;
                  if (node.video_url) {
                    urls.push({ url: node.video_url, type: 'video', quality: 'hd', extension: 'mp4' });
                  } else if (node.display_url) {
                    urls.push({ url: node.display_url, type: 'image', quality: 'original', extension: 'jpg' });
                  }
                }
              }
            }
          }
        } catch {
          this.logger.debug('Instagram sharedData parse failed');
        }
        break;
      }
    }

    if (urls.length === 0) {
      this.logger.error(`Instagram HTML extract failed for ${url} — snippet: ${html.slice(0, 2000)}`);
      return this.buildError('Could not extract media. Post may be private.', 'instagram');
    }

    return {
      success: true,
      metadata: {
        platform: 'instagram',
        title: ogTitle.replace(' • Instagram', '').trim(),
        description: ogDescription,
        thumbnail: ogImage,
      },
      urls,
    };
  }

  // ── Logging ────────────────────────────────────────────────────────────────

  private logAxiosError(err: any, context = 'error'): void {
    try {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`${context}: ${msg}`);
      try {
        this.logger.debug(`${context} full error: ${JSON.stringify(err, Object.getOwnPropertyNames(err))}`);
      } catch { /* ignore */ }
      if (err?.response) {
        try {
          const d = typeof err.response.data === 'string' ? err.response.data : JSON.stringify(err.response.data);
          this.logger.debug(`${context} response ${err.response.status}: ${d}`);
        } catch { /* ignore */ }
      }
    } catch { /* swallow */ }
  }
}