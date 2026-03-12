#!/usr/bin/env node

/**
 * Fetch Census tract population density data for Canadian cities
 * from Statistics Canada's boundary GeoJSON API and Census Profile SDMX API.
 *
 * Usage:
 *   node scripts/fetchCanadianPopulationDensity.js <city>
 *   node scripts/fetchCanadianPopulationDensity.js --list
 *
 * Examples:
 *   node scripts/fetchCanadianPopulationDensity.js toronto
 *   node scripts/fetchCanadianPopulationDensity.js --list
 *
 * Note: StatCan's SSL certificate chain may not be trusted by all Node.js
 * versions. The script sets NODE_TLS_REJECT_UNAUTHORIZED=0 for these requests.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";
import https from "https";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "src", "data");

const agent = new https.Agent({ rejectUnauthorized: false });

const BOUNDARY_URL =
  "https://geo.statcan.gc.ca/geo_wa/rest/services/2021/Digital_boundary_files/MapServer/11/query";

const POPULATION_URL =
  "https://api.statcan.gc.ca/census-recensement/profile/sdmx/rest/data/STC_CP,DF_CT/A5..1.1.1";

// CMA (Census Metropolitan Area) codes
// CTUID prefix identifies which CMA a census tract belongs to
const CITY_CONFIGS = {
  toronto: {
    file: "torontoPopulationDensity.json",
    areaCodes: ["535", "532", "537", "541", "550", "568"],
    label:
      "Toronto + Oshawa + Hamilton + Kitchener-Cambridge-Waterloo + Guelph + Barrie CMAs",
  },
};

async function fetchPopulationData() {
  console.log("  Fetching population data from Census Profile API...");

  const res = await fetch(`${POPULATION_URL}?format=csv`, { agent });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching population data`);
  }

  const csv = await res.text();
  const lines = csv.trim().split("\n");
  const header = lines[0].split(",");

  const altGeoIdx = header.indexOf("ALT_GEO_CODE");
  const obsValueIdx = header.indexOf("OBS_VALUE");

  if (altGeoIdx === -1 || obsValueIdx === -1) {
    throw new Error("Unexpected CSV format from Census Profile API");
  }

  const popByCtuid = new Map();
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const ctuid = cols[altGeoIdx];
    const pop = parseInt(cols[obsValueIdx], 10);
    if (ctuid && !isNaN(pop)) {
      popByCtuid.set(ctuid, pop);
    }
  }

  console.log(`    → ${popByCtuid.size} census tracts with population data`);
  return popByCtuid;
}

async function fetchBoundaries(areaCodes, label) {
  const codes = Array.isArray(areaCodes) ? areaCodes : [areaCodes];
  console.log(
    `  Fetching boundaries for ${label} (${codes.length} CMA codes)...`,
  );

  const where = codes.map((code) => `CTUID LIKE '${code}%'`).join(" OR ");

  const params = new URLSearchParams({
    where,
    outFields: "CTUID,CTNAME,LANDAREA",
    returnGeometry: "true",
    f: "geojson",
    outSR: "4326",
    resultRecordCount: "6000",
  });

  const url = `${BOUNDARY_URL}?${params}`;
  const res = await fetch(url, { agent });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching boundaries for ${label}`);
  }

  const data = await res.json();
  if (data.error) {
    throw new Error(`API error: ${data.error.message}`);
  }

  const features = data.features || [];
  console.log(`    → ${features.length} census tracts`);
  return features;
}

async function fetchCity(cityKey) {
  const config = CITY_CONFIGS[cityKey];
  if (!config) {
    console.error(
      `Unknown city: ${cityKey}. Use --list to see available cities.`,
    );
    process.exit(1);
  }

  console.log(`\nFetching population density for: ${cityKey}`);

  const [popByCtuid, features] = await Promise.all([
    fetchPopulationData(),
    fetchBoundaries(config.areaCodes, config.label),
  ]);

  let matched = 0;
  let unmatched = 0;

  const outputFeatures = features.map((f) => {
    const ctuid = f.properties.CTUID;
    const pop = popByCtuid.get(ctuid);
    const landAreaKm2 = f.properties.LANDAREA || 0;
    const landAreaM2 = Math.round(landAreaKm2 * 1_000_000);

    if (pop !== undefined) {
      matched++;
    } else {
      unmatched++;
    }

    return {
      type: "Feature",
      geometry: f.geometry,
      properties: {
        GEOID: ctuid,
        POP100: pop || 0,
        AREALAND: landAreaM2,
      },
    };
  });

  console.log(
    `    → ${matched} tracts matched with population, ${unmatched} without`,
  );

  const geojson = {
    type: "FeatureCollection",
    features: outputFeatures,
  };

  const outPath = path.join(DATA_DIR, config.file);
  fs.writeFileSync(outPath, JSON.stringify(geojson));

  const sizeKB = Math.round(fs.statSync(outPath).size / 1024);
  console.log(
    `\n  Wrote ${outputFeatures.length} tracts to ${config.file} (${sizeKB} KB)`,
  );

  return outputFeatures.length;
}

// Main
const args = process.argv.slice(2);

if (args.includes("--list")) {
  console.log("\nAvailable Canadian cities:\n");
  for (const [key, config] of Object.entries(CITY_CONFIGS)) {
    console.log(
      `  ${key.padEnd(12)} → ${config.file} (${config.areaCodes.join(", ")})`,
    );
  }
  process.exit(0);
}

if (args.length === 0) {
  console.log(
    "Usage: node scripts/fetchCanadianPopulationDensity.js <city> [--list]",
  );
  process.exit(1);
}

const cityKey = args[0];
fetchCity(cityKey).then((count) => {
  console.log(`\nDone! ${count} total tracts fetched.`);
});
