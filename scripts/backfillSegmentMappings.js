import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SEGMENT_MAPPING_VERSION = 2;
const DEFAULT_BATCH_SIZE = Number(process.env.SEGMENT_BACKFILL_BATCH_SIZE || 500);

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error(
    "❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY. Add them to your environment before backfilling.",
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const SEGMENT_SIZE_METERS = 200;
const SEGMENT_SIZE_500_METERS = 500;
const SEGMENT_SIZE_1000_METERS = 1000;
const MAX_DISTANCE_FROM_ROUTE_METERS = 100;

const CITIES_WITH_PARALLEL_TRACKS = new Set([
  "SF",
  "LA",
  "Boston",
  "Toronto",
  "Philadelphia",
  "Denver",
  "Salt Lake City",
  "Phoenix",
  "Cleveland",
  "Charlotte",
  "Portland",
  "Pittsburgh",
  "Seattle",
]);

const CITY_ROUTE_SOURCES = {
  SF: ["src/data/routes/sfMuniOsmRoutes.json", "src/data/routes/sfCableCarRoutes.json"],
  LA: ["src/data/routes/laMetroRoutes.json", "src/data/routes/laHeritageLocalCirculatorRoutes.json"],
  Seattle: [
    "src/data/routes/seattleLinkRoutes.json",
    "src/data/routes/seattleHeritageLocalCirculatorRoutes.json",
  ],
  Boston: ["src/data/routes/bostonGreenLineRoutes.json"],
  Portland: ["src/data/routes/portlandMaxRoutes.json"],
  "San Diego": ["src/data/routes/sanDiegoTrolleyRoutes.json"],
  Toronto: ["src/data/routes/torontoStreetcarRoutes.json", "src/data/routes/torontoLrtRoutes.json"],
  Philadelphia: ["src/data/routes/phillyTrolleyRoutes.json"],
  Pittsburgh: ["src/data/routes/pittsburghTRoutes.json"],
  Minneapolis: ["src/data/routes/minneapolisMetroRoutes.json"],
  Denver: ["src/data/routes/denverRtdRoutes.json"],
  "Salt Lake City": ["src/data/routes/slcTraxRoutes.json"],
  "San Jose": ["src/data/routes/vtaLightRailRoutes.json"],
  Phoenix: [
    "src/data/routes/phoenixLightRailRoutes.json",
    "src/data/routes/phoenixHeritageLocalCirculatorRoutes.json",
  ],
  Charlotte: ["src/data/routes/charlotteLightRailRoutes.json"],
  Baltimore: ["src/data/routes/baltimoreLightRailRoutes.json"],
  Cleveland: ["src/data/routes/clevelandRtaRoutes.json"],
  Calgary: ["src/data/routes/calgaryLightRailRoutes.json"],
};

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    city: null,
    route: null,
    force: false,
    batchSize: DEFAULT_BATCH_SIZE,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--city") {
      options.city = args[i + 1] || null;
      i += 1;
    } else if (arg === "--route") {
      options.route = args[i + 1] || null;
      i += 1;
    } else if (arg === "--force") {
      options.force = true;
    } else if (arg === "--batch-size") {
      options.batchSize = Number(args[i + 1] || DEFAULT_BATCH_SIZE);
      i += 1;
    }
  }

  return options;
}

async function readJson(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  const content = await readFile(absolutePath, "utf8");
  return JSON.parse(content);
}

// --- D Line extension merge helpers (must match cityDataLoaders.ts logic) ---

function coordKey(coord) {
  return `${coord[0].toFixed(7)},${coord[1].toFixed(7)}`;
}

function mergeLineSegmentsIntoChains(lineStrings) {
  const chains = lineStrings.filter((l) => l && l.length >= 2).map((l) => [...l]);
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < chains.length; i++) {
      if (!chains[i]) continue;
      for (let j = i + 1; j < chains.length; j++) {
        if (!chains[j]) continue;
        const a = chains[i], b = chains[j];
        const aS = coordKey(a[0]), aE = coordKey(a[a.length - 1]);
        const bS = coordKey(b[0]), bE = coordKey(b[b.length - 1]);
        let combined = null;
        if (aE === bS) combined = [...a, ...b.slice(1)];
        else if (aE === bE) combined = [...a, ...[...b].reverse().slice(1)];
        else if (aS === bE) combined = [...b, ...a.slice(1)];
        else if (aS === bS) combined = [...[...b].reverse(), ...a.slice(1)];
        if (combined) { chains[i] = combined; chains[j] = null; merged = true; }
      }
    }
  }
  return chains.filter(Boolean).sort((a, b) => b.length - a.length);
}

