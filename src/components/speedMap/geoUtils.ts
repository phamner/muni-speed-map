import type { CityStaticData } from "../../data/cityDataLoaders";

export const MAX_DISTANCE_FROM_ROUTE_METERS = 100;

export function debounce<T extends (...args: any[]) => void>(
  fn: T,
  delay: number,
): T & { cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const debounced = (...args: Parameters<T>) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
  debounced.cancel = () => {
    if (timeoutId) clearTimeout(timeoutId);
  };
  return debounced as T & { cancel: () => void };
}

export function waitForNoLongTasks(
  quietPeriodMs: number = 2000,
): Promise<void> {
  return new Promise((resolve) => {
    let lastLongTaskTime = performance.now();
    let resolved = false;

    const observer = new PerformanceObserver((list) => {
      for (const _entry of list.getEntries()) {
        lastLongTaskTime = performance.now();
      }
    });

    try {
      observer.observe({ entryTypes: ["longtask"] });
    } catch {
      resolve();
      return;
    }

    const checkQuiet = () => {
      if (resolved) return;

      const quietTime = performance.now() - lastLongTaskTime;
      if (quietTime >= quietPeriodMs) {
        resolved = true;
        observer.disconnect();
        resolve();
      } else {
        setTimeout(checkQuiet, 500);
      }
    };

    setTimeout(checkQuiet, quietPeriodMs);
  });
}

export const EMPTY_CITY_DATA: CityStaticData = {
  routes: { type: "FeatureCollection", features: [] },
  stops: { type: "FeatureCollection", features: [] },
  crossings: { type: "FeatureCollection", features: [] },
  switches: { type: "FeatureCollection", features: [] },
  maxspeed: null,
  tunnelsBridges: null,
  separation: null,
  trafficLights: null,
  railContextHeavy: null,
  railContextCommuter: null,
  busRoutesOverlay: null,
  ferryRoutesOverlay: null,
};

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
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

export function distanceToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
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

export function distanceToLineString(
  lat: number,
  lon: number,
  coordinates: number[][],
): number {
  let minDistance = Infinity;

  for (let i = 0; i < coordinates.length - 1; i++) {
    const [x1, y1] = coordinates[i];
    const [x2, y2] = coordinates[i + 1];
    const dist = distanceToSegment(lon, lat, x1, y1, x2, y2);
    if (dist < minDistance) {
      minDistance = dist;
    }
  }

  return minDistance;
}
