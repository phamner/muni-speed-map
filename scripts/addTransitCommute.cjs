const fs = require("fs");
const path = require("path");
const https = require("https");

const DENSITY_DIR = path.join(__dirname, "../src/data/population-density");

// City -> { stateFips, countyFipsList }
// Philadelphia spans two states, so it has two entries
const CITY_QUERIES = {
  SF: [{ state: "06", counties: ["001", "013", "041", "075", "081", "085"] }],
  LA: [{ state: "06", counties: ["037", "059", "065", "071", "111"] }],
  "San Jose": [{ state: "06", counties: ["001", "013", "075", "081", "085"] }],
  "San Diego": [{ state: "06", counties: ["073"] }],
  Boston: [{ state: "25", counties: ["009", "017", "021", "025"] }],
  Philadelphia: [
    { state: "42", counties: ["017", "029", "045", "091", "101"] },
    { state: "34", counties: ["005", "007", "015", "021"] },
  ],
  Pittsburgh: [{ state: "42", counties: ["003", "125"] }],
  Seattle: [{ state: "53", counties: ["033", "053", "061"] }],
  Portland: [
    { state: "41", counties: ["005", "051", "067"] },
    { state: "53", counties: ["011"] },
  ],
  Phoenix: [{ state: "04", counties: ["013"] }],
  Denver: [{ state: "08", counties: ["001", "005", "013", "031", "035", "059"] }],
  "Salt Lake City": [{ state: "49", counties: ["003", "011", "035", "049", "057"] }],
  Cleveland: [{ state: "39", counties: ["035", "085", "093"] }],
  Charlotte: [{ state: "37", counties: ["071", "119", "179"] }],
  Baltimore: [{ state: "24", counties: ["003", "005", "027", "510"] }],
  Minneapolis: [{ state: "27", counties: ["037", "053", "123"] }],
};

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

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch (e) {
          reject(e);
        }
      });
      res.on("error", reject);
    }).on("error", reject);
  });
}

async function fetchTransitDataForCounty(stateFips, countyFips) {
  const url = `https://api.census.gov/data/2022/acs/acs5?get=B08301_001E,B08301_010E&for=tract:*&in=state:${stateFips}&in=county:${countyFips}`;
  const data = await fetchJson(url);
  // First row is headers, rest are data
  const results = new Map();
  for (let i = 1; i < data.length; i++) {
    const [totalWorkers, transitWorkers, state, county, tract] = data[i];
    const geoid = `${state}${county}${tract}`;
    const total = parseInt(totalWorkers, 10);
    const transit = parseInt(transitWorkers, 10);
    if (total > 0 && !isNaN(transit)) {
      results.set(geoid, { total, transit });
    }
  }
  return results;
}

async function main() {
  console.log("Downloading ACS transit commute data (Table B08301)...\n");

  for (const [city, queries] of Object.entries(CITY_QUERIES)) {
    const prefix = cityToPrefix[city];
    const filename = `${prefix}PopulationDensity.json`;
    const filepath = path.join(DENSITY_DIR, filename);

    if (!fs.existsSync(filepath)) {
      console.warn(`  ${city}: file not found (${filename}), skipping`);
      continue;
    }

    // Fetch transit data for all counties in this city
    const transitLookup = new Map();
    for (const query of queries) {
      for (const county of query.counties) {
        try {
          const countyData = await fetchTransitDataForCounty(query.state, county);
          for (const [geoid, data] of countyData) {
            transitLookup.set(geoid, data);
          }
          console.log(`  ${city} - state ${query.state} county ${county}: ${countyData.size} tracts`);
        } catch (err) {
          console.error(`  ${city} - state ${query.state} county ${county}: FAILED - ${err.message}`);
        }
      }
    }

    // Merge into GeoJSON
    const geojson = JSON.parse(fs.readFileSync(filepath, "utf8"));
    let matched = 0;
    let unmatched = 0;

    for (const feature of geojson.features) {
      const geoid = feature.properties.GEOID;
      const data = transitLookup.get(geoid);
      if (data) {
        const pct = Math.round((data.transit / data.total) * 1000) / 10; // one decimal
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

    fs.writeFileSync(filepath, JSON.stringify(geojson));
    console.log(`  ${city}: ${matched} matched, ${unmatched} unmatched (${geojson.features.length} total)\n`);
  }

  console.log("Done!");
}

main().catch(console.error);
