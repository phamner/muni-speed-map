import {
  distanceToLineString,
  MAX_DISTANCE_FROM_ROUTE_METERS,
  getMaxDistanceForRoute,
} from "./geoUtils";

export function buildRouteGeometryMap(routes: any): Map<string, number[][][]> {
  const routeMap = new Map<string, number[][][]>();

  routes.features.forEach((feature: any) => {
    const routeId = feature.properties.route_id;
    const geomType = feature.geometry.type;
    const coordinates = feature.geometry.coordinates;

    if (!routeMap.has(routeId)) {
      routeMap.set(routeId, []);
    }

    if (geomType === "MultiLineString") {
      for (const lineCoords of coordinates) {
        routeMap.get(routeId)!.push(lineCoords);
      }
    } else {
      routeMap.get(routeId)!.push(coordinates);
    }
  });

  return routeMap;
}

export function isOnRoute(
  lat: number,
  lon: number,
  routeId: string,
  routeGeometryMap: Map<string, number[][][]>,
  city?: string,
): boolean {
  if (city === "Salt Lake City" || city === "Pittsburgh") {
    return true;
  }

  const routeLines = routeGeometryMap.get(routeId);
  if (!routeLines) {
    return true;
  }

  const maxDist = getMaxDistanceForRoute(routeId);
  for (const lineCoords of routeLines) {
    const distance = distanceToLineString(lat, lon, lineCoords);
    if (distance <= maxDist) {
      return true;
    }
  }

  if (!routeGeometryMap.has(routeId)) {
    return true;
  }

  return false;
}

export function shouldShowRoute(
  routeId: string,
  selectedLines: string[],
  city: string,
): boolean {
  if (selectedLines.includes(routeId)) {
    return true;
  }

  if (
    city === "Denver" &&
    selectedLines.length > 0 &&
    (routeId === "default" || /^\d+$/.test(routeId))
  ) {
    return true;
  }

  return false;
}