function orientWestToEast(line) {
  return line[0][0] <= line[line.length - 1][0] ? line : [...line].reverse();
}

function minLonOf(line) { return Math.min(...line.map((c) => c[0])); }
function maxLonOf(line) { return Math.max(...line.map((c) => c[0])); }

function mergeDLineExtension(laRoutes) {
  let osmData;
  try {
    const osmPath = path.join(ROOT, "src/data/routes/laDLineOsm.json");
    const content = readFileSync(osmPath, "utf8");
    osmData = JSON.parse(content);
  } catch (err) {
    console.log("⚠️  D Line ORM file not found, skipping merge:", err.message);
    return laRoutes;
  }

  const segments = (osmData.features || [])
    .map((f) => f.geometry?.coordinates)
    .filter((c) => c && c.length >= 2);
  const chains = mergeLineSegmentsIntoChains(segments);
  if (chains.length < 2) { console.log("⚠️  Not enough D Line chains"); return laRoutes; }

  const features = laRoutes.features || [];

  // Pick the two longest west-reaching chains
  const westChains = chains.filter((c) => minLonOf(c) < -118.40).map(orientWestToEast).sort((a, b) => b.length - a.length);
  let primary = westChains[0] || [];
  let secondary = westChains[1] || [];

  // Bridge secondary to eastern fragments using primary's geometry offset
  if (secondary.length >= 2 && maxLonOf(secondary) < maxLonOf(primary) - 0.005) {
    const eastFragments = chains
      .filter((c) => c.length >= 2 && minLonOf(c) >= -118.40)
      .map(orientWestToEast)
      .sort((a, b) => b.length - a.length);
    for (const frag of eastFragments) {
      const secEnd = secondary[secondary.length - 1];
      const gap = Math.abs(frag[0][0] - secEnd[0]);
      if (gap < 0.04) {
        const interpPrimaryLat = (lon) => {
          for (let k = 1; k < primary.length; k++) {
            const prev = primary[k - 1], cur = primary[k];
            if ((prev[0] <= lon && cur[0] >= lon) || (cur[0] <= lon && prev[0] >= lon)) {
              const span = cur[0] - prev[0];
              if (Math.abs(span) < 1e-10) return prev[1];
              return prev[1] + (lon - prev[0]) / span * (cur[1] - prev[1]);
            }
          }
          return lon;
        };
        const startOffset = secEnd[1] - interpPrimaryLat(secEnd[0]);
        const endOffset = frag[0][1] - interpPrimaryLat(frag[0][0]);
        const bridgePoints = primary
          .filter((p) => p[0] > secEnd[0] && p[0] < frag[0][0])
          .map((p) => {
            const t = (p[0] - secEnd[0]) / (frag[0][0] - secEnd[0]);
            const offset = startOffset + t * (endOffset - startOffset);
            return [p[0], p[1] + offset];
          });
        secondary = [...secondary, ...bridgePoints, ...frag];
        break;
      }
    }
  }

  if (primary.length < 2 || secondary.length < 2) return laRoutes;

  // Get base D Line feature for property templates
  const dLineBase = features.find((f) => String(f.properties?.route_id) === "805");
  const baseProps = dLineBase?.properties || { route_id: "805", route_name: "D Line (Purple)", route_color: "#A05DA5" };
  const nonDLine = features.filter((f) => String(f.properties?.route_id) !== "805");

  console.log(`✅ D Line ORM merged: outbound ${primary.length} pts, inbound ${secondary.length} pts`);
  return {
    ...laRoutes,
    features: [
      ...nonDLine,
      { type: "Feature", properties: { ...baseProps, shape_id: "805OSM_FULL_EASTBOUND", direction_id: "0", direction: "outbound", source: "OpenStreetMap/OpenRailwayMap" }, geometry: { type: "LineString", coordinates: primary } },
      { type: "Feature", properties: { ...baseProps, shape_id: "805OSM_FULL_WESTBOUND", direction_id: "1", direction: "inbound", source: "OpenStreetMap/OpenRailwayMap" }, geometry: { type: "LineString", coordinates: [...secondary].reverse() } },
    ],
  };
}

