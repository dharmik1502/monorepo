import { Controller, Get, Query } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('platforms')
  getPlatformStats() {
    return this.analyticsService.getPlatformStats();
  }

  @Get('daily')
  getDailyStats(@Query('days') days = '7') {
    return this.analyticsService.getDailyStats(parseInt(days));
  }
}
