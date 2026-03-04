import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing Supabase credentials in .env file");
  console.error("Make sure SUPABASE_URL and SUPABASE_SERVICE_KEY are set");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function fetchNTDData() {
  console.log("Fetching SF Muni ridership data from NTD API...");

  const url =
    "https://data.transportation.gov/resource/5ti2-5uiv.json?agency=City%20and%20County%20of%20San%20Francisco&mode=LR&$where=year>=2015&$limit=5000";

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch NTD data: ${response.statusText}`);
  }

  const data = await response.json();
  console.log(`Fetched ${data.length} records from NTD`);

  return data;
}

function transformData(ntdRecords) {
  return ntdRecords.map((record) => ({
    ntd_id: record._5_digit_ntd_id,
    agency: record.agency,
    mode: record.mode,
    year: parseInt(record.year),
    month: record.month,
    month_year: record.month_year,
    ridership: parseInt(record.ridership),
    vehicles: parseInt(record.vehicles),
    vehicle_revenue_miles: parseInt(record.vehicle_revenue_miles),
    vehicle_revenue_hours: parseInt(record.vehicle_revenue_hours),
    primary_uza_name: record.primary_uza_name,
    service_area_sq_miles: parseFloat(record.service_area_sq_miles),
    service_area_population: parseInt(record.service_area_population),
  }));
}

async function insertData(records) {
  console.log(`Inserting ${records.length} records into Supabase...`);

  // Insert in batches of 100 to avoid timeouts
  const batchSize = 100;
  let inserted = 0;

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);

    const { data, error } = await supabase.from("ridership_data").insert(batch);

    if (error) {
      console.error(`Error inserting batch ${i / batchSize + 1}:`, error);
      throw error;
    }

    inserted += batch.length;
    console.log(`Inserted ${inserted}/${records.length} records`);
  }

  console.log("✅ All records inserted successfully!");
}

async function main() {
  try {
    const ntdData = await fetchNTDData();
    const transformedData = transformData(ntdData);
    await insertData(transformedData);

    console.log("\n🎉 Import complete!");
    console.log(`Total records: ${transformedData.length}`);
    console.log(
      `Date range: ${transformedData[0].year}-${transformedData[0].month} to ${transformedData[transformedData.length - 1].year}-${transformedData[transformedData.length - 1].month}`,
    );
  } catch (error) {
    console.error("❌ Import failed:", error);
    process.exit(1);
  }
}

main();
