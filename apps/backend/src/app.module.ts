import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { CacheModule } from '@nestjs/cache-manager';
import { DownloadModule } from './download/download.module';
import { AuthModule } from './auth/auth.module';
import { HistoryModule } from './history/history.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { SupabaseModule } from './supabase/supabase.module';
import { HealthController } from './health/health.controller';

@Module({
  controllers: [HealthController],
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    ThrottlerModule.forRoot([
      {
        ttl: parseInt(process.env.THROTTLE_TTL ?? '60'),
        limit: parseInt(process.env.THROTTLE_LIMIT ?? '30'),
      },
    ]),

    CacheModule.register({
      isGlobal: true,
      ttl: parseInt(process.env.CACHE_TTL ?? '300') * 1000,
      max: 500,
    }),

    SupabaseModule,
    AuthModule,
    DownloadModule,
    HistoryModule,
    AnalyticsModule,
  ],
})
export class AppModule {}
