ALTER TABLE vehicle_positions
  ADD COLUMN IF NOT EXISTS segment_id_200 TEXT,
  ADD COLUMN IF NOT EXISTS segment_id_500 TEXT,
  ADD COLUMN IF NOT EXISTS segment_id_1000 TEXT,
  ADD COLUMN IF NOT EXISTS on_route BOOLEAN,
  ADD COLUMN IF NOT EXISTS mapping_version INTEGER,
  ADD COLUMN IF NOT EXISTS mapped_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_positions_segment_200
  ON vehicle_positions(segment_id_200, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_positions_segment_500
  ON vehicle_positions(segment_id_500, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_positions_segment_1000
  ON vehicle_positions(segment_id_1000, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_positions_mapping_version
  ON vehicle_positions(mapping_version, recorded_at DESC);
