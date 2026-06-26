import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private supabase: SupabaseService) {}

  async track(platform: string, userId: string | null): Promise<void> {
    try {
      await this.supabase.getAdminClient().from('analytics_events').insert({
        platform,
        user_id: userId,
        created_at: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.warn(`Analytics track failed: ${error.message}`);
    }
  }

  async getPlatformStats() {
    const { data, error } = await this.supabase
      .getAdminClient()
      .from('analytics_events')
      .select('platform')
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

    if (error) throw error;

    const counts: Record<string, number> = {};
    for (const row of data ?? []) {
      counts[row.platform] = (counts[row.platform] ?? 0) + 1;
    }

    return {
      last30Days: counts,
      total: Object.values(counts).reduce((a, b) => a + b, 0),
    };
  }

  async getDailyStats(days = 7) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await this.supabase
      .getAdminClient()
      .from('analytics_events')
      .select('platform, created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: true });

    if (error) throw error;

    // Group by date
    const byDate: Record<string, Record<string, number>> = {};
    for (const row of data ?? []) {
      const date = row.created_at.split('T')[0];
      if (!byDate[date]) byDate[date] = {};
      byDate[date][row.platform] = (byDate[date][row.platform] ?? 0) + 1;
    }

    return byDate;
  }
}
