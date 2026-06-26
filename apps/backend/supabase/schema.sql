-- ============================================================
-- Social Downloader Backend - Supabase Schema
-- Run this in Supabase SQL Editor
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- Download History
-- ============================================================
CREATE TABLE IF NOT EXISTS download_history (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  url         TEXT NOT NULL,
  platform    VARCHAR(20) NOT NULL,
  title       TEXT,
  thumbnail   TEXT,
  media_count INTEGER DEFAULT 1,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_history_user_id    ON download_history(user_id);
CREATE INDEX idx_history_created_at ON download_history(created_at DESC);
CREATE INDEX idx_history_platform   ON download_history(platform);

-- ============================================================
-- Analytics Events
-- ============================================================
CREATE TABLE IF NOT EXISTS analytics_events (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  platform   VARCHAR(20) NOT NULL,
  user_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_analytics_platform   ON analytics_events(platform);
CREATE INDEX idx_analytics_created_at ON analytics_events(created_at DESC);

-- ============================================================
-- Row Level Security
-- ============================================================

-- download_history: users see only their own rows
ALTER TABLE download_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own history"
  ON download_history FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own history"
  ON download_history FOR DELETE
  USING (auth.uid() = user_id);

-- Service role bypasses RLS — backend uses service role for inserts
CREATE POLICY "Service role full access to history"
  ON download_history FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- analytics_events: read-only for authenticated users (service role writes)
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to analytics"
  ON analytics_events FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- Cleanup function: remove history older than 90 days
-- Schedule this via Supabase cron (pg_cron)
-- ============================================================
CREATE OR REPLACE FUNCTION cleanup_old_history()
RETURNS void LANGUAGE sql AS $$
  DELETE FROM download_history
  WHERE created_at < NOW() - INTERVAL '90 days';

  DELETE FROM analytics_events
  WHERE created_at < NOW() - INTERVAL '180 days';
$$;

-- Uncomment to enable pg_cron (requires pg_cron extension in Supabase)
-- SELECT cron.schedule('cleanup-old-data', '0 3 * * *', 'SELECT cleanup_old_history()');
