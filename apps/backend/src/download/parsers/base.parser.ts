import axios, { AxiosInstance } from 'axios';
import { MediaInfoDto, MediaItemDto } from '../dto/download.dto';

export abstract class BaseParser {
  protected http: AxiosInstance;

  constructor() {
    this.http = axios.create({
      timeout: 15000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        Connection: 'keep-alive',
      },
    });
  }

  abstract parse(url: string): Promise<MediaInfoDto>;

  protected buildError(message: string, platform = 'unknown'): MediaInfoDto {
    return {
      success: false,
      metadata: { platform, title: message },
      urls: [],
    };
  }

  protected extractJsonFromScript(html: string, key: string): any {
    try {
      const regex = new RegExp(`"${key}":\\s*({[^}]+}|"[^"]*"|[\\d.]+)`, 'i');
      const match = html.match(regex);
      return match ? JSON.parse(match[1]) : null;
    } catch {
      return null;
    }
  }
}
