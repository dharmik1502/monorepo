import {
  Controller,
  Post,
  Body,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { DownloadService } from './download.service';
import { DownloadRequestDto } from './dto/download.dto';
import { HistoryService } from '../history/history.service';
import { AnalyticsService } from '../analytics/analytics.service';

@Controller('download')
export class DownloadController {
  constructor(
    private readonly downloadService: DownloadService,
    private readonly historyService: HistoryService,
    private readonly analyticsService: AnalyticsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async download(@Body() dto: DownloadRequestDto, @Request() req: any) {
    const result = await this.downloadService.extract(dto);

    const userId = req.user?.id ?? null;

    // Fire-and-forget: don't await to keep response fast
    if (result.success) {
      this.historyService.save(userId, dto.url, result).catch(() => {});
      this.analyticsService.track(result.metadata.platform, userId).catch(() => {});
    }

    return result;
  }
}