// --- End D Line helpers ---

// --- B Line (Red) ORM replacement (must match cityDataLoaders.ts logic) ---
function mergeBLineOsm(laRoutes) {
  let osmData;
  try {
    const osmPath = path.join(ROOT, "src/data/routes/laBLineOsm.json");
    const content = readFileSync(osmPath, "utf8");
    osmData = JSON.parse(content);
  } catch (err) {
    console.log("⚠️  B Line ORM file not found, skipping merge:", err.message);
    return laRoutes;
  }

  const segments = (osmData.features || [])
    .map((f) => f.geometry?.coordinates)
    .filter((c) => c && c.length >= 2);
  const chains = mergeLineSegmentsIntoChains(segments);
  if (chains.length < 2) { console.log("⚠️  Not enough B Line chains"); return laRoutes; }

  const features = laRoutes.features || [];

  // Pick the two longest chains, orient NW→SE (west-to-east)
  const sortedChains = [...chains].sort((a, b) => b.length - a.length).slice(0, 2).map(orientWestToEast);
  const bPrimary = sortedChains[0] || [];
  const bSecondary = sortedChains[1] || [];

  if (bPrimary.length < 2 || bSecondary.length < 2) return laRoutes;

  const bLineBase = features.find((f) => String(f.properties?.route_id) === "802");
  const bBaseProps = bLineBase?.properties || { route_id: "802", route_name: "B Line (Red)", route_color: "#E3131B" };
  const nonBLine = features.filter((f) => String(f.properties?.route_id) !== "802");

  console.log(`✅ B Line ORM merged: outbound ${bPrimary.length} pts, inbound ${bSecondary.length} pts`);
  return {
    ...laRoutes,
    features: [
      ...nonBLine,
      { type: "Feature", properties: { ...bBaseProps, shape_id: "802OSM_FULL_OUTBOUND", direction_id: "0", direction: "outbound", source: "OpenStreetMap/OpenRailwayMap" }, geometry: { type: "LineString", coordinates: bPrimary } },
      { type: "Feature", properties: { ...bBaseProps, shape_id: "802OSM_FULL_INBOUND", direction_id: "1", direction: "inbound", source: "OpenStreetMap/OpenRailwayMap" }, geometry: { type: "LineString", coordinates: [...bSecondary].reverse() } },
    ],
  };
}
// --- End B Line helpers ---

async function loadRouteCollections() {
  const routeCollections = new Map();
  const routeIdsByCity = new Map();

  for (const [city, sourcePaths] of Object.entries(CITY_ROUTE_SOURCES)) {
    const collections = await Promise.all(sourcePaths.map(readJson));
    let merged = {
      type: "FeatureCollection",
      features: collections.flatMap((collection) => collection?.features || []),
    };

    // Merge D Line extension so segment IDs match the renderer
    if (city === "LA") {
      merged = mergeDLineExtension(merged);
      merged = mergeBLineOsm(merged);
    }

    routeCollections.set(city, merged);
    routeIdsByCity.set(
      city,
      new Set(
        merged.features
          .map((feature) => String(feature?.properties?.route_id || "").trim())
          .filter(Boolean),
      ),
    );
  }

  return { routeCollections, routeIdsByCity };
}

function inferCityFromRouteId(routeId, routeIdsByCity) {
  const matches = [];
  for (const [city, routeIds] of routeIdsByCity.entries()) {
    if (routeIds.has(String(routeId))) {
      matches.push(city);
    }
  }

  if (matches.length === 1) return matches[0];
  return null;
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) {
    return haversineDistance(py, px, y1, x1);
  }
  const t = Math.max(
    0,
    Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)),
  );
  const nearestX = x1 + t * dx;
  const nearestY = y1 + t * dy;
  return haversineDistance(py, px, nearestY, nearestX);
}

