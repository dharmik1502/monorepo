import { Injectable, Logger, BadRequestException, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { DownloadRequestDto, MediaInfoDto } from './dto/download.dto';
import { detectPlatform, isSupportedPlatform } from './parsers/url-validator';
import { InstagramParser } from './parsers/instagram.parser';
import { FacebookParser } from './parsers/facebook.parser';
import { TwitterParser } from './parsers/twitter.parser';

import { PinterestParser } from './parsers/pinterest.parser';

@Injectable()
export class DownloadService {
  private readonly logger = new Logger(DownloadService.name);

  constructor(
    @Inject(CACHE_MANAGER) private cache: Cache,
    private instagram: InstagramParser,
    private facebook: FacebookParser,
    private twitter: TwitterParser,

    private pinterest: PinterestParser,
  ) {}

  async extract(dto: DownloadRequestDto): Promise<MediaInfoDto> {
    const { url } = dto;

    if (!isSupportedPlatform(url)) {
      throw new BadRequestException(
        'Unsupported platform. Supported: Instagram, Facebook, Twitter/X, TikTok, Pinterest.',
      );
    }

    const platform = detectPlatform(url);
    const cacheKey = `media:${Buffer.from(url).toString('base64')}`;

    const cached = await this.cache.get<MediaInfoDto>(cacheKey);
    if (cached) {
      this.logger.log(`Cache hit for ${platform}: ${url}`);
      return cached;
    }

    this.logger.log(`Extracting from ${platform}: ${url}`);

    const result = await this.parseByPlatform(platform, url);

    if (result.success) {
      await this.cache.set(cacheKey, result);
    }

    return result;
  }

  private async parseByPlatform(platform: string, url: string): Promise<MediaInfoDto> {
    switch (platform) {
      case 'instagram':
        return this.instagram.parse(url);
      case 'facebook':
        return this.facebook.parse(url);
      case 'twitter':
        return this.twitter.parse(url);
      case 'pinterest':
        return this.pinterest.parse(url);
      default:
        return { success: false, metadata: { platform, title: 'Unsupported platform' }, urls: [] };
    }
  }
}
