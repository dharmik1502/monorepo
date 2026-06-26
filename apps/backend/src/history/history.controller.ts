import {
  Controller,
  Get,
  Delete,
  Param,
  Query,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { HistoryService } from './history.service';

@Controller('history')
export class HistoryController {
  constructor(private readonly historyService: HistoryService) {}

  @Get()
  getHistory(
    @Request() req: any,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.historyService.getUserHistory(
      req.user?.id,
      parseInt(page),
      Math.min(parseInt(limit), 50),
    );
  }

  @Delete('all')
  @HttpCode(HttpStatus.NO_CONTENT)
  clearHistory(@Request() req: any) {
    return this.historyService.clearUserHistory(req.user?.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteHistoryItem(@Request() req: any, @Param('id') id: string) {
    return this.historyService.deleteUserHistory(req.user?.id, id);
  }
}
