-- Muni Speed Map Database Schema
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New Query)

-- Enable PostGIS for geospatial queries (optional but useful)
-- CREATE EXTENSION IF NOT EXISTS postgis;

-- Raw vehicle position observations
-- Collected every 15 seconds from 511 API
CREATE TABLE IF NOT EXISTS vehicle_positions (
  id BIGSERIAL PRIMARY KEY,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  vehicle_id TEXT NOT NULL,
  route_id TEXT NOT NULL,
  direction_id TEXT,
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  heading DOUBLE PRECISION,
  speed_reported DOUBLE PRECISION,      -- Speed from API (if available)
  speed_calculated DOUBLE PRECISION,    -- Speed calculated from previous position
  segment_id TEXT,                       -- Nearest route segment
  
  -- Index for fast queries
  CONSTRAINT valid_lat CHECK (lat BETWEEN -90 AND 90),
  CONSTRAINT valid_lon CHECK (lon BETWEEN -180 AND 180)
);

-- Create indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_positions_recorded_at ON vehicle_positions(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_positions_vehicle ON vehicle_positions(vehicle_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_positions_route ON vehicle_positions(route_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_positions_segment ON vehicle_positions(segment_id, recorded_at DESC);

-- Aggregated segment speeds (computed periodically)
CREATE TABLE IF NOT EXISTS segment_speeds (
  id BIGSERIAL PRIMARY KEY,
  segment_id TEXT NOT NULL,
  route_id TEXT NOT NULL,
  direction TEXT NOT NULL,              -- 'inbound' or 'outbound'
  day_type TEXT NOT NULL,               -- 'weekday', 'saturday', 'sunday'
  hour_bucket INT NOT NULL,             -- 0-23
  
  -- Speed statistics
  avg_speed DOUBLE PRECISION,
  median_speed DOUBLE PRECISION,
  min_speed DOUBLE PRECISION,
  max_speed DOUBLE PRECISION,
  p10_speed DOUBLE PRECISION,           -- 10th percentile (typically slow)
  p90_speed DOUBLE PRECISION,           -- 90th percentile (typically fast)
  
  sample_count INT DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Unique constraint for upserts
  UNIQUE(segment_id, route_id, direction, day_type, hour_bucket)
);

CREATE INDEX IF NOT EXISTS idx_segment_speeds_lookup 
  ON segment_speeds(route_id, day_type, hour_bucket);

-- View for recent vehicle positions (last 5 minutes)
CREATE OR REPLACE VIEW recent_positions AS
SELECT * FROM vehicle_positions
WHERE recorded_at > NOW() - INTERVAL '5 minutes'
ORDER BY recorded_at DESC;

-- Function to get the day type from a timestamp
CREATE OR REPLACE FUNCTION get_day_type(ts TIMESTAMPTZ)
RETURNS TEXT AS $$
BEGIN
  CASE EXTRACT(DOW FROM ts)
    WHEN 0 THEN RETURN 'sunday';
    WHEN 6 THEN RETURN 'saturday';
    ELSE RETURN 'weekday';
  END CASE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Enable Row Level Security (optional, for public access)
ALTER TABLE vehicle_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE segment_speeds ENABLE ROW LEVEL SECURITY;

-- Allow anonymous read access
CREATE POLICY "Allow public read access to positions"
  ON vehicle_positions FOR SELECT
  USING (true);

CREATE POLICY "Allow public read access to segment speeds"
  ON segment_speeds FOR SELECT
  USING (true);

-- Allow anonymous insert for the data collector
CREATE POLICY "Allow public insert to positions"
  ON vehicle_positions FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow public upsert to segment speeds"
  ON segment_speeds FOR ALL
  USING (true);

-- Grant permissions
GRANT SELECT, INSERT ON vehicle_positions TO anon;
GRANT SELECT, INSERT, UPDATE ON segment_speeds TO anon;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;

