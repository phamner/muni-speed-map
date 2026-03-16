const fs = require("fs");
const path = require("path");
const https = require("https");

const DENSITY_DIR = path.join(__dirname, "../src/data/population-density");
const TORONTO_FILE = path.join(DENSITY_DIR, "torontoPopulationDensity.json");

// Statistics Canada Census Profile SDMX API
// DF_CT = census tract dataflow
// Characteristic 2603 = "Total - Main mode of commuting..."
// Characteristic 2607 = "Public transit"
const API_BASE =
  "https://api.statcan.gc.ca/census-recensement/profile/sdmx/rest/data/STC_CP,DF_CT";

// GEOID in GeoJSON (e.g. "5350420.13") -> DGUID for API (e.g. "2021S05075350420_13")
function geoidToDguid(geoid) {
  return `2021S0507${geoid.replace(".", "_")}`;
}

function fetchCSV(url) {
  return new Promise((resolve, reject) => {
    const doRequest = (reqUrl) => {
      https
        .get(reqUrl, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            doRequest(res.headers.location);
            return;
          }
          if (res.statusCode === 404) {
            resolve("");
            return;
          }
          if (res.statusCode !== 200) {
            return reject(new Error(`HTTP ${res.statusCode} for ${reqUrl}`));
          }
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
          res.on("error", reject);
        })
        .on("error", reject);
    };
    doRequest(url);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log("Adding transit commute data for Toronto from Statistics Canada 2021 Census...\n");

  const geojson = JSON.parse(fs.readFileSync(TORONTO_FILE, "utf8"));
  const geoids = geojson.features.map((f) => f.properties.GEOID);
  console.log(`GeoJSON has ${geoids.length} tracts`);

  // Convert all GEOIDs to DGUIDs
  const dguidMap = new Map();
  for (const geoid of geoids) {
    dguidMap.set(geoidToDguid(geoid), geoid);
  }

  // Query in batches (API supports OR with + separator)
  // URL length limit is roughly 8000 chars; each DGUID is ~25 chars, so ~250 per batch
  const BATCH_SIZE = 150;
  const dguids = [...dguidMap.keys()];
  const transitData = new Map();
  let batchCount = 0;

  for (let i = 0; i < dguids.length; i += BATCH_SIZE) {
    const batch = dguids.slice(i, i + BATCH_SIZE);
    const geoParam = batch.join("+");
    const url = `${API_BASE}/A5.${geoParam}.1.2603+2607.1?format=csv`;

    batchCount++;
    process.stdout.write(
      `  Batch ${batchCount}/${Math.ceil(dguids.length / BATCH_SIZE)} (tracts ${i + 1}-${Math.min(i + BATCH_SIZE, dguids.length)})...`
    );

    try {
      const csv = await fetchCSV(url);
      if (!csv) {
        console.log(" no data");
        continue;
      }

      const lines = csv.split("\n");
      let rowsProcessed = 0;

      for (let j = 1; j < lines.length; j++) {
        if (!lines[j].trim()) continue;
        const fields = lines[j].split(",");
        // REF_AREA is column 3, CHARACTERISTIC is column 5, OBS_VALUE is column 7
        const refArea = fields[3];
        const characteristic = fields[5];
        const obsValue = parseInt(fields[7], 10);

        const geoid = dguidMap.get(refArea);
        if (!geoid || isNaN(obsValue)) continue;

        if (!transitData.has(geoid)) {
          transitData.set(geoid, { total: 0, transit: 0 });
        }

        if (characteristic === "2603") {
          transitData.get(geoid).total = obsValue;
        } else if (characteristic === "2607") {
          transitData.get(geoid).transit = obsValue;
        }
        rowsProcessed++;
      }

      console.log(` ${rowsProcessed} rows`);
    } catch (err) {
      console.log(` ERROR: ${err.message}`);
    }

    // Be polite to the API
    if (i + BATCH_SIZE < dguids.length) {
      await sleep(500);
    }
  }

  console.log(`\nGot transit data for ${transitData.size} tracts`);

  // Show sample data
  console.log("\nSample transit data:");
  for (const [geoid, data] of [...transitData].slice(0, 8)) {
    const pct =
      data.total > 0
        ? Math.round((data.transit / data.total) * 1000) / 10
        : 0;
    console.log(
      `  ${geoid}: ${data.transit}/${data.total} workers = ${pct}%`
    );
  }

  // Merge into GeoJSON
  let matched = 0;
  let unmatched = 0;

  for (const feature of geojson.features) {
    const geoid = feature.properties.GEOID;
    const data = transitData.get(geoid);
    if (data && data.total > 0) {
      const pct = Math.round((data.transit / data.total) * 1000) / 10;
      feature.properties.TRANSIT_PCT = pct;
      feature.properties.TRANSIT_WORKERS = data.transit;
      feature.properties.TOTAL_WORKERS = data.total;
      matched++;
    } else {
      feature.properties.TRANSIT_PCT = 0;
      feature.properties.TRANSIT_WORKERS = 0;
      feature.properties.TOTAL_WORKERS = 0;
      unmatched++;
    }
  }

  fs.writeFileSync(TORONTO_FILE, JSON.stringify(geojson));
  console.log(
    `\nToronto: ${matched} matched, ${unmatched} unmatched (${geojson.features.length} total)`
  );
  console.log("Done! Updated torontoPopulationDensity.json");
}

main().catch(console.error);
