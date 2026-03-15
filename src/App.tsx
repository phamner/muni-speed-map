import { useState, useEffect, useRef } from "react";
import { SpeedMap } from "./components/SpeedMap";
import { Controls } from "./components/Controls";
import { CITIES, getLinesForCity } from "./types";
import type { City } from "./types";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import "./App.css";

export interface SpeedFilter {
  minSpeed: number;
  maxSpeed: number;
  showNoData: boolean;
}

export type ViewMode = "raw" | "segments" | "segments-500" | "live";

export type RouteLineMode = "byLine" | "bySpeedLimit" | "bySeparation";

export type SpeedUnit = "mph" | "kmh";

export interface LineStats {
  line: string;
  avgSpeed: number;
  medianSpeed: number;
  count: number;
}

// Check if dev mode is enabled via query param (excludes from analytics)
const useIsDev = () => {
  if (typeof window === "undefined") return false;
  return window.location.search.includes("dev=true");
};

function getCityFromUrl(): City {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("city");
  if (raw && (CITIES as readonly string[]).includes(raw)) return raw as City;
  return "SF";
}

function App() {
  const isDev = useIsDev();

  // Mobile sidebar state
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const [city, setCity] = useState<City>(getCityFromUrl);

  // Sync city to URL so links are shareable
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("city", city);
    window.history.replaceState({}, "", `?${params.toString()}`);
  }, [city]);

  // Lines selected for the current city
  const [selectedLines, setSelectedLines] = useState<string[]>(() => {
    const c = getCityFromUrl();
    const lines = getLinesForCity(c);
    if (c === "SF") return lines.filter((l) => l !== "F") as string[];
    return [...lines] as string[];
  });

  // Track if "none" was selected to preserve across city switches
  const noneSelectedRef = useRef(false);
  // Keep ref in sync with selectedLines (synchronously via render, not effect)
  noneSelectedRef.current = selectedLines.length === 0;

  const [vehicleCount, setVehicleCount] = useState(0);
  const [speedFilter, setSpeedFilter] = useState<SpeedFilter>({
    minSpeed: 0,
    maxSpeed: 50,
    showNoData: true,
  });
  const [showRouteLines, setShowRouteLines] = useState(true);
  const [routeLineMode, setRouteLineMode] = useState<RouteLineMode>("byLine");
  const [showStops, setShowStops] = useState(false);
  const [showCrossings, setShowCrossings] = useState(false);
  const [showTrafficLights, setShowTrafficLights] = useState(false);
  const [showSwitches, setShowSwitches] = useState(false);
  const [showRailContextHeavy, setShowRailContextHeavy] = useState(false);
  const [showRailContextCommuter, setShowRailContextCommuter] = useState(false);
  const [showBusRoutesOverlay, setShowBusRoutesOverlay] = useState(false);
  const [railContextHeavyCount, setRailContextHeavyCount] = useState(0);
  const [railContextCommuterCount, setRailContextCommuterCount] = useState(0);
  const [busRoutesOverlayCount, setBusRoutesOverlayCount] = useState(0);
  const [hideStoppedTrains, setHideStoppedTrains] = useState(false);
  const [hideAllTrains, setHideAllTrains] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("segments-500");
  const [lineStats, setLineStats] = useState<LineStats[]>([]);
  const [showSatellite, setShowSatellite] = useState(false);
  const [showPopulationDensity, setShowPopulationDensity] = useState(false);
  const [speedUnit, setSpeedUnit] = useState<SpeedUnit>("mph");

  // Reset state when city changes
  useEffect(() => {
    const lines = getLinesForCity(city);
    // Preserve "none" selection across city switches
    if (noneSelectedRef.current) {
      // User had "none" selected, keep it that way
      setSelectedLines([]);
    } else if (city === "SF") {
      // For SF, exclude F by default
      setSelectedLines(lines.filter((line) => line !== "F") as string[]);
    } else {
      // For other cities, select all
      setSelectedLines([...lines] as string[]);
    }
    // Reset stats and counts when changing city (data is different)
    setLineStats([]);
    setVehicleCount(0);
    setRailContextHeavyCount(0);
    setRailContextCommuterCount(0);
    setBusRoutesOverlayCount(0);
    // If switching away from live mode, default to raw
    if (viewMode === "live") {
      setViewMode("raw");
    }
    // Note: showStops, showCrossings, showRouteLines, speedFilter, viewMode,
    // and hideStoppedTrains are intentionally preserved across city switches
  }, [city]);

  return (
    <div className="app">
      {/* Mobile menu toggle button */}
      <button
        className="mobile-menu-toggle"
        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
        aria-label={isSidebarOpen ? "Close menu" : "Open menu"}
      >
        {isSidebarOpen ? "✕" : "☰"}
      </button>

      {/* Mobile overlay when sidebar is open */}
      {isSidebarOpen && (
        <div
          className="mobile-overlay"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <Controls
        city={city}
        setCity={setCity}
        selectedLines={selectedLines}
        setSelectedLines={setSelectedLines}
        vehicleCount={vehicleCount}
        speedFilter={speedFilter}
        setSpeedFilter={setSpeedFilter}
        showRouteLines={showRouteLines}
        setShowRouteLines={setShowRouteLines}
        routeLineMode={routeLineMode}
        setRouteLineMode={setRouteLineMode}
        showStops={showStops}
        setShowStops={setShowStops}
        showCrossings={showCrossings}
        setShowCrossings={setShowCrossings}
        showTrafficLights={showTrafficLights}
        setShowTrafficLights={setShowTrafficLights}
        showSwitches={showSwitches}
        setShowSwitches={setShowSwitches}
        showRailContextHeavy={showRailContextHeavy}
        setShowRailContextHeavy={setShowRailContextHeavy}
        showRailContextCommuter={showRailContextCommuter}
        setShowRailContextCommuter={setShowRailContextCommuter}
        showBusRoutesOverlay={showBusRoutesOverlay}
        setShowBusRoutesOverlay={setShowBusRoutesOverlay}
        railContextHeavyCount={railContextHeavyCount}
        railContextCommuterCount={railContextCommuterCount}
        busRoutesOverlayCount={busRoutesOverlayCount}
        hideStoppedTrains={hideStoppedTrains}
        setHideStoppedTrains={setHideStoppedTrains}
        hideAllTrains={hideAllTrains}
        setHideAllTrains={setHideAllTrains}
        viewMode={viewMode}
        setViewMode={setViewMode}
        lineStats={lineStats}
        speedUnit={speedUnit}
        setSpeedUnit={setSpeedUnit}
        isSidebarOpen={isSidebarOpen}
        onResetPopulationDensity={() => setShowPopulationDensity(false)}
      />
      <SpeedMap
        key={city}
        city={city}
        selectedLines={selectedLines}
        speedFilter={speedFilter}
        showRouteLines={showRouteLines}
        routeLineMode={routeLineMode}
        showStops={showStops}
        showCrossings={showCrossings}
        showTrafficLights={showTrafficLights}
        showSwitches={showSwitches}
        showRailContextHeavy={showRailContextHeavy}
        showRailContextCommuter={showRailContextCommuter}
        showBusRoutesOverlay={showBusRoutesOverlay}
        hideStoppedTrains={hideStoppedTrains}
        hideAllTrains={hideAllTrains}
        viewMode={viewMode}
        showSatellite={showSatellite}
        onSatelliteToggle={setShowSatellite}
        showPopulationDensity={showPopulationDensity}
        onPopulationDensityToggle={setShowPopulationDensity}
        speedUnit={speedUnit}
        onRailContextUpdate={(heavyCount, commuterCount, busCount) => {
          setRailContextHeavyCount(heavyCount);
          setRailContextCommuterCount(commuterCount);
          setBusRoutesOverlayCount(busCount ?? 0);
        }}
        onVehicleUpdate={(count, _time, stats) => {
          setVehicleCount(count);
          if (stats) setLineStats(stats);
        }}
      />

      {!isDev && <Analytics />}
      {!isDev && <SpeedInsights />}
    </div>
  );
}

export default App;
