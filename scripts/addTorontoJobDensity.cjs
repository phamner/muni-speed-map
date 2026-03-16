const fs = require("fs");
const path = require("path");
const https = require("https");
const zlib = require("zlib");

const DENSITY_DIR = path.join(__dirname, "../src/data/population-density");
const TORONTO_FILE = path.join(DENSITY_DIR, "torontoPopulationDensity.json");

// Statistics Canada Table 98-10-0504-01:
// "Commuting duration by main mode of commuting and time arriving at work:
//  Census metropolitan areas, tracted census agglomerations and census tracts of work"
// This gives us total workers commuting TO each census tract (i.e., jobs located there).
const CSV_URL = "https://www150.statcan.gc.ca/n1/tbl/csv/98100504-eng.zip";

// Toronto-area CMA codes in our GeoJSON
const TORONTO_DGUID_PREFIXES = [
  "2021S0507532", // Oshawa
  "2021S0507535", // Toronto
  "2021S0507537", // Hamilton
  "2021S0507541", // Kitchener
  "2021S0507550", // Guelph
  "2021S0507568", // Barrie
];

// DGUID "2021S05075350001.00" -> GEOID "5350001.00"
function dguidToGeoid(dguid) {
  return dguid.replace("2021S0507", "");
}

function downloadAndUnzip(url) {
  return new Promise((resolve, reject) => {
    const doRequest = (reqUrl) => {
      https
        .get(reqUrl, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            console.log("  Redirecting...");
            doRequest(res.headers.location);
            return;
          }
          if (res.statusCode !== 200) {
            return reject(new Error(`HTTP ${res.statusCode}`));
          }

          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const zipBuffer = Buffer.concat(chunks);
            console.log(`  Downloaded ${(zipBuffer.length / 1024 / 1024).toFixed(1)} MB`);

            // Write zip to temp, extract with unzip
            const tmpZip = path.join(require("os").tmpdir(), "statcan_commute_ct.zip");
            const tmpDir = path.join(require("os").tmpdir(), "statcan_commute_ct");
            fs.writeFileSync(tmpZip, zipBuffer);

            const { execSync } = require("child_process");
            execSync(`mkdir -p "${tmpDir}" && unzip -o "${tmpZip}" -d "${tmpDir}"`, {
              stdio: "pipe",
            });

            const csvFile = path.join(tmpDir, "98100504.csv");
            if (!fs.existsSync(csvFile)) {
              return reject(new Error("CSV file not found in zip"));
            }
            resolve(fs.readFileSync(csvFile, "utf8"));
          });
          res.on("error", reject);
        })
        .on("error", reject);
    };
    doRequest(url);
  });
}

function parseCSVLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

async function main() {
  console.log("Adding job density data for Toronto from Statistics Canada 2021 Census...");
  console.log("Downloading Table 98-10-0504-01 (~19 MB)...\n");

  const csvText = await downloadAndUnzip(CSV_URL);
  const lines = csvText.split("\n");
  console.log(`  Total CSV lines: ${lines.length}`);

  // Build GEOID set from our GeoJSON
  const geojson = JSON.parse(fs.readFileSync(TORONTO_FILE, "utf8"));
  const geoidSet = new Set(geojson.features.map((f) => f.properties.GEOID));
  console.log(`  GeoJSON tracts: ${geoidSet.size}\n`);

  // Parse CSV: find rows matching Toronto-area tracts with
  // "Total - Time arriving at work" and "Total - Main mode of commuting"
  const jobCounts = new Map(); // geoid -> total workers (= jobs)
  let matchedRows = 0;

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;

    const fields = parseCSVLine(lines[i]);
    const dguid = fields[2];

    // Quick filter: only Toronto-area tracts
    if (!dguid || !TORONTO_DGUID_PREFIXES.some((p) => dguid.startsWith(p))) continue;

    const timeArriving = fields[3];
    const commuteMode = fields[4];

    if (
      timeArriving === "Total - Time arriving at work" &&
      commuteMode === "Total - Main mode of commuting"
    ) {
      const geoid = dguidToGeoid(dguid);
      // Column 6 is "Total - Commuting duration" = total workers
      const totalWorkers = parseInt(fields[6], 10);

      if (!isNaN(totalWorkers) && geoidSet.has(geoid)) {
        jobCounts.set(geoid, totalWorkers);
        matchedRows++;
      }
    }
  }

  console.log(`Matched ${matchedRows} tracts with job data`);

  // Show sample data
  console.log("\nSample job counts (top 10):");
  const sorted = [...jobCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [geoid, jobs] of sorted.slice(0, 10)) {
    const feat = geojson.features.find((f) => f.properties.GEOID === geoid);
    const areaKm2 = feat
      ? feat.properties.AREALAND / 1000000
      : 0;
    const density = areaKm2 > 0 ? Math.round(jobs / areaKm2) : 0;
    console.log(`  ${geoid}: ${jobs.toLocaleString()} jobs (${density.toLocaleString()}/km²)`);
  }

  // Merge into GeoJSON
  let matched = 0;
  let unmatched = 0;

  for (const feature of geojson.features) {
    const geoid = feature.properties.GEOID;
    const jobs = jobCounts.get(geoid);
    if (jobs !== undefined) {
      feature.properties.JOBS = jobs;
      matched++;
    } else {
      feature.properties.JOBS = 0;
      unmatched++;
    }
  }

  fs.writeFileSync(TORONTO_FILE, JSON.stringify(geojson));
  console.log(
    `\nToronto: ${matched} matched, ${unmatched} unmatched (${geojson.features.length} total)`
  );
  console.log("Done! Updated torontoPopulationDensity.json with JOBS property");
}

main().catch(console.error);