function getFeatureLineLength(feature) {
  const geometry = feature?.geometry;
  if (!geometry) return 0;
  const lineStrings =
    geometry.type === "MultiLineString"
      ? geometry.coordinates
      : [geometry.coordinates];
  let total = 0;
  for (const coords of lineStrings) {
    for (let i = 0; i < coords.length - 1; i += 1) {
      const [x1, y1] = coords[i];
      const [x2, y2] = coords[i + 1];
      total += haversineDistance(y1, x1, y2, x2);
    }
  }
  return total;
}

function getLineStringLength(coordinates) {
  let total = 0;
  for (let i = 0; i < coordinates.length - 1; i += 1) {
    const [x1, y1] = coordinates[i];
    const [x2, y2] = coordinates[i + 1];
    total += haversineDistance(y1, x1, y2, x2);
  }
  return total;
}

function getEndpointAlignmentScore(coordinates, referenceCoordinates) {
  const start = coordinates[0];
  const end = coordinates[coordinates.length - 1];
  const refStart = referenceCoordinates[0];
  const refEnd = referenceCoordinates[referenceCoordinates.length - 1];

  if (!start || !end || !refStart || !refEnd) {
    return {
      sameDirection: Number.POSITIVE_INFINITY,
      reverseDirection: Number.POSITIVE_INFINITY,
    };
  }

  return {
    sameDirection:
      haversineDistance(start[1], start[0], refStart[1], refStart[0]) +
      haversineDistance(end[1], end[0], refEnd[1], refEnd[0]),
    reverseDirection:
      haversineDistance(start[1], start[0], refEnd[1], refEnd[0]) +
      haversineDistance(end[1], end[0], refStart[1], refStart[0]),
  };
}

function pickLongestRouteFeature(features) {
  if (features.length <= 1) return features;
  let longest = features[0];
  let maxLen = getFeatureLineLength(longest);
  for (let i = 1; i < features.length; i += 1) {
    const len = getFeatureLineLength(features[i]);
    if (len > maxLen) {
      maxLen = len;
      longest = features[i];
    }
  }
  return [longest];
}

function findNearestPointOnLine(lat, lon, coordinates) {
  let minDistance = Infinity;
  let distanceAlong = 0;
  let bestDistanceAlong = 0;
  let totalLength = 0;

  for (let i = 0; i < coordinates.length - 1; i += 1) {
    const [x1, y1] = coordinates[i];
    const [x2, y2] = coordinates[i + 1];
    const segmentLength = haversineDistance(y1, x1, y2, x2);

    const dist = distanceToSegment(lon, lat, x1, y1, x2, y2);
    if (dist < minDistance) {
      minDistance = dist;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const t =
        dx === 0 && dy === 0
          ? 0
          : Math.max(
              0,
              Math.min(
                1,
                ((lon - x1) * dx + (lat - y1) * dy) / (dx * dx + dy * dy),
              ),
            );
      bestDistanceAlong = distanceAlong + t * segmentLength;
    }

    distanceAlong += segmentLength;
  }

  for (let i = 0; i < coordinates.length - 1; i += 1) {
    const [x1, y1] = coordinates[i];
    const [x2, y2] = coordinates[i + 1];
    totalLength += haversineDistance(y1, x1, y2, x2);
  }

  return {
    distance: minDistance,
    distanceAlong: bestDistanceAlong,
    totalLength,
  };
}

