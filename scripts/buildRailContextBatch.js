#!/usr/bin/env node

import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import {
  parseCsv,
  extractRailContextFromGtfsTables,
} from "./lib/railContextGtfs.js";
import {
  railContextFeeds,
  cityToRailContextPrefix,
} from "./config/railContextFeeds.js";

function getArg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return null;
  return process.argv[idx + 1] || null;
}

function dedupeFeatures(features) {
  const seen = new Set();
  const out = [];
  for (const feature of features) {
    const props = feature.properties || {};
    const key = [
      props.service_class || "",
      props.route_id || "",
      props.route_name || "",
      JSON.stringify(feature.geometry || {}),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(feature);
  }
  return out;
}

function readGtfsTables(zipPath) {
  const zip = new AdmZip(zipPath);
  const readText = (name) => {
    const entry = zip.getEntry(name);
    if (!entry) throw new Error(`Missing required GTFS file: ${name}`);
    return entry.getData().toString("utf8");
  };
  return {
    routes: parseCsv(readText("routes.txt")),
    trips: parseCsv(readText("trips.txt")),
    shapes: parseCsv(readText("shapes.txt")),
    agency: parseCsv(readText("agency.txt")),
  };
}

const outDir = getArg("--out-dir") || "src/data";
const onlyCity = getArg("--city");
const includeMonorail = process.argv.includes("--include-monorail");

const emptyCollection = { type: "FeatureCollection", features: [] };

const cities = onlyCity ? [onlyCity] : Object.keys(cityToRailContextPrefix);
fs.mkdirSync(outDir, { recursive: true });

for (const city of cities) {
  const prefix = cityToRailContextPrefix[city];
  if (!prefix) {
    console.warn(`Skipping unknown city key: ${city}`);
    continue;
  }

  const feeds = railContextFeeds[city] || [];
  const heavyFeatures = [];
  const commuterFeatures = [];

  for (const zipPath of feeds) {
    const feedConfig =
      typeof zipPath === "string" ? { zipPath } : zipPath || {};
    const zipFile = feedConfig.zipPath;

    if (!zipFile) {
      console.warn(`[${city}] Invalid feed config entry (missing zipPath)`);
      continue;
    }

    if (!fs.existsSync(zipFile)) {
      console.warn(`[${city}] Missing GTFS zip: ${zipFile}`);
      continue;
    }
    try {
      const tables = readGtfsTables(zipFile);
      const { heavy, commuter } = extractRailContextFromGtfsTables(tables, {
        heavyRouteTypes: ["1"],
        commuterRouteTypes: includeMonorail ? ["2", "12"] : ["2"],
        dissolveByRoute: true,
        simplifyMaxPoints: 220,
        routeShapePrefixes: feedConfig.routeShapePrefixes || {},
        includeRouteIds: feedConfig.includeRouteIds || [],
        includeRouteShortNames: feedConfig.includeRouteShortNames || [],
        includeRouteLongNames: feedConfig.includeRouteLongNames || [],
      });
      heavyFeatures.push(...(heavy.features || []));
      commuterFeatures.push(...(commuter.features || []));
    } catch (error) {
      console.warn(
        `[${city}] Failed to parse ${zipFile}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  const heavy = {
    ...emptyCollection,
    features: dedupeFeatures(heavyFeatures),
  };
  const commuter = {
    ...emptyCollection,
    features: dedupeFeatures(commuterFeatures),
  };

  const heavyOut = path.join(outDir, `${prefix}RailContextHeavy.json`);
  const commuterOut = path.join(outDir, `${prefix}RailContextCommuter.json`);
  fs.writeFileSync(heavyOut, JSON.stringify(heavy, null, 2));
  fs.writeFileSync(commuterOut, JSON.stringify(commuter, null, 2));

  console.log(
    `[${city}] heavy=${heavy.features.length}, commuter=${commuter.features.length}`,
  );
}
