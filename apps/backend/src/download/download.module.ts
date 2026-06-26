import { Module } from '@nestjs/common';
import { DownloadController } from './download.controller';
import { DownloadService } from './download.service';
import { InstagramParser } from './parsers/instagram.parser';
import { FacebookParser } from './parsers/facebook.parser';
import { TwitterParser } from './parsers/twitter.parser';
import { PinterestParser } from './parsers/pinterest.parser';
import { HistoryModule } from '../history/history.module';
import { AnalyticsModule } from '../analytics/analytics.module';

@Module({
  imports: [HistoryModule, AnalyticsModule],
  controllers: [DownloadController],
  providers: [
    DownloadService,
    InstagramParser,
    FacebookParser,
    TwitterParser,
    PinterestParser,
  ],
})
export class DownloadModule {}
