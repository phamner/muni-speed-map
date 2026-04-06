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
  sf: {
    file: "sfPopulationDensity.json",
    countyGeoids: [
      "06001",
      "06013",
      "06041",
      "06055",
      "06067",
      "06075",
      "06077",
      "06081",
      "06085",
      "06087",
      "06095",
      "06097",
      "06113",
    ],
    minWaterAreaSqM: 500000,
    allowedMtfcc: new Set(["H2030", "H2040", "H2051", "H2053"]),
  },
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
  const config = CITY_CONFIGS[cityKey];
  if (!config) {
    throw new Error(
      `Unknown city "${cityKey}". Supported: ${Object.keys(CITY_CONFIGS).join(", ")}`,
    );
  }

  const filePath = path.join(DATA_DIR, config.file);
  const geojson = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const waterFeaturesByCounty = new Map();

  for (const countyGeoid of config.countyGeoids) {
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
    console.error("Usage: node scripts/clipPopulationDensityToLand.js <cityKey>");
    process.exit(1);
  }

  await clipCityToLand(cityKey);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
