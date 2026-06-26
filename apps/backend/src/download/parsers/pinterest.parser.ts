import { Injectable, Logger } from '@nestjs/common';
import { BaseParser } from './base.parser';
import { MediaInfoDto } from '../dto/download.dto';
import * as cheerio from 'cheerio';

@Injectable()
export class PinterestParser extends BaseParser {
  private readonly logger = new Logger(PinterestParser.name);

  async parse(url: string): Promise<MediaInfoDto> {
    try {
      const resolvedUrl = await this.resolveShortUrl(url);
      const response = await this.http.get(resolvedUrl);
      return this.extractFromHtml(response.data, resolvedUrl);
    } catch (error) {
      this.logger.error(`Pinterest parse error: ${error.message}`);
      return this.buildError('Pinterest media could not be extracted.');
    }
  }

  private async resolveShortUrl(url: string): Promise<string> {
    if (url.includes('pin.it')) {
      try {
        const response = await this.http.get(url, { maxRedirects: 5 });
        return response.request?.res?.responseUrl ?? url;
      } catch {
        return url;
      }
    }
    return url;
  }

  private extractFromHtml(html: string, url: string): MediaInfoDto {
    const $ = cheerio.load(html);

    const ogTitle = $('meta[property="og:title"]').attr('content') ?? 'Pinterest Pin';
    const ogDescription = $('meta[property="og:description"]').attr('content') ?? '';
    const ogImage = $('meta[property="og:image"]').attr('content') ?? '';
    const ogVideo = $('meta[property="og:video"]').attr('content') ?? '';
    const ogVideoSecure = $('meta[property="og:video:secure_url"]').attr('content') ?? '';

    const urls: MediaInfoDto['urls'] = [];

    const videoUrl = ogVideoSecure || ogVideo;
    if (videoUrl) {
      urls.push({ url: videoUrl, type: 'video', quality: 'hd', extension: 'mp4' });
    }

    // Pinterest images come in multiple resolutions — try to get highest quality
    if (ogImage) {
      // Convert to original size URL pattern
      const hdImage = ogImage
        .replace('/236x/', '/originals/')
        .replace('/474x/', '/originals/')
        .replace('/736x/', '/originals/');

      urls.push({ url: hdImage, type: 'image', quality: 'original', extension: 'jpg' });

      if (hdImage !== ogImage) {
        urls.push({ url: ogImage, type: 'image', quality: 'sd', extension: 'jpg' });
      }
    }

    if (urls.length === 0) {
      return this.buildError('Pinterest media not found.', 'pinterest');
    }

    return {
      success: true,
      metadata: {
        platform: 'pinterest',
        title: ogTitle,
        description: ogDescription,
        thumbnail: ogImage,
      },
      urls,
    };
  }
}
