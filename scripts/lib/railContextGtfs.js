/**
 * GTFS rail-context extraction utilities.
 *
 * Builds static passenger rail context overlays from GTFS static tables:
 * routes.txt, trips.txt, shapes.txt, agency.txt
 */

function parseCsvRow(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (ch === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += ch;
  }

  values.push(current);
  return values;
}

export function parseCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);

  if (!lines.length) return [];

  const header = parseCsvRow(lines[0]).map((h) =>
    String(h || "").replace(/^\uFEFF/, ""),
  );
  return lines.slice(1).map((line) => {
    const cells = parseCsvRow(line);
    const row = {};
    for (let i = 0; i < header.length; i += 1) {
      row[header[i]] = cells[i] ?? "";
    }
    return row;
  });
}

export function classifyServiceClass(routeTypeRaw, options = {}) {
  const heavyTypes = new Set(
    (options.heavyRouteTypes || ["1"]).map((v) => String(v).trim()),
  );
  const commuterTypes = new Set(
    (options.commuterRouteTypes || ["2"]).map((v) => String(v).trim()),
  );

  const routeType = String(routeTypeRaw ?? "").trim();
  if (heavyTypes.has(routeType)) return "heavy";
  if (commuterTypes.has(routeType)) return "commuter";
  return null;
}

function simplifyLineByPointLimit(coords, maxPoints = 200) {
  if (!Array.isArray(coords) || coords.length <= maxPoints) return coords;
  if (maxPoints < 3) return [coords[0], coords[coords.length - 1]];

  const out = [coords[0]];
  const stride = (coords.length - 1) / (maxPoints - 1);
  for (let i = 1; i < maxPoints - 1; i += 1) {
    out.push(coords[Math.round(i * stride)]);
  }
  out.push(coords[coords.length - 1]);
  return out;
}

function buildShapeMap(shapeRows, simplifyMaxPoints) {
  const byShapeId = new Map();

  for (const row of shapeRows) {
    const shapeId = String(row.shape_id || "").trim();
    if (!shapeId) continue;

    const lat = Number(row.shape_pt_lat);
    const lon = Number(row.shape_pt_lon);
    const seq = Number(row.shape_pt_sequence);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    if (!byShapeId.has(shapeId)) byShapeId.set(shapeId, []);
    byShapeId.get(shapeId).push({ lat, lon, seq: Number.isFinite(seq) ? seq : 0 });
  }

  const shapeCoords = new Map();
  for (const [shapeId, pts] of byShapeId.entries()) {
    pts.sort((a, b) => a.seq - b.seq);
    const coords = pts.map((p) => [p.lon, p.lat]);
    if (coords.length < 2) continue;
    shapeCoords.set(shapeId, simplifyLineByPointLimit(coords, simplifyMaxPoints));
  }

  return shapeCoords;
}

function routeDisplayName(route) {
  const shortName = String(route.route_short_name || "").trim();
  const longName = String(route.route_long_name || "").trim();
  if (shortName && longName) return `${shortName} ${longName}`;
  return shortName || longName || String(route.route_id || "").trim();
}

