import { Injectable, Logger } from '@nestjs/common';
import { BaseParser } from './base.parser';
import { MediaInfoDto } from '../dto/download.dto';
import * as cheerio from 'cheerio';

@Injectable()
export class FacebookParser extends BaseParser {
  private readonly logger = new Logger(FacebookParser.name);

  async parse(url: string): Promise<MediaInfoDto> {
    try {
      const mobileUrl = this.toMobileUrl(url);
      const response = await this.http.get(mobileUrl, {
        headers: {
          ...this.http.defaults.headers.common,
          'User-Agent':
            'Mozilla/5.0 (Linux; Android 12; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36',
        },
        maxRedirects: 5,
      });

      return this.extractFromHtml(response.data, url);
    } catch (error) {
      this.logger.error(`Facebook parse error: ${error.message}`);
      return this.buildError('Facebook video could not be extracted.');
    }
  }

  private toMobileUrl(url: string): string {
    return url
      .replace('www.facebook.com', 'm.facebook.com')
      .replace('fb.watch', 'm.facebook.com');
  }

  private extractFromHtml(html: string, originalUrl: string): MediaInfoDto {
    const $ = cheerio.load(html);

    const ogTitle = $('meta[property="og:title"]').attr('content') ?? 'Facebook Video';
    const ogDescription = $('meta[property="og:description"]').attr('content') ?? '';
    const ogImage = $('meta[property="og:image"]').attr('content') ?? '';
    const ogVideo = $('meta[property="og:video"]').attr('content') ?? '';
    const ogVideoSecure = $('meta[property="og:video:secure_url"]').attr('content') ?? '';

    const urls: MediaInfoDto['urls'] = [];

    // Try to find HD video in page source
    const hdMatch = html.match(/"hd_src":"([^"]+)"/);
    const sdMatch = html.match(/"sd_src":"([^"]+)"/);

    if (hdMatch) {
      urls.push({
        url: hdMatch[1].replace(/\\/g, ''),
        type: 'video',
        quality: 'hd',
        extension: 'mp4',
      });
    }

    if (sdMatch) {
      urls.push({
        url: sdMatch[1].replace(/\\/g, ''),
        type: 'video',
        quality: 'sd',
        extension: 'mp4',
      });
    }

    const videoUrl = ogVideoSecure || ogVideo;
    if (!hdMatch && !sdMatch && videoUrl) {
      urls.push({ url: videoUrl, type: 'video', quality: 'sd', extension: 'mp4' });
    }

    if (urls.length === 0) {
      return this.buildError('Facebook video not found. Video may be private.', 'facebook');
    }

    return {
      success: true,
      metadata: {
        platform: 'facebook',
        title: ogTitle,
        description: ogDescription,
        thumbnail: ogImage,
      },
      urls,
    };
  }
}