function normalizeDistanceAlongReference(
  distanceAlong,
  lineTotalLength,
  coordinates,
  referenceCoordinates,
  useOverlapAnchors = false,
) {
  if (
    coordinates.length < 2 ||
    referenceCoordinates.length < 2 ||
    lineTotalLength <= 0
  ) {
    return distanceAlong;
  }

  const referenceLength = getLineStringLength(referenceCoordinates);
  if (referenceLength <= 0) {
    return distanceAlong;
  }

  const { sameDirection, reverseDirection } = getEndpointAlignmentScore(
    coordinates,
    referenceCoordinates,
  );

  let lineAnchorStart = 0;
  let lineAnchorEnd = lineTotalLength;
  let referenceAnchorStart = 0;
  let referenceAnchorEnd = referenceLength;

  if (useOverlapAnchors) {
    const lineStart = coordinates[0];
    const lineEnd = coordinates[coordinates.length - 1];
    const refStart = referenceCoordinates[0];
    const refEnd = referenceCoordinates[referenceCoordinates.length - 1];

    const lineStartOnReference =
      lineStart && findNearestPointOnLine(lineStart[1], lineStart[0], referenceCoordinates);
    const lineEndOnReference =
      lineEnd && findNearestPointOnLine(lineEnd[1], lineEnd[0], referenceCoordinates);
    const refStartOnLine =
      refStart && findNearestPointOnLine(refStart[1], refStart[0], coordinates);
    const refEndOnLine =
      refEnd && findNearestPointOnLine(refEnd[1], refEnd[0], coordinates);

    if (
      lineStartOnReference &&
      lineEndOnReference &&
      refStartOnLine &&
      refEndOnLine
    ) {
      lineAnchorStart = Math.min(
        refStartOnLine.distanceAlong,
        refEndOnLine.distanceAlong,
      );
      lineAnchorEnd = Math.max(
        refStartOnLine.distanceAlong,
        refEndOnLine.distanceAlong,
      );
      referenceAnchorStart = Math.min(
        lineStartOnReference.distanceAlong,
        lineEndOnReference.distanceAlong,
      );
      referenceAnchorEnd = Math.max(
        lineStartOnReference.distanceAlong,
        lineEndOnReference.distanceAlong,
      );
    }
  }

  const anchorLineLength = Math.max(1, lineAnchorEnd - lineAnchorStart);
  const anchorReferenceLength = Math.max(
    1,
    referenceAnchorEnd - referenceAnchorStart,
  );
  const clampedDistanceAlong = Math.max(
    lineAnchorStart,
    Math.min(lineAnchorEnd, distanceAlong),
  );
  const distanceWithinAnchor = clampedDistanceAlong - lineAnchorStart;
  const lengthRatio = anchorReferenceLength / anchorLineLength;
  const scaledDistance = Math.max(
    referenceAnchorStart,
    Math.min(
      referenceAnchorEnd,
      referenceAnchorStart + distanceWithinAnchor * lengthRatio,
    ),
  );

  if (reverseDirection < sameDirection) {
    return Math.max(
      referenceAnchorStart,
      referenceAnchorEnd - (scaledDistance - referenceAnchorStart),
    );
  }

  return scaledDistance;
}

function shouldUseParallelTrackMerge(city, routeId) {
  if (!CITIES_WITH_PARALLEL_TRACKS.has(city)) return false;
  if (city === "SF" && routeId === "F") return false;
  return true;
}

function shouldUsePairedArcMerge(city, routeId) {
  return city === "SF" && routeId === "F";
}

function buildRouteFeatureMap(routes) {
  const map = new Map();
  for (const feature of routes.features || []) {
    const routeId = feature.properties?.route_id;
    if (!routeId) continue;
    if (!map.has(routeId)) {
      map.set(routeId, []);
    }
    map.get(routeId).push(feature);
  }
  return map;
}

