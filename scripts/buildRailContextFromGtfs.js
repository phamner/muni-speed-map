#!/usr/bin/env node

import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import { parseCsv, extractRailContextFromGtfsTables } from "./lib/railContextGtfs.js";

const CITY_PREFIX = {
  SF: "sf",
  LA: "la",
  Seattle: "seattle",
  Boston: "boston",
  Portland: "portland",
  "San Diego": "sanDiego",
  Toronto: "toronto",
  Philadelphia: "philly",
  Sacramento: "sacramento",
  Pittsburgh: "pittsburgh",
  Dallas: "dallas",
  Minneapolis: "minneapolis",
  Denver: "denver",
  "Salt Lake City": "slc",
  "San Jose": "vta",
  Phoenix: "phoenix",
  "Jersey City": "hblr",
  Calgary: "calgary",
  Edmonton: "edmonton",
  Cleveland: "cleveland",
  Charlotte: "charlotte",
  Baltimore: "baltimore",
  Washington: "washington",
};

function getArg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return null;
  return process.argv[idx + 1] || null;
}

const zipPath = getArg("--zip");
const city = getArg("--city");
const outDir = getArg("--out-dir") || "src/data";
const includeMonorail = process.argv.includes("--include-monorail");

if (!zipPath || !city) {
  console.error(
    "Usage: node scripts/buildRailContextFromGtfs.js --zip <path/to/gtfs.zip> --city \"Minneapolis\" [--out-dir src/data] [--include-monorail]",
  );
  process.exit(1);
}

const prefix = CITY_PREFIX[city];
if (!prefix) {
  console.error(`No city filename prefix configured for: ${city}`);
  process.exit(1);
}

const zip = new AdmZip(zipPath);
const readText = (name) => {
  const entry = zip.getEntry(name);
  if (!entry) throw new Error(`Missing required GTFS file: ${name}`);
  return entry.getData().toString("utf8");
};

const routes = parseCsv(readText("routes.txt"));
const trips = parseCsv(readText("trips.txt"));
const shapes = parseCsv(readText("shapes.txt"));
const agency = parseCsv(readText("agency.txt"));

const { heavy, commuter } = extractRailContextFromGtfsTables(
  { routes, trips, shapes, agency },
  {
    heavyRouteTypes: ["1"],
    commuterRouteTypes: includeMonorail ? ["2", "12"] : ["2"],
    dissolveByRoute: true,
    simplifyMaxPoints: 220,
  },
);

fs.mkdirSync(outDir, { recursive: true });
const heavyOut = path.join(outDir, `${prefix}RailContextHeavy.json`);
const commuterOut = path.join(outDir, `${prefix}RailContextCommuter.json`);

fs.writeFileSync(heavyOut, JSON.stringify(heavy, null, 2));
fs.writeFileSync(commuterOut, JSON.stringify(commuter, null, 2));

console.log(`Wrote ${heavyOut} (${heavy.features.length} feature(s))`);
console.log(`Wrote ${commuterOut} (${commuter.features.length} feature(s))`);

