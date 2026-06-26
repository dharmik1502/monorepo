import { Injectable, Logger } from '@nestjs/common';
import { BaseParser } from './base.parser';
import { MediaInfoDto } from '../dto/download.dto';

@Injectable()
export class TwitterParser extends BaseParser {
  private readonly logger = new Logger(TwitterParser.name);

  // Uses nitter (open-source Twitter front-end) as a fallback
  private readonly NITTER_INSTANCES = [
    'https://nitter.net',
    'https://nitter.privacydev.net',
    'https://nitter.poast.org',
  ];

  async parse(url: string): Promise<MediaInfoDto> {
    try {
      const tweetId = this.extractTweetId(url);
      if (!tweetId) {
        return this.buildError('Invalid Twitter/X URL.');
      }

      // Try Twitter's public oEmbed (no auth needed, returns basic info)
      const oEmbedData = await this.fetchOEmbed(url);
      if (oEmbedData) {
        return oEmbedData;
      }

      return this.buildError('Twitter media extraction requires API access or a valid tweet URL.');
    } catch (error) {
      this.logger.error(`Twitter parse error: ${error.message}`);
      return this.buildError('Twitter video could not be extracted.');
    }
  }

  private extractTweetId(url: string): string | null {
    const match = url.match(/status\/(\d+)/);
    return match ? match[1] : null;
  }

  private async fetchOEmbed(url: string): Promise<MediaInfoDto | null> {
    try {
      const oEmbedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}`;
      const response = await this.http.get(oEmbedUrl);
      const data = response.data;

      if (!data?.html) return null;

      // Extract thumbnail from oEmbed html
      const thumbMatch = data.html.match(/src="([^"]+\.jpg[^"]*)"/);

      return {
        success: true,
        metadata: {
          platform: 'twitter',
          title: data.author_name ? `${data.author_name}'s tweet` : 'Twitter Post',
          author: data.author_name,
          thumbnail: thumbMatch ? thumbMatch[1] : undefined,
          description: 'Use Twitter API for direct video download.',
        },
        urls: [],
      };
    } catch {
      return null;
    }
  }
}
