import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "Supabase credentials not found. Database features will be disabled."
  );
}

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

export interface VehiclePosition {
  id?: number;
  recorded_at: string;
  vehicle_id: string;
  route_id: string;
  direction_id?: string;
  lat: number;
  lon: number;
  heading?: number;
  speed_reported?: number;
  speed_calculated?: number;
  segment_id?: string;
}

export interface SegmentSpeed {
  segment_id: string;
  route_id: string;
  direction: string;
  day_type: string;
  hour_bucket: number;
  avg_speed: number;
  median_speed?: number;
  min_speed?: number;
  max_speed?: number;
  p10_speed?: number;
  p90_speed?: number;
  sample_count: number;
  updated_at?: string;
}

// Insert vehicle positions
export async function insertPositions(
  positions: Omit<VehiclePosition, "id">[]
) {
  if (!supabase) return { error: new Error("Supabase not configured") };

  const { data, error } = await supabase
    .from("vehicle_positions")
    .insert(positions);

  return { data, error };
}

// Get recent positions for display
export async function getRecentPositions(minutes: number = 5) {
  if (!supabase) return { data: [], error: null };

  const since = new Date(Date.now() - minutes * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("vehicle_positions")
    .select("*")
    .gte("recorded_at", since)
    .order("recorded_at", { ascending: false });

  return { data: data || [], error };
}

// Get segment speeds for a given time period
export async function getSegmentSpeeds(
  dayType: string,
  hourBucket: number
): Promise<{ data: SegmentSpeed[]; error: Error | null }> {
  if (!supabase) return { data: [], error: null };

  const { data, error } = await supabase
    .from("segment_speeds")
    .select("*")
    .eq("day_type", dayType)
    .eq("hour_bucket", hourBucket);

  return { data: data || [], error };
}

// Get all segment speeds (for overview)
export async function getAllSegmentSpeeds(): Promise<{
  data: SegmentSpeed[];
  error: Error | null;
}> {
  if (!supabase) return { data: [], error: null };

  const { data, error } = await supabase.from("segment_speeds").select("*");

  return { data: data || [], error };
}

// Get position count (for stats)
export async function getPositionCount(): Promise<number> {
  if (!supabase) return 0;

  const { count, error } = await supabase
    .from("vehicle_positions")
    .select("*", { count: "exact", head: true });

  return error ? 0 : count || 0;
}
