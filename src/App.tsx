import { useState, useEffect, useRef } from "react";
import { SpeedMap } from "./components/SpeedMap";
import { Controls } from "./components/Controls";
import { MUNI_LINES, getLinesForCity } from "./types";
import type { City } from "./types";
import "./App.css";

export interface SpeedFilter {
  minSpeed: number;
  maxSpeed: number;
  showNoData: boolean;
}

export type ViewMode = "raw" | "segments" | "live";

export type RouteLineMode = "byLine" | "bySpeedLimit" | "bySeparation";

export type SpeedUnit = "mph" | "kmh";

export interface LineStats {
  line: string;
  avgSpeed: number;
  medianSpeed: number;
  count: number;
}

function App() {
  // City selector - SF or LA
  const [city, setCity] = useState<City>("SF");

  // Lines selected for the current city
  const [selectedLines, setSelectedLines] = useState<string[]>(
    MUNI_LINES.filter((line) => line !== "F") as string[],
  );

  // Track if "none" was selected to preserve across city switches
  const noneSelectedRef = useRef(false);
  // Keep ref in sync with selectedLines (synchronously via render, not effect)
  noneSelectedRef.current = selectedLines.length === 0;

  const [vehicleCount, setVehicleCount] = useState(0);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [dataAgeMinutes, setDataAgeMinutes] = useState<number | null>(null);
  const [speedFilter, setSpeedFilter] = useState<SpeedFilter>({
    minSpeed: 0,
    maxSpeed: 50,
    showNoData: true,
  });
  const [showRouteLines, setShowRouteLines] = useState(true);
  const [routeLineMode, setRouteLineMode] = useState<RouteLineMode>("byLine");
  const [showStops, setShowStops] = useState(false);
  const [showCrossings, setShowCrossings] = useState(false);
  const [showSwitches, setShowSwitches] = useState(false);
  const [showRailContextHeavy, setShowRailContextHeavy] = useState(false);
  const [showRailContextCommuter, setShowRailContextCommuter] =
    useState(false);
  const [railContextHeavyCount, setRailContextHeavyCount] = useState(0);
  const [railContextCommuterCount, setRailContextCommuterCount] = useState(0);
  const [hideStoppedTrains, setHideStoppedTrains] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("raw");
  const [lineStats, setLineStats] = useState<LineStats[]>([]);
  const [showSatellite, setShowSatellite] = useState(false);
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
    setLastUpdate(null);
    setDataAgeMinutes(null);
    setRailContextHeavyCount(0);
    setRailContextCommuterCount(0);
    // If switching away from live mode, default to raw
    if (viewMode === "live") {
      setViewMode("raw");
    }
    // Note: showStops, showCrossings, showRouteLines, speedFilter, viewMode,
    // and hideStoppedTrains are intentionally preserved across city switches
  }, [city]);

  return (
    <div className="app">
      <Controls
        city={city}
        setCity={setCity}
        selectedLines={selectedLines}
        setSelectedLines={setSelectedLines}
        vehicleCount={vehicleCount}
        lastUpdate={lastUpdate}
        dataAgeMinutes={dataAgeMinutes}
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
        showSwitches={showSwitches}
        setShowSwitches={setShowSwitches}
        showRailContextHeavy={showRailContextHeavy}
        setShowRailContextHeavy={setShowRailContextHeavy}
        showRailContextCommuter={showRailContextCommuter}
        setShowRailContextCommuter={setShowRailContextCommuter}
        railContextHeavyCount={railContextHeavyCount}
        railContextCommuterCount={railContextCommuterCount}
        hideStoppedTrains={hideStoppedTrains}
        setHideStoppedTrains={setHideStoppedTrains}
        viewMode={viewMode}
        setViewMode={setViewMode}
        lineStats={lineStats}
        speedUnit={speedUnit}
        setSpeedUnit={setSpeedUnit}
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
        showSwitches={showSwitches}
        showRailContextHeavy={showRailContextHeavy}
        showRailContextCommuter={showRailContextCommuter}
        hideStoppedTrains={hideStoppedTrains}
        viewMode={viewMode}
        showSatellite={showSatellite}
        onSatelliteToggle={setShowSatellite}
        speedUnit={speedUnit}
        onRailContextUpdate={(heavyCount, commuterCount) => {
          setRailContextHeavyCount(heavyCount);
          setRailContextCommuterCount(commuterCount);
        }}
        onVehicleUpdate={(count, time, stats, ageMinutes) => {
          setVehicleCount(count);
          setLastUpdate(time);
          if (stats) setLineStats(stats);
          if (ageMinutes !== undefined) setDataAgeMinutes(ageMinutes);
        }}
      />
    </div>
  );
}

export default App;