export function extractRailContextFromGtfsTables(
  { routes, trips, shapes, agency },
  options = {},
) {
  const simplifyMaxPoints = options.simplifyMaxPoints || 200;
  const dissolveByRoute = options.dissolveByRoute ?? true;
  const defaultAgencyName = String(
    agency?.[0]?.agency_name || options.defaultAgencyName || "Unknown agency",
  ).trim();

  const includeRouteIds = new Set(
    (options.includeRouteIds || []).map((v) => String(v).trim()),
  );
  const includeRouteShortNames = new Set(
    (options.includeRouteShortNames || []).map((v) => String(v).trim()),
  );
  const includeRouteLongNames = new Set(
    (options.includeRouteLongNames || []).map((v) => String(v).trim()),
  );
  const hasRouteFilter =
    includeRouteIds.size > 0 ||
    includeRouteShortNames.size > 0 ||
    includeRouteLongNames.size > 0;

  const routeMeta = new Map();
  for (const route of routes || []) {
    const routeId = String(route.route_id || "").trim();
    if (!routeId) continue;
    const routeShortName = String(route.route_short_name || "").trim();
    const routeLongName = String(route.route_long_name || "").trim();
    if (
      hasRouteFilter &&
      !includeRouteIds.has(routeId) &&
      !includeRouteShortNames.has(routeShortName) &&
      !includeRouteLongNames.has(routeLongName)
    ) {
      continue;
    }
    const serviceClass = classifyServiceClass(route.route_type, options);
    if (!serviceClass) continue;
    routeMeta.set(routeId, {
      route_id: routeId,
      route_short_name: routeShortName || null,
      route_long_name: routeLongName || null,
      agency_name: defaultAgencyName,
      service_class: serviceClass,
    });
  }

  const shapeCoords = buildShapeMap(shapes || [], simplifyMaxPoints);
  const routeToShapeIds = new Map();

  for (const trip of trips || []) {
    const routeId = String(trip.route_id || "").trim();
    const shapeId = String(trip.shape_id || "").trim();
    if (!routeMeta.has(routeId) || !shapeId) continue;
    if (!shapeCoords.has(shapeId)) continue;
    if (!routeToShapeIds.has(routeId)) routeToShapeIds.set(routeId, new Set());
    routeToShapeIds.get(routeId).add(shapeId);
  }

  // Optional fallback for feeds where trips.txt omits shape_id
  // (e.g., some Metrolink static exports). Match by configured shape_id prefixes.
  const routeShapePrefixes = options.routeShapePrefixes || {};
  if (routeShapePrefixes && Object.keys(routeShapePrefixes).length > 0) {
    for (const [routeId, prefixesRaw] of Object.entries(routeShapePrefixes)) {
      if (!routeMeta.has(routeId)) continue;
      const prefixes = Array.isArray(prefixesRaw)
        ? prefixesRaw.map((p) => String(p))
        : [String(prefixesRaw)];
      if (!prefixes.length) continue;

      if (!routeToShapeIds.has(routeId)) routeToShapeIds.set(routeId, new Set());
      const shapeSet = routeToShapeIds.get(routeId);
      if (shapeSet.size > 0) continue;

      for (const shapeId of shapeCoords.keys()) {
        if (prefixes.some((prefix) => shapeId.startsWith(prefix))) {
          shapeSet.add(shapeId);
        }
      }
    }
  }

  const heavyFeatures = [];
  const commuterFeatures = [];
  const globalSeen = new Set();

  for (const [routeId, shapeIds] of routeToShapeIds.entries()) {
    const meta = routeMeta.get(routeId);
    if (!meta) continue;

    const uniqueLines = [];
    const localSeen = new Set();

    for (const shapeId of shapeIds) {
      const coords = shapeCoords.get(shapeId);
      if (!coords || coords.length < 2) continue;
      const lineSignature = coords.map(([lon, lat]) => `${lon},${lat}`).join("|");
      const signature = `${meta.service_class}|${routeId}|${lineSignature}`;
      if (globalSeen.has(signature) || localSeen.has(lineSignature)) continue;
      globalSeen.add(signature);
      localSeen.add(lineSignature);
      uniqueLines.push(coords);
    }

    if (!uniqueLines.length) continue;

    if (dissolveByRoute) {
      const geometry =
        uniqueLines.length === 1
          ? { type: "LineString", coordinates: uniqueLines[0] }
          : { type: "MultiLineString", coordinates: uniqueLines };
      const feature = {
        type: "Feature",
        properties: {
          ...meta,
          route_name: routeDisplayName(meta),
        },
        geometry,
      };
      if (meta.service_class === "heavy") heavyFeatures.push(feature);
      else commuterFeatures.push(feature);
      continue;
    }

    for (const line of uniqueLines) {
      const feature = {
        type: "Feature",
        properties: {
          ...meta,
          route_name: routeDisplayName(meta),
        },
        geometry: {
          type: "LineString",
          coordinates: line,
        },
      };
      if (meta.service_class === "heavy") heavyFeatures.push(feature);
      else commuterFeatures.push(feature);
    }
  }

  return {
    heavy: { type: "FeatureCollection", features: heavyFeatures },
    commuter: { type: "FeatureCollection", features: commuterFeatures },
  };
}