function findSegmentsForVehicle(lat, lon, routeId, routeFeatureMap, city) {
  const directRouteFeatures = routeFeatureMap.get(routeId) || [];
  const candidateRouteEntries =
    directRouteFeatures.length > 0
      ? [[routeId, directRouteFeatures]]
      : Array.from(routeFeatureMap.entries());

  let bestSegmentIndex200 = null;
  let bestSegmentIndex500 = null;
  let bestSegmentIndex1000 = null;
  let bestSegmentRouteId = null;
  let minDistance = Infinity;

  for (const [candidateRouteId, routeFeatures] of candidateRouteEntries) {
    let cumulativeOffset200 = 0;
    let cumulativeOffset500 = 0;
    let cumulativeOffset1000 = 0;

    const usesParallelMerge = shouldUseParallelTrackMerge(city, candidateRouteId);
    const usesPairedArcMerge = shouldUsePairedArcMerge(city, candidateRouteId);
    const featuresToProcess = usesParallelMerge
      ? pickLongestRouteFeature(routeFeatures)
      : routeFeatures;
    const usesSharedSegmentSpace = usesParallelMerge || usesPairedArcMerge;
    const referenceLineCoords = usesSharedSegmentSpace
      ? routeFeatures
          .flatMap((feature) =>
            feature.geometry.type === "MultiLineString"
              ? feature.geometry.coordinates
              : [feature.geometry.coordinates],
          )
          .reduce((longest, current) => {
            if (!longest) return current;
            return getLineStringLength(current) > getLineStringLength(longest)
              ? current
              : longest;
          }, null)
      : null;

    for (const feature of featuresToProcess) {
      const geometry = feature.geometry;
      const lineStrings =
        geometry.type === "MultiLineString"
          ? geometry.coordinates
          : [geometry.coordinates];

      for (const coordinates of lineStrings) {
        const result = findNearestPointOnLine(lat, lon, coordinates);
        const distanceAlong = referenceLineCoords
          ? normalizeDistanceAlongReference(
              result.distanceAlong,
              result.totalLength,
              coordinates,
              referenceLineCoords,
              usesPairedArcMerge,
            )
          : result.distanceAlong;

        if (
          result.distance < minDistance &&
          result.distance <= MAX_DISTANCE_FROM_ROUTE_METERS
        ) {
          minDistance = result.distance;
          bestSegmentIndex200 =
            (referenceLineCoords ? 0 : cumulativeOffset200) +
            Math.floor(distanceAlong / SEGMENT_SIZE_METERS);
          bestSegmentIndex500 =
            (referenceLineCoords ? 0 : cumulativeOffset500) +
            Math.floor(distanceAlong / SEGMENT_SIZE_500_METERS);
          bestSegmentIndex1000 =
            (referenceLineCoords ? 0 : cumulativeOffset1000) +
            Math.floor(distanceAlong / SEGMENT_SIZE_1000_METERS);
          bestSegmentRouteId = candidateRouteId;
        }

        const lineLength = result.totalLength;
        if (!referenceLineCoords) {
          cumulativeOffset200 += Math.floor(lineLength / SEGMENT_SIZE_METERS) + 1;
          cumulativeOffset500 +=
            Math.floor(lineLength / SEGMENT_SIZE_500_METERS) + 1;
          cumulativeOffset1000 +=
            Math.floor(lineLength / SEGMENT_SIZE_1000_METERS) + 1;
        }
      }
    }
  }

  if (bestSegmentRouteId && minDistance <= MAX_DISTANCE_FROM_ROUTE_METERS) {
    return {
      segmentId:
        bestSegmentIndex200 !== null
          ? `${bestSegmentRouteId}_${bestSegmentIndex200}`
          : null,
      segmentId500:
        bestSegmentIndex500 !== null
          ? `${bestSegmentRouteId}_${bestSegmentIndex500}`
          : null,
      segmentId1000:
        bestSegmentIndex1000 !== null
          ? `${bestSegmentRouteId}_${bestSegmentIndex1000}`
          : null,
      onRoute: true,
    };
  }

  return {
    segmentId: null,
    segmentId500: null,
    segmentId1000: null,
    onRoute: false,
  };
}

