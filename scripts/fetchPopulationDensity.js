#!/usr/bin/env node

/**
 * Fetch Census tract population density data from TIGERweb REST API.
 *
 * Usage:
 *   node scripts/fetchPopulationDensity.js <city>         # Fetch and overwrite
 *   node scripts/fetchPopulationDensity.js <city> --append # Append new counties to existing file
 *   node scripts/fetchPopulationDensity.js --list          # List all city configs
 *
 * Examples:
 *   node scripts/fetchPopulationDensity.js sf
 *   node scripts/fetchPopulationDensity.js slc
 *   node scripts/fetchPopulationDensity.js --list
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "src", "data", "population-density");

const TIGERWEB_URL =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/6/query";

// State FIPS codes
const STATE = {
  CA: "06",
  MA: "25",
  MN: "27",
  UT: "49",
  WA: "53",
  OR: "41",
  PA: "42",
  NJ: "34",
  CO: "08",
  AZ: "04",
  OH: "39",
  NC: "37",
  MD: "24",
};

// City configurations: output filename + array of [stateFips, countyFips, countyName]
const CITY_CONFIGS = {
  sf: {
    file: "sfPopulationDensity.json",
    counties: [
      [STATE.CA, "075", "San Francisco County"],
      [STATE.CA, "081", "San Mateo County"],
      [STATE.CA, "001", "Alameda County"],
      [STATE.CA, "013", "Contra Costa County"],
      [STATE.CA, "041", "Marin County"],
      [STATE.CA, "055", "Napa County", { maxLat: 38.5 }],
      [STATE.CA, "067", "Sacramento County"],
      [STATE.CA, "077", "San Joaquin County"],
      [STATE.CA, "085", "Santa Clara County"],
      [STATE.CA, "095", "Solano County"],
      [STATE.CA, "097", "Sonoma County"],
      [STATE.CA, "113", "Yolo County", { maxLat: 38.7 }],
    ],
  },
  la: {
    file: "laPopulationDensity.json",
    counties: [
      [STATE.CA, "037", "Los Angeles County"],
      [STATE.CA, "059", "Orange County"],
    ],
  },
  boston: {
    file: "bostonPopulationDensity.json",
    counties: [
      [STATE.MA, "025", "Suffolk County"],
      [STATE.MA, "017", "Middlesex County"],
      [STATE.MA, "021", "Norfolk County"],
      [STATE.MA, "009", "Essex County"],
    ],
  },
  philly: {
    file: "phillyPopulationDensity.json",
    counties: [
      [STATE.PA, "101", "Philadelphia County"],
      [STATE.PA, "045", "Delaware County"],
      [STATE.PA, "091", "Montgomery County"],
      [STATE.PA, "017", "Bucks County"],
      [STATE.PA, "029", "Chester County"],
      [STATE.NJ, "007", "Camden County (NJ)"],
      [STATE.NJ, "015", "Gloucester County (NJ)"],
      [STATE.NJ, "005", "Burlington County (NJ)"],
      [STATE.NJ, "021", "Mercer County (NJ)"],
    ],
  },
  seattle: {
    file: "seattlePopulationDensity.json",
    counties: [
      [STATE.WA, "033", "King County"],
      [STATE.WA, "053", "Pierce County"],
      [STATE.WA, "061", "Snohomish County"],
    ],
  },
  portland: {
    file: "portlandPopulationDensity.json",
    counties: [
      [STATE.OR, "051", "Multnomah County"],
      [STATE.OR, "067", "Washington County"],
      [STATE.OR, "005", "Clackamas County"],
      [STATE.WA, "011", "Clark County (WA)"],
    ],
  },
  sanDiego: {
    file: "sanDiegoPopulationDensity.json",
    counties: [[STATE.CA, "073", "San Diego County"]],
  },
  sanJose: {
    file: "sanJosePopulationDensity.json",
    counties: [
      [STATE.CA, "085", "Santa Clara County"],
      [STATE.CA, "001", "Alameda County"],
      [STATE.CA, "013", "Contra Costa County"],
      [STATE.CA, "081", "San Mateo County"],
      [STATE.CA, "075", "San Francisco County"],
      [STATE.CA, "077", "San Joaquin County"],
    ],
  },
  pittsburgh: {
    file: "pittsburghPopulationDensity.json",
    counties: [
      [STATE.PA, "003", "Allegheny County"],
      [STATE.PA, "125", "Washington County"],
    ],
  },
  minneapolis: {
    file: "minneapolisPopulationDensity.json",
    counties: [
      [STATE.MN, "053", "Hennepin County"],
      [STATE.MN, "123", "Ramsey County"],
      [STATE.MN, "037", "Dakota County"],
    ],
  },
  denver: {
    file: "denverPopulationDensity.json",
    counties: [
      [STATE.CO, "031", "Denver County"],
      [STATE.CO, "001", "Adams County"],
      [STATE.CO, "005", "Arapahoe County"],
      [STATE.CO, "059", "Jefferson County"],
      [STATE.CO, "035", "Douglas County"],
      [STATE.CO, "013", "Boulder County"],
    ],
  },
  slc: {
    file: "saltLakeCityPopulationDensity.json",
    counties: [
      [STATE.UT, "035", "Salt Lake County"],
      [STATE.UT, "011", "Davis County"],
      [STATE.UT, "057", "Weber County"],
      [STATE.UT, "049", "Utah County"],
      [STATE.UT, "003", "Box Elder County"],
    ],
  },
  phoenix: {
    file: "phoenixPopulationDensity.json",
    counties: [[STATE.AZ, "013", "Maricopa County"]],
  },
  cleveland: {
    file: "clevelandPopulationDensity.json",
    counties: [
      [STATE.OH, "035", "Cuyahoga County"],
      [STATE.OH, "085", "Lake County"],
      [STATE.OH, "093", "Lorain County"],
    ],
  },
  charlotte: {
    file: "charlottePopulationDensity.json",
    counties: [
      [STATE.NC, "119", "Mecklenburg County"],
      [STATE.NC, "071", "Gaston County"],
      [STATE.NC, "179", "Union County"],
    ],
  },
  baltimore: {
    file: "baltimorePopulationDensity.json",
    counties: [
      [STATE.MD, "510", "Baltimore City"],
      [STATE.MD, "005", "Baltimore County"],
      [STATE.MD, "003", "Anne Arundel County"],
      [STATE.MD, "027", "Howard County"],
    ],
  },
};

function getCentroidLat(geometry) {
  const coords =
    geometry.type === "MultiPolygon"
      ? geometry.coordinates.flat(2)
      : geometry.coordinates.flat(1);
  const sum = coords.reduce((acc, c) => acc + c[1], 0);
  return sum / coords.length;
}

async function fetchCountyTracts(stateFips, countyFips, countyName, opts = {}) {
  const params = new URLSearchParams({
    where: `STATE='${stateFips}' AND COUNTY='${countyFips}'`,
    outFields: "GEOID,POP100,AREALAND",
    returnGeometry: "true",
    f: "geojson",
    outSR: "4326",
  });

  const url = `${TIGERWEB_URL}?${params}`;
  console.log(`  Fetching ${countyName} (${stateFips}${countyFips})...`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${countyName}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(`API error for ${countyName}: ${data.error.message}`);
  }

  let features = (data.features || []).map((f) => ({
    type: "Feature",
    geometry: f.geometry,
    properties: {
      GEOID: f.properties.GEOID,
      POP100: f.properties.POP100,
      AREALAND: f.properties.AREALAND,
    },
  }));

  if (opts.maxLat) {
    const before = features.length;
    features = features.filter((f) => getCentroidLat(f.geometry) <= opts.maxLat);
    console.log(`    → ${before} tracts, ${features.length} after lat filter (≤${opts.maxLat}°)`);
  } else {
    console.log(`    → ${features.length} tracts`);
  }

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

  console.log(
    `\nFetching population density for: ${cityKey} (${config.counties.length} counties)`,
  );

  const allFeatures = [];
  for (const entry of config.counties) {
    const [stateFips, countyFips, countyName, opts] = entry;
    const features = await fetchCountyTracts(stateFips, countyFips, countyName, opts);
    allFeatures.push(...features);
  }

  const geojson = {
    type: "FeatureCollection",
    features: allFeatures,
  };

  const outPath = path.join(DATA_DIR, config.file);
  fs.writeFileSync(outPath, JSON.stringify(geojson));

  const sizeKB = Math.round(fs.statSync(outPath).size / 1024);
  console.log(
    `\n  Wrote ${allFeatures.length} tracts to ${config.file} (${sizeKB} KB)`,
  );

  return allFeatures.length;
}

// Main
const args = process.argv.slice(2);

if (args.includes("--list")) {
  console.log("\nAvailable cities:\n");
  for (const [key, config] of Object.entries(CITY_CONFIGS)) {
    const counties = config.counties.map(([, , name]) => name).join(", ");
    console.log(`  ${key.padEnd(12)} → ${config.file}`);
    console.log(`${"".padEnd(17)}${counties}\n`);
  }
  process.exit(0);
}

if (args.length === 0) {
  console.log("Usage: node scripts/fetchPopulationDensity.js <city> [--list]");
  console.log("       node scripts/fetchPopulationDensity.js --list");
  process.exit(1);
}

const cityKey = args[0];
fetchCity(cityKey).then((count) => {
  console.log(`\nDone! ${count} total tracts fetched.`);
});
