const fs = require("fs");
const path = require("path");
const https = require("https");
const zlib = require("zlib");
const { createInterface } = require("readline");
const { Readable } = require("stream");

// State FIPS -> state abbreviation for LODES URLs
const STATE_FIPS_TO_ABBR = {
  "06": "ca", // SF, LA, San Diego, San Jose
  25: "ma", // Boston
  42: "pa", // Philadelphia (PA side), Pittsburgh
  34: "nj", // Philadelphia (NJ side)
  53: "wa", // Seattle
  41: "or", // Portland (OR side)
  48: "tx", // Phoenix... no, AZ
  "04": "az", // Phoenix
  "08": "co", // Denver
  49: "ut", // Salt Lake City
  39: "oh", // Cleveland
  37: "nc", // Charlotte
  24: "md", // Baltimore
  27: "mn", // Minneapolis
};

// City -> state FIPS codes needed
const CITY_TO_STATE_FIPS = {
  SF: ["06"],
  LA: ["06"],
  "San Diego": ["06"],
  "San Jose": ["06"],
  Boston: ["25"],
  Philadelphia: ["42", "34"],
  Pittsburgh: ["42"],
  Seattle: ["53"],
  Portland: ["41"],
  Phoenix: ["04"],
  Denver: ["08"],
  "Salt Lake City": ["49"],
  Cleveland: ["39"],
  Charlotte: ["37"],
  Baltimore: ["24"],
  Minneapolis: ["27"],
};

const DENSITY_DIR = path.join(__dirname, "../src/data/population-density");

function downloadGzCsv(url) {
  return new Promise((resolve, reject) => {
    console.log(`  Downloading ${url}...`);
    https
      .get(url, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return downloadGzCsv(res.headers.location).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        const gunzip = zlib.createGunzip();
        const chunks = [];
        res.pipe(gunzip);
        gunzip.on("data", (chunk) => chunks.push(chunk));
        gunzip.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        gunzip.on("error", reject);
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

async function loadLodesForState(stateAbbr) {
  const url = `https://lehd.ces.census.gov/data/lodes/LODES8/${stateAbbr}/wac/${stateAbbr}_wac_S000_JT00_2021.csv.gz`;
  const csv = await downloadGzCsv(url);

  // Parse CSV: first column is w_geocode (15-digit block FIPS), second is C000 (total jobs)
  const lines = csv.split("\n");
  const header = lines[0].split(",");
  const geocodeIdx = header.indexOf("w_geocode");
  const jobsIdx = header.indexOf("C000");

  if (geocodeIdx === -1 || jobsIdx === -1) {
    throw new Error(`Missing columns in LODES data for ${stateAbbr}`);
  }

  // Aggregate to tract level (first 11 digits of 15-digit block FIPS)
  const tractJobs = new Map();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(",");
    const blockFips = cols[geocodeIdx];
    const jobs = parseInt(cols[jobsIdx], 10);
    if (!blockFips || isNaN(jobs)) continue;

    const tractFips = blockFips.slice(0, 11);
    tractJobs.set(tractFips, (tractJobs.get(tractFips) || 0) + jobs);
  }

  console.log(`  ${stateAbbr}: ${tractJobs.size} tracts with job data`);
  return tractJobs;
}

async function main() {
  // Collect all unique states we need
  const allStates = new Set();
  for (const fipsList of Object.values(CITY_TO_STATE_FIPS)) {
    for (const fips of fipsList) allStates.add(fips);
  }

  // Download and aggregate LODES data per state
  console.log(`\nDownloading LODES WAC data for ${allStates.size} states...\n`);
  const stateData = new Map();
  for (const fips of allStates) {
    const abbr = STATE_FIPS_TO_ABBR[fips];
    if (!abbr) {
      console.warn(`  No abbreviation for state FIPS ${fips}, skipping`);
      continue;
    }
    try {
      const tractJobs = await loadLodesForState(abbr);
      stateData.set(fips, tractJobs);
    } catch (err) {
      console.error(`  Failed to load LODES for ${abbr}: ${err.message}`);
    }
  }

  // Now merge into each city's population density file
  const cityToPrefix = {
    SF: "sf",
    LA: "la",
    Boston: "boston",
    Philadelphia: "philly",
    Seattle: "seattle",
    Portland: "portland",
    "San Diego": "sanDiego",
    "San Jose": "sanJose",
    Pittsburgh: "pittsburgh",
    Minneapolis: "minneapolis",
    Denver: "denver",
    "Salt Lake City": "saltLakeCity",
    Phoenix: "phoenix",
    Cleveland: "cleveland",
    Charlotte: "charlotte",
    Baltimore: "baltimore",
  };

  console.log("\nMerging job data into population density files...\n");

  for (const [city, prefix] of Object.entries(cityToPrefix)) {
    const filename = `${prefix}PopulationDensity.json`;
    const filepath = path.join(DENSITY_DIR, filename);

    if (!fs.existsSync(filepath)) {
      console.warn(`  ${city}: file not found (${filename}), skipping`);
      continue;
    }

    const geojson = JSON.parse(fs.readFileSync(filepath, "utf8"));
    const stateFipsList = CITY_TO_STATE_FIPS[city] || [];

    // Build combined tract->jobs lookup from all relevant states
    const jobLookup = new Map();
    for (const fips of stateFipsList) {
      const tractJobs = stateData.get(fips);
      if (tractJobs) {
        for (const [tract, jobs] of tractJobs) {
          jobLookup.set(tract, (jobLookup.get(tract) || 0) + jobs);
        }
      }
    }

    let matched = 0;
    let unmatched = 0;
    for (const feature of geojson.features) {
      const geoid = feature.properties.GEOID;
      if (jobLookup.has(geoid)) {
        feature.properties.JOBS = jobLookup.get(geoid);
        matched++;
      } else {
        feature.properties.JOBS = 0;
        unmatched++;
      }
    }

    fs.writeFileSync(filepath, JSON.stringify(geojson));
    console.log(
      `  ${city}: ${matched} tracts matched, ${unmatched} unmatched (${geojson.features.length} total)`,
    );
  }

  console.log("\nDone!");
}

main().catch(console.error);