async function fetchBatch(batchSize, targetCity, targetRoute, force, blockedIds, lastProcessedId) {
  let query = supabase
    .from("vehicle_positions")
    .select(
      "id,city,route_id,lat,lon,segment_id,segment_id_200,segment_id_500,segment_id_1000,on_route,mapping_version",
    );

  if (!force) {
    query = query.or(
      [
        "mapping_version.is.null",
        `mapping_version.neq.${SEGMENT_MAPPING_VERSION}`,
        "segment_id_200.is.null",
        "segment_id_500.is.null",
        "segment_id_1000.is.null",
        "on_route.is.null",
      ].join(","),
    );
  }

  // When force-reprocessing, paginate by id to avoid re-fetching updated rows
  if (lastProcessedId > 0) {
    query = query.gt("id", lastProcessedId);
  }

  query = query.order("id", { ascending: true }).limit(batchSize);

  if (targetCity) {
    query = query.eq("city", targetCity);
  }
  if (targetRoute) {
    query = query.eq("route_id", targetRoute);
  }
  if (blockedIds.size > 0) {
    query = query.not("id", "in", `(${Array.from(blockedIds).join(",")})`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function updateBatch(rows) {
  for (const row of rows) {
    const { error } = await supabase
      .from("vehicle_positions")
      .update({
        segment_id: row.segment_id,
        segment_id_200: row.segment_id_200,
        segment_id_500: row.segment_id_500,
        segment_id_1000: row.segment_id_1000,
        on_route: row.on_route,
        mapping_version: row.mapping_version,
        mapped_at: row.mapped_at,
      })
      .eq("id", row.id);

    if (error) throw error;
  }
}

async function main() {
  const { city: targetCity, route: targetRoute, force, batchSize } = parseArgs();
  const { routeCollections, routeIdsByCity } = await loadRouteCollections();
  const routeFeatureMaps = new Map(
    Array.from(routeCollections.entries()).map(([city, routes]) => [
      city,
      buildRouteFeatureMap(routes),
    ]),
  );

  if (targetRoute) {
    console.log(`Filtering to route_id=${targetRoute}${force ? " (force reprocess)" : ""}`);
  }

  let totalProcessed = 0;
  let totalChanged = 0;
  let totalUnchanged = 0;
  let totalSkipped = 0;
  let lastProcessedId = 0;
  const blockedIds = new Set();

  while (true) {
    const batch = await fetchBatch(batchSize, targetCity, targetRoute, force, blockedIds, lastProcessedId);
    if (batch.length === 0) break;

    const changed = [];
    let batchUnchanged = 0;

    for (const row of batch) {
      totalProcessed += 1;
      const resolvedCity =
        row.city || inferCityFromRouteId(row.route_id, routeIdsByCity);

      if (!resolvedCity || !routeFeatureMaps.has(resolvedCity)) {
        totalSkipped += 1;
        blockedIds.add(row.id);
        continue;
      }

      const segments = findSegmentsForVehicle(
        row.lat,
        row.lon,
        row.route_id,
        routeFeatureMaps.get(resolvedCity),
        resolvedCity,
      );

      const newSegmentId200 = segments.segmentId ?? "";
      const newSegmentId500 = segments.segmentId500 ?? "";
      const newSegmentId1000 = segments.segmentId1000 ?? "";

      const alreadyCorrect =
        row.segment_id_200 === newSegmentId200 &&
        row.segment_id_500 === newSegmentId500 &&
        row.segment_id_1000 === newSegmentId1000 &&
        row.on_route === segments.onRoute &&
        row.mapping_version === SEGMENT_MAPPING_VERSION;

      if (alreadyCorrect) {
        batchUnchanged += 1;
        totalUnchanged += 1;
        continue;
      }

      changed.push({
        id: row.id,
        segment_id: newSegmentId200,
        segment_id_200: newSegmentId200,
        segment_id_500: newSegmentId500,
        segment_id_1000: newSegmentId1000,
        on_route: segments.onRoute,
        mapping_version: SEGMENT_MAPPING_VERSION,
        mapped_at: new Date().toISOString(),
      });
    }

    if (changed.length > 0) {
      await updateBatch(changed);
      totalChanged += changed.length;
    }

    // Track highest id to paginate forward on force-reprocess
    const maxId = Math.max(...batch.map((row) => row.id));
    if (maxId > lastProcessedId) lastProcessedId = maxId;

    console.log(
      `Processed ${totalProcessed} rows (${totalChanged} changed, ${totalUnchanged} unchanged, ${totalSkipped} skipped)`,
    );
  }

  console.log("✅ Segment mapping backfill complete.");
  console.log(
    `Rows processed: ${totalProcessed}, changed: ${totalChanged}, unchanged: ${totalUnchanged}, skipped: ${totalSkipped}`,
  );
  if (blockedIds.size > 0) {
    console.log(
      `Skipped row ids (unsupported or ambiguous city): ${Array.from(blockedIds).slice(0, 20).join(", ")}${blockedIds.size > 20 ? "..." : ""}`,
    );
  }
}

main().catch((error) => {
  console.error("❌ Segment mapping backfill failed:", error);
  process.exit(1);
});
