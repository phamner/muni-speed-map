#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";
import shp from "shpjs";
import * as turf from "@turf/turf";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "src", "data", "population-density");

const CITY_CONFIGS = {
  sf: { file: "sfPopulationDensity.json" },
  la: { file: "laPopulationDensity.json" },
  boston: { file: "bostonPopulationDensity.json" },
  philly: { file: "phillyPopulationDensity.json", minWaterAreaSqM: 10000 },
  seattle: { file: "seattlePopulationDensity.json" },
  portland: { file: "portlandPopulationDensity.json", minWaterAreaSqM: 10000 },
  sanDiego: { file: "sanDiegoPopulationDensity.json" },
  sanJose: { file: "sanJosePopulationDensity.json" },
  pittsburgh: { file: "pittsburghPopulationDensity.json", minWaterAreaSqM: 10000 },
  minneapolis: { file: "minneapolisPopulationDensity.json" },
  denver: { file: "denverPopulationDensity.json" },
  slc: { file: "saltLakeCityPopulationDensity.json" },
  phoenix: { file: "phoenixPopulationDensity.json" },
  cleveland: { file: "clevelandPopulationDensity.json" },
  charlotte: { file: "charlottePopulationDensity.json" },
  baltimore: { file: "baltimorePopulationDensity.json", minWaterAreaSqM: 10000 },
  washingtonDc: { file: "washingtonDcPopulationDensity.json", minWaterAreaSqM: 10000 },
};

const DEFAULT_CONFIG = {
  minWaterAreaSqM: 500000,
  allowedMtfcc: new Set(["H2030", "H2040", "H2051", "H2053", "H3010", "H3020"]),
};

function bboxIntersects(a, b) {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

function normalizeFeatureCollections(parsed) {
  if (!parsed) return [];
  if (parsed.type === "FeatureCollection") return [parsed];
  if (Array.isArray(parsed)) {
    return parsed.filter((item) => item?.type === "FeatureCollection");
  }
  return [];
}

function getCountyGeoids(geojson) {
  const countyGeoids = new Set();

  for (const feature of geojson.features || []) {
    const geoid = String(feature?.properties?.GEOID || "");
    if (/^\d{11}$/.test(geoid)) {
      countyGeoids.add(geoid.slice(0, 5));
    }
  }

  return [...countyGeoids].sort();
}

async function downloadCountyWaterFeatures(countyGeoid, config) {
  const url = `https://www2.census.gov/geo/tiger/TIGER2020/AREAWATER/tl_2020_${countyGeoid}_areawater.zip`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${countyGeoid} water shapefile: HTTP ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const parsed = await shp(arrayBuffer);
  const collections = normalizeFeatureCollections(parsed);

  return collections
    .flatMap((collection) => collection.features || [])
    .filter(
      (feature) =>
        feature?.geometry &&
        (feature.geometry.type === "Polygon" ||
          feature.geometry.type === "MultiPolygon"),
    )
    .filter((feature) => {
      const mtfcc = String(feature.properties?.MTFCC || "").trim();
      const area = Number(feature.properties?.AWATER || 0);
      if (config.allowedMtfcc && !config.allowedMtfcc.has(mtfcc)) return false;
      if (config.minWaterAreaSqM && area < config.minWaterAreaSqM) return false;
      return true;
    })
    .map((feature) => ({
      ...feature,
      bbox: turf.bbox(feature),
    }));
}

async function clipCityToLand(cityKey) {
  const cityConfig = CITY_CONFIGS[cityKey];
  if (!cityConfig) {
    throw new Error(
      `Unknown city "${cityKey}". Supported: ${Object.keys(CITY_CONFIGS).join(", ")}, all-us`,
    );
  }

  const config = { ...DEFAULT_CONFIG, ...cityConfig };
  const filePath = path.join(DATA_DIR, config.file);
  const geojson = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const countyGeoids = getCountyGeoids(geojson);

  if (countyGeoids.length === 0) {
    throw new Error(
      `Could not infer U.S. county GEOIDs from ${config.file}. This script currently supports U.S. tract files only.`,
    );
  }

  const waterFeaturesByCounty = new Map();

  console.log(`\nClipping land geometry for ${cityKey} (${config.file})`);
  for (const countyGeoid of countyGeoids) {
    console.log(`Downloading areawater for ${countyGeoid}...`);
    const countyWater = await downloadCountyWaterFeatures(countyGeoid, config);
    console.log(`  → ${countyWater.length} water polygons`);
    waterFeaturesByCounty.set(countyGeoid, countyWater);
  }

  const totalWaterCount = Array.from(waterFeaturesByCounty.values()).reduce(
    (sum, features) => sum + features.length,
    0,
  );

  console.log(
    `Clipping ${geojson.features.length} tract geometries against ${totalWaterCount} water polygons...`,
  );

  let changed = 0;
  let dropped = 0;
  const clippedFeatures = [];

  for (const feature of geojson.features) {
    if (
      !feature?.geometry ||
      (feature.geometry.type !== "Polygon" &&
        feature.geometry.type !== "MultiPolygon")
    ) {
      clippedFeatures.push(feature);
      continue;
    }

    const tractBbox = turf.bbox(feature);
    const countyGeoid = String(feature.properties?.GEOID || "").slice(0, 5);
    const countyWaterFeatures = waterFeaturesByCounty.get(countyGeoid) || [];
    const candidates = countyWaterFeatures.filter((water) =>
      bboxIntersects(tractBbox, water.bbox),
    );

    let current = feature;
    let tractChanged = false;

    for (const water of candidates) {
      if (!current?.geometry) break;

      try {
        if (!turf.booleanIntersects(current, water)) continue;
        const diff = turf.difference(turf.featureCollection([current, water]));
        if (!diff) {
          current = null;
          tractChanged = true;
          break;
        }
        current = {
          ...current,
          geometry: diff.geometry,
        };
        tractChanged = true;
      } catch {
        // Keep original geometry if a specific water polygon causes a topology issue.
      }
    }

    if (!current) {
      dropped += 1;
      continue;
    }

    if (tractChanged) changed += 1;
    clippedFeatures.push(current);
  }

  const output = {
    ...geojson,
    features: clippedFeatures,
  };

  fs.writeFileSync(filePath, `${JSON.stringify(output)}\n`);
  console.log(
    `Wrote ${clippedFeatures.length} features to ${filePath} (${changed} changed, ${dropped} dropped).`,
  );
}

async function main() {
  const cityKey = process.argv[2];
  if (!cityKey) {
    console.error("Usage: node scripts/clipPopulationDensityToLand.js <cityKey|all-us>");
    process.exit(1);
  }

  if (cityKey === "all-us") {
    for (const key of Object.keys(CITY_CONFIGS)) {
      await clipCityToLand(key);
    }
    return;
  }

  await clipCityToLand(cityKey);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
