import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { MediaInfoDto } from '../download/dto/download.dto';

@Injectable()
export class HistoryService {
  private readonly logger = new Logger(HistoryService.name);

  constructor(private supabase: SupabaseService) {}

  async save(userId: string | null, url: string, result: MediaInfoDto): Promise<void> {
    try {
      await this.supabase.getAdminClient().from('download_history').insert({
        user_id: userId,
        url,
        platform: result.metadata.platform,
        title: result.metadata.title ?? null,
        thumbnail: result.metadata.thumbnail ?? null,
        media_count: result.urls.length,
        created_at: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.warn(`History save failed: ${error.message}`);
    }
  }

  async getUserHistory(userId: string, page = 1, limit = 20) {
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data, error, count } = await this.supabase
      .getAdminClient()
      .from('download_history')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) throw error;

    return {
      data,
      pagination: {
        page,
        limit,
        total: count ?? 0,
        totalPages: Math.ceil((count ?? 0) / limit),
      },
    };
  }

  async deleteUserHistory(userId: string, historyId: string): Promise<void> {
    const { error } = await this.supabase
      .getAdminClient()
      .from('download_history')
      .delete()
      .eq('id', historyId)
      .eq('user_id', userId);

    if (error) throw error;
  }

  async clearUserHistory(userId: string): Promise<void> {
    const { error } = await this.supabase
      .getAdminClient()
      .from('download_history')
      .delete()
      .eq('user_id', userId);

    if (error) throw error;
  }
}
