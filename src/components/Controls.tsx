import { useState, useEffect } from "react";
import type {
  MuniLine,
  LAMetroLine,
  SeattleLinkLine,
  BostonGreenLine,
  PortlandMaxLine,
  PortlandStreetcarLine,
  SanDiegoTrolleyLine,
  TorontoStreetcarLine,
  PhillyTrolleyLine,
  SacramentoLightRailLine,
  PittsburghTLine,
  DallasDartLine,
  MinneapolisMetroLine,
  DenverRtdLine,
  SlcTraxLine,
  VtaLightRailLine,
  PhoenixLightRailLine,
  HblrLine,
  CalgaryCtrainLine,
  EdmontonLrtLine,
  ClevelandRtaLine,
  CharlotteLynxLine,
  BaltimoreLightRailLine,
  City,
} from "../types";
import {
  LA_METRO_LINE_INFO,
  SEATTLE_LINK_LINE_INFO,
  BOSTON_GREEN_LINE_INFO,
  PORTLAND_MAX_LINE_INFO,
  PORTLAND_STREETCAR_LINE_INFO,
  SAN_DIEGO_TROLLEY_LINE_INFO,
  TORONTO_STREETCAR_LINE_INFO,
  PHILLY_TROLLEY_LINE_INFO,
  SACRAMENTO_LIGHT_RAIL_LINE_INFO,
  PITTSBURGH_T_LINE_INFO,
  DALLAS_DART_LINE_INFO,
  MINNEAPOLIS_METRO_LINE_INFO,
  DENVER_RTD_LINE_INFO,
  SLC_TRAX_LINE_INFO,
  VTA_LIGHT_RAIL_LINE_INFO,
  PHOENIX_LIGHT_RAIL_LINE_INFO,
  HBLR_LINE_INFO,
  CALGARY_CTRAIN_LINE_INFO,
  EDMONTON_LRT_LINE_INFO,
  CLEVELAND_RTA_LINE_INFO,
  CHARLOTTE_LYNX_LINE_INFO,
  BALTIMORE_LIGHT_RAIL_LINE_INFO,
  getLinesForCity,
} from "../types";
import type { SpeedFilter, ViewMode, LineStats, RouteLineMode } from "../App";

// Official SFMTA colors from GTFS
const MUNI_COLORS: Record<MuniLine, string> = {
  F: "#B49A36",
  J: "#A96614",
  K: "#437C93",
  L: "#942D83",
  M: "#008547",
  N: "#005B95",
  T: "#BF2B45",
};

// Get color for any line
function getLineColor(line: string, city: City): string {
  if (city === "SF") {
    return MUNI_COLORS[line as MuniLine] || "#666";
  } else if (city === "LA") {
    return LA_METRO_LINE_INFO[line as LAMetroLine]?.color || "#666";
  } else if (city === "Seattle") {
    return SEATTLE_LINK_LINE_INFO[line as SeattleLinkLine]?.color || "#666";
  } else if (city === "Boston") {
    return BOSTON_GREEN_LINE_INFO[line as BostonGreenLine]?.color || "#666";
  } else if (city === "Portland") {
    return (
      PORTLAND_MAX_LINE_INFO[line as PortlandMaxLine]?.color ||
      PORTLAND_STREETCAR_LINE_INFO[line as PortlandStreetcarLine]?.color ||
      "#666"
    );
  } else if (city === "San Diego") {
    return (
      SAN_DIEGO_TROLLEY_LINE_INFO[line as SanDiegoTrolleyLine]?.color || "#666"
    );
  } else if (city === "Toronto") {
    return (
      TORONTO_STREETCAR_LINE_INFO[line as TorontoStreetcarLine]?.color ||
      "#ED1C24"
    );
  } else if (city === "Philadelphia") {
    return (
      PHILLY_TROLLEY_LINE_INFO[line as PhillyTrolleyLine]?.color || "#5A960A"
    );
  } else if (city === "Sacramento") {
    return (
      SACRAMENTO_LIGHT_RAIL_LINE_INFO[line as SacramentoLightRailLine]?.color ||
      "#666"
    );
  } else if (city === "Pittsburgh") {
    return PITTSBURGH_T_LINE_INFO[line as PittsburghTLine]?.color || "#666";
  } else if (city === "Dallas") {
    return DALLAS_DART_LINE_INFO[line as DallasDartLine]?.color || "#666";
  } else if (city === "Minneapolis") {
    return (
      MINNEAPOLIS_METRO_LINE_INFO[line as MinneapolisMetroLine]?.color || "#666"
    );
  } else if (city === "Denver") {
    return DENVER_RTD_LINE_INFO[line as DenverRtdLine]?.color || "#666";
  } else if (city === "Salt Lake City") {
    return SLC_TRAX_LINE_INFO[line as SlcTraxLine]?.color || "#666";
  } else if (city === "San Jose") {
    return VTA_LIGHT_RAIL_LINE_INFO[line as VtaLightRailLine]?.color || "#666";
  } else if (city === "Phoenix") {
    return (
      PHOENIX_LIGHT_RAIL_LINE_INFO[line as PhoenixLightRailLine]?.color ||
      "#E5721A"
    );
  } else if (city === "Jersey City") {
    return HBLR_LINE_INFO[line as HblrLine]?.color || "#666";
  } else if (city === "Calgary") {
    return CALGARY_CTRAIN_LINE_INFO[line as CalgaryCtrainLine]?.color || "#666";
  } else if (city === "Edmonton") {
    return EDMONTON_LRT_LINE_INFO[line as EdmontonLrtLine]?.color || "#666";
  } else if (city === "Cleveland") {
    return CLEVELAND_RTA_LINE_INFO[line as ClevelandRtaLine]?.color || "#666";
  } else if (city === "Charlotte") {
    return CHARLOTTE_LYNX_LINE_INFO[line as CharlotteLynxLine]?.color || "#666";
  } else if (city === "Baltimore") {
    return BALTIMORE_LIGHT_RAIL_LINE_INFO[line as BaltimoreLightRailLine]?.color || "#666";
  }
  return "#666";
}

// Get display label for a line
function getLineLabel(line: string, city: City): string {
  if (city === "SF") {
    return line;
  } else if (city === "LA") {
    return LA_METRO_LINE_INFO[line as LAMetroLine]?.letter || line;
  } else if (city === "Seattle") {
    return SEATTLE_LINK_LINE_INFO[line as SeattleLinkLine]?.letter || line;
  } else if (city === "Boston") {
    return BOSTON_GREEN_LINE_INFO[line as BostonGreenLine]?.letter || line;
  } else if (city === "Portland") {
    return (
      PORTLAND_MAX_LINE_INFO[line as PortlandMaxLine]?.letter ||
      PORTLAND_STREETCAR_LINE_INFO[line as PortlandStreetcarLine]?.letter ||
      line
    );
  } else if (city === "San Diego") {
    return (
      SAN_DIEGO_TROLLEY_LINE_INFO[line as SanDiegoTrolleyLine]?.letter || line
    );
  } else if (city === "Toronto") {
    return (
      TORONTO_STREETCAR_LINE_INFO[line as TorontoStreetcarLine]?.letter || line
    );
  } else if (city === "Philadelphia") {
    return PHILLY_TROLLEY_LINE_INFO[line as PhillyTrolleyLine]?.letter || line;
  } else if (city === "Sacramento") {
    return (
      SACRAMENTO_LIGHT_RAIL_LINE_INFO[line as SacramentoLightRailLine]
        ?.letter || line
    );
  } else if (city === "Pittsburgh") {
    return PITTSBURGH_T_LINE_INFO[line as PittsburghTLine]?.letter || line;
  } else if (city === "Dallas") {
    return DALLAS_DART_LINE_INFO[line as DallasDartLine]?.letter || line;
  } else if (city === "Minneapolis") {
    return (
      MINNEAPOLIS_METRO_LINE_INFO[line as MinneapolisMetroLine]?.letter || line
    );
  } else if (city === "Denver") {
    return DENVER_RTD_LINE_INFO[line as DenverRtdLine]?.letter || line;
  } else if (city === "Salt Lake City") {
    return SLC_TRAX_LINE_INFO[line as SlcTraxLine]?.letter || line;
  } else if (city === "San Jose") {
    return VTA_LIGHT_RAIL_LINE_INFO[line as VtaLightRailLine]?.letter || line;
  } else if (city === "Phoenix") {
    return (
      PHOENIX_LIGHT_RAIL_LINE_INFO[line as PhoenixLightRailLine]?.letter || line
    );
  } else if (city === "Jersey City") {
    return HBLR_LINE_INFO[line as HblrLine]?.letter || line;
  } else if (city === "Calgary") {
    return CALGARY_CTRAIN_LINE_INFO[line as CalgaryCtrainLine]?.letter || line;
  } else if (city === "Edmonton") {
    return EDMONTON_LRT_LINE_INFO[line as EdmontonLrtLine]?.letter || line;
  } else if (city === "Cleveland") {
    return CLEVELAND_RTA_LINE_INFO[line as ClevelandRtaLine]?.letter || line;
  } else if (city === "Charlotte") {
    return CHARLOTTE_LYNX_LINE_INFO[line as CharlotteLynxLine]?.letter || line;
  } else if (city === "Baltimore") {
    return BALTIMORE_LIGHT_RAIL_LINE_INFO[line as BaltimoreLightRailLine]?.letter || line;
  }
  return line;
}

// Get badge width class based on the longest label in each city
function getBadgeWidthClass(city: City): string {
  switch (city) {
    case "Portland":
    case "San Diego":
    case "Pittsburgh":
    case "Dallas":
      return "badge-width-word"; // "Orange", "Yellow", "Copper", "Red", etc.
    case "Sacramento":
    case "Minneapolis":
    case "Salt Lake City":
    case "San Jose":
    case "Calgary":
    case "Edmonton":
    case "Cleveland":
      return "badge-width-short-word"; // "Blue", "Green", "Cap", "Met"
    case "Charlotte":
      return "badge-width-short-word"; // "Blue", "Gold"
    case "Phoenix":
    case "Baltimore":
      return "badge-width-letter"; // Single letters (A, B) or short codes (LR)
    case "Toronto":
    case "Philadelphia":
    case "Jersey City":
      return "badge-width-3digit"; // "501", "102", "BF", "HOB", "WS"
    default:
      return "badge-width-letter"; // Single letters (SF, LA, Boston, Seattle, Denver)
  }
}

// Get line info for tooltip
function getLineInfo(line: string, city: City): string | undefined {
  if (city === "LA") {
    return LA_METRO_LINE_INFO[line as LAMetroLine]?.name;
  } else if (city === "Seattle") {
    return SEATTLE_LINK_LINE_INFO[line as SeattleLinkLine]?.name;
  } else if (city === "Boston") {
    return BOSTON_GREEN_LINE_INFO[line as BostonGreenLine]?.name;
  } else if (city === "Portland") {
    return (
      PORTLAND_MAX_LINE_INFO[line as PortlandMaxLine]?.name ||
      PORTLAND_STREETCAR_LINE_INFO[line as PortlandStreetcarLine]?.name
    );
  } else if (city === "San Diego") {
    return SAN_DIEGO_TROLLEY_LINE_INFO[line as SanDiegoTrolleyLine]?.name;
  } else if (city === "Toronto") {
    return TORONTO_STREETCAR_LINE_INFO[line as TorontoStreetcarLine]?.name;
  } else if (city === "Philadelphia") {
    return PHILLY_TROLLEY_LINE_INFO[line as PhillyTrolleyLine]?.name;
  } else if (city === "Sacramento") {
    return SACRAMENTO_LIGHT_RAIL_LINE_INFO[line as SacramentoLightRailLine]
      ?.name;
  } else if (city === "Pittsburgh") {
    return PITTSBURGH_T_LINE_INFO[line as PittsburghTLine]?.name;
  } else if (city === "Dallas") {
    return DALLAS_DART_LINE_INFO[line as DallasDartLine]?.name;
  } else if (city === "Minneapolis") {
    return MINNEAPOLIS_METRO_LINE_INFO[line as MinneapolisMetroLine]?.name;
  } else if (city === "Denver") {
    return DENVER_RTD_LINE_INFO[line as DenverRtdLine]?.name;
  } else if (city === "Salt Lake City") {
    return SLC_TRAX_LINE_INFO[line as SlcTraxLine]?.name;
  } else if (city === "San Jose") {
    return VTA_LIGHT_RAIL_LINE_INFO[line as VtaLightRailLine]?.name;
  } else if (city === "Phoenix") {
    return PHOENIX_LIGHT_RAIL_LINE_INFO[line as PhoenixLightRailLine]?.name;
  } else if (city === "Jersey City") {
    return HBLR_LINE_INFO[line as HblrLine]?.name;
  } else if (city === "Calgary") {
    return CALGARY_CTRAIN_LINE_INFO[line as CalgaryCtrainLine]?.name;
  } else if (city === "Edmonton") {
    return EDMONTON_LRT_LINE_INFO[line as EdmontonLrtLine]?.name;
  } else if (city === "Cleveland") {
    return CLEVELAND_RTA_LINE_INFO[line as ClevelandRtaLine]?.name;
  } else if (city === "Charlotte") {
    return CHARLOTTE_LYNX_LINE_INFO[line as CharlotteLynxLine]?.name;
  } else if (city === "Baltimore") {
    return BALTIMORE_LIGHT_RAIL_LINE_INFO[line as BaltimoreLightRailLine]?.name;
  }
  return undefined;
}

interface ControlsProps {
  city: City;
  setCity: (city: City) => void;
  selectedLines: string[];
  setSelectedLines: (lines: string[]) => void;
  vehicleCount: number;
  lastUpdate: Date | null;
  dataAgeMinutes: number | null;
  speedFilter: SpeedFilter;
  setSpeedFilter: (filter: SpeedFilter) => void;
  showRouteLines: boolean;
  setShowRouteLines: (show: boolean) => void;
  routeLineMode: RouteLineMode;
  setRouteLineMode: (mode: RouteLineMode) => void;
  showStops: boolean;
  setShowStops: (show: boolean) => void;
  showCrossings: boolean;
  setShowCrossings: (show: boolean) => void;
  showSwitches: boolean;
  setShowSwitches: (show: boolean) => void;
  hideStoppedTrains: boolean;
  setHideStoppedTrains: (hide: boolean) => void;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  lineStats: LineStats[];
}

export function Controls({
  city,
  setCity,
  selectedLines,
  setSelectedLines,
  vehicleCount,
  lastUpdate,
  dataAgeMinutes,
  speedFilter,
  setSpeedFilter,
  showRouteLines,
  setShowRouteLines,
  routeLineMode,
  setRouteLineMode,
  showStops,
  setShowStops,
  showCrossings,
  setShowCrossings,
  showSwitches,
  setShowSwitches,
  hideStoppedTrains,
  setHideStoppedTrains,
  viewMode,
  setViewMode,
  lineStats,
}: ControlsProps) {
  // Sacramento warning modal state
  const [showSacWarning, setShowSacWarning] = useState(false);

  // Show modal when user navigates to Sacramento
  useEffect(() => {
    if (city === "Sacramento") {
      setShowSacWarning(true);
    }
  }, [city]);

  // Live mode: fresh if data is less than 5 minutes old, but always available if we have any data
  const isLiveFresh = dataAgeMinutes !== null && dataAgeMinutes < 5;
  const hasAnyData = dataAgeMinutes !== null;
  const liveTimeText =
    dataAgeMinutes === null
      ? ""
      : dataAgeMinutes < 1
      ? "(now)"
      : dataAgeMinutes < 60
      ? `(${Math.round(dataAgeMinutes)}m ago)`
      : dataAgeMinutes < 1440
      ? `(${Math.round(dataAgeMinutes / 60)}h ago)`
      : `(${Math.round(dataAgeMinutes / 1440)}d ago)`;
  const liveTooltip = isLiveFresh
    ? "Show current train positions"
    : hasAnyData
    ? "Show last known train positions (data is stale)"
    : "No data loaded yet";

  const allLines = getLinesForCity(city);

  const toggleLine = (line: string) => {
    if (selectedLines.includes(line)) {
      setSelectedLines(selectedLines.filter((l) => l !== line));
    } else {
      setSelectedLines([...selectedLines, line]);
    }
  };

  const selectAllLines = () => {
    setSelectedLines([...allLines] as string[]);
  };

  const clearAllLines = () => {
    setSelectedLines([]);
  };

  // Two-line title: Line 1 = City, Line 2 = System
  const cityNames: Record<string, string> = {
    SF: "San Francisco",
    LA: "Los Angeles",
    Seattle: "Seattle",
    Boston: "Boston",
    Portland: "Portland",
    "San Diego": "San Diego",
    Toronto: "Toronto",
    Philadelphia: "Philadelphia",
    Sacramento: "Sacramento",
    Pittsburgh: "Pittsburgh",
    Dallas: "Dallas",
    Minneapolis: "Minneapolis",
    Denver: "Denver",
    "Salt Lake City": "Salt Lake City",
    "San Jose": "San Jose",
    "Jersey City": "Jersey City",
    Calgary: "Calgary",
    Edmonton: "Edmonton",
    Cleveland: "Cleveland",
    Charlotte: "Charlotte",
    Phoenix: "Phoenix",
    Baltimore: "Baltimore",
  };
  const systemNames: Record<string, string> = {
    SF: "Muni Speed Map",
    LA: "Metro Speed Map",
    Seattle: "Link Speed Map",
    Boston: "Green Line Speed Map",
    Portland: "MAX Speed Map",
    "San Diego": "Trolley Speed Map",
    Toronto: "Streetcar Speed Map",
    Philadelphia: "Trolley Speed Map",
    Sacramento: "Light Rail Speed Map",
    Pittsburgh: "The T Speed Map",
    Dallas: "DART Speed Map",
    Minneapolis: "Metro Speed Map",
    Denver: "RTD Speed Map",
    "Salt Lake City": "TRAX Speed Map",
    "San Jose": "VTA Speed Map",
    "Jersey City": "HBLR Speed Map",
    Calgary: "CTrain Speed Map",
    Edmonton: "LRT Speed Map",
    Cleveland: "RTA Speed Map",
    Charlotte: "LYNX Speed Map",
    Phoenix: "Valley Metro Speed Map",
    Baltimore: "RailLink Speed Map",
  };
  const cityLine = cityNames[city] || city;
  const systemLine = systemNames[city] || "Speed Map";

  return (
    <div className="controls-panel">
      <div className="app-header">
        <span className="app-city">{cityLine}</span>
        <h1
          className={`app-title ${city === "Boston" ? "app-title-long" : ""}`}
        >
          {systemLine}
        </h1>
      </div>
      {/* City Selector - 3x3 grid */}
      <div className="city-selector">
        {/* Row 1: West Coast */}
        <button
          className={`city-btn ${city === "SF" ? "active" : ""}`}
          onClick={() => setCity("SF")}
        >
          🌉 SF
        </button>
        <button
          className={`city-btn ${city === "LA" ? "active" : ""}`}
          onClick={() => setCity("LA")}
        >
          🌴 LA
        </button>

        {/* Row 2: Pacific NW + Central */}
        <button
          className={`city-btn  ${city === "Seattle" ? "active" : ""}`}
          onClick={() => setCity("Seattle")}
          title="Waiting for API key"
        >
          ☕ Seattle
        </button>
        <button
          className={`city-btn ${city === "Portland" ? "active" : ""}`}
          onClick={() => setCity("Portland")}
        >
          🚲 PDX
        </button>

        {/* Row 3: East + Canada */}
        <button
          className={`city-btn ${city === "Boston" ? "active" : ""}`}
          onClick={() => setCity("Boston")}
        >
          🦞 Boston
        </button>
        <button
          className={`city-btn ${city === "Philadelphia" ? "active" : ""}`}
          onClick={() => setCity("Philadelphia")}
        >
          🔔 Philly
        </button>
        <button
          className={`city-btn  ${city === "San Jose" ? "active" : ""}`}
          onClick={() => setCity("San Jose")}
          title="Data collection starting soon"
        >
          💻 SJ
        </button>
        <button
          className={`city-btn ${city === "Toronto" ? "active" : ""}`}
          onClick={() => setCity("Toronto")}
        >
          🍁 Toronto
        </button>
        <button
          className={`city-btn ${city === "Minneapolis" ? "active" : ""}`}
          onClick={() => setCity("Minneapolis")}
          title="Data collection starting soon"
        >
          🌆 MSP
        </button>
        <button
          className={`city-btn ${city === "Denver" ? "active" : ""}`}
          onClick={() => setCity("Denver")}
          title="Data collection starting soon"
        >
          🏔️ Denver
        </button>
        {/* Row 4: New cities */}

        <button
          className={`city-btn  ${city === "Salt Lake City" ? "active" : ""}`}
          onClick={() => setCity("Salt Lake City")}
          title="Data collection starting soon"
        >
          🏔️ SLC
        </button>
        <button
          className={`city-btn  ${city === "Pittsburgh" ? "active" : ""}`}
          onClick={() => setCity("Pittsburgh")}
          title="Data collection starting soon"
        >
          🏗️ PIT
        </button>

        <button
          className={`city-btn ${city === "Phoenix" ? "active" : ""}`}
          onClick={() => setCity("Phoenix")}
          title="Valley Metro Rail"
        >
          🌵 PHX
        </button>

        <button
          className={`city-btn ${city === "Charlotte" ? "active" : ""}`}
          onClick={() => setCity("Charlotte")}
          title="LYNX Blue Line & Gold Line"
        >
          🚊 CLT
        </button>

        <button
          className={`city-btn city-btn-pending ${city === "Baltimore" ? "active" : ""}`}
          onClick={() => setCity("Baltimore")}
          title="MTA Light RailLink"
        >
          🦀 BAL
        </button>

        <button
          className={`city-btn city-btn-pending ${
            city === "San Diego" ? "active" : ""
          }`}
          onClick={() => setCity("San Diego")}
          title="Waiting for API key"
        >
          🌊 SD
        </button>

        {/* <button
          className="city-btn city-btn-dark-orange"
          onClick={() => console.log("Cleveland (RTA) - Coming soon")}
          title="RTA Red Line - Coming soon"
        >
          🚊 CLE
        </button>

        <button
          className="city-btn city-btn-dark-orange"
          onClick={() => console.log("Jersey City (HBLR) - Coming soon")}
          title="Hudson-Bergen Light Rail - Coming soon"
        >
          🚊JC
        </button>
        <button
          className={`city-btn ${city === "Calgary" ? "active" : ""}`}
          onClick={() => setCity("Calgary")}
          title="CTrain Red & Blue Lines"
        >
          🍁 CGY
        </button>
        <button
          className="city-btn city-btn-dark-orange"
          onClick={() => console.log("Edmonton (LRT) - Coming soon")}
          title="LRT Capital & Metro Lines - Coming soon"
        >
          🚊 EMD
        </button>
        <button
          className={`city-btn city-btn-pending ${
            city === "Dallas" ? "active" : ""
          }`}
          onClick={() => setCity("Dallas")}
          title="Data collection starting soon"
        >
          ⭐ Dallas
        </button> */}

        {/* <button
          className={`city-btn city-btn-warning ${
            city === "Sacramento" ? "active" : ""
          }`}
          onClick={() => setCity("Sacramento")}
          title="Data quality issues - SacRT doesn't tag light rail vehicles"
        >
          ⚠️ Sac
        </button> */}
      </div>

      {/* Data Status */}
      <div className="status-section">
        <div className="status-row">
          <span className="live-indicator"></span>
          <span>{vehicleCount.toLocaleString()} positions loaded</span>
        </div>
        <div className="status-row muted">
          {lastUpdate
            ? `Latest: ${lastUpdate.toLocaleTimeString()}`
            : "Loading..."}
        </div>
      </div>

      {/* View Mode Toggle */}
      <div className="control-group">
        <div className="control-label">Data View Mode</div>
        <div className="view-mode-toggle">
          <button
            className={`view-mode-btn ${viewMode === "raw" ? "active" : ""}`}
            onClick={() => setViewMode("raw")}
          >
            Raw Data
          </button>
          <button
            className={`view-mode-btn ${
              viewMode === "segments" ? "active" : ""
            }`}
            onClick={() => setViewMode("segments")}
          >
            Segment Avg
          </button>
          <button
            className={`view-mode-btn live-btn ${
              viewMode === "live" ? "active" : ""
            } ${!hasAnyData ? "disabled" : ""} ${
              hasAnyData && !isLiveFresh ? "stale" : ""
            }`}
            onClick={() => hasAnyData && setViewMode("live")}
            disabled={!hasAnyData}
            title={liveTooltip}
          >
            <span className="btn-main-row">
              <span className="btn-icon">
                {!hasAnyData ? "⚫" : isLiveFresh ? "🟢" : "🟡"}
              </span>
              <span>Live</span>
            </span>
            <span className="btn-subtext">{liveTimeText || "\u00A0"}</span>
          </button>
        </div>
      </div>

      {/* Line Filter */}
      <div className="control-group">
        <div className="control-label-row">
          <label className="control-label">Filter Lines</label>
          <div className="toggle-group">
            <button
              className={`toggle-button ${
                selectedLines.length === allLines.length ? "active" : ""
              }`}
              onClick={selectAllLines}
            >
              All
            </button>
            <button
              className={`toggle-button ${
                selectedLines.length === 0 ? "active" : ""
              }`}
              onClick={clearAllLines}
            >
              None
            </button>
          </div>
        </div>
        <div className="line-buttons">
          {allLines.map((line) => (
            <button
              key={line}
              className={`line-button ${
                selectedLines.includes(line) ? "active" : "inactive"
              }${city === "Toronto" ? " toronto-line-button" : ""}${
                city === "Toronto" && line === "805" ? " line-coming-soon" : ""
              }`}
              style={
                {
                  "--line-color": getLineColor(line, city),
                } as React.CSSProperties
              }
              onClick={() => {
                toggleLine(line);
              }}
              title={
                city === "Toronto" && line === "805"
                  ? "Line 5 Eglinton - Under Construction (route data from OpenStreetMap)"
                  : getLineInfo(line, city)
              }
            >
              {city === "Toronto" ? (
                <>
                  <span className="toronto-line-number">
                    {line === "805" || line === "806"
                      ? TORONTO_STREETCAR_LINE_INFO[
                          line as TorontoStreetcarLine
                        ]?.letter
                      : line}
                  </span>
                  <span className="toronto-line-corridor">
                    {
                      TORONTO_STREETCAR_LINE_INFO[line as TorontoStreetcarLine]
                        ?.corridor
                    }
                    {line === "805" ? " 🚧" : ""}
                  </span>
                </>
              ) : (
                getLineLabel(line, city)
              )}
            </button>
          ))}
        </div>
        <div className="route-lines-section">
          <div className="route-lines-toggle">
            <label>
              <input
                type="checkbox"
                checked={showRouteLines}
                onChange={(e) => setShowRouteLines(e.target.checked)}
              />
              Show route lines
            </label>
          </div>
          <div className={`route-line-mode-toggle ${!showRouteLines ? "disabled" : ""}`}>
            <button
              className={`route-mode-btn ${
                routeLineMode === "byLine" ? "active" : ""
              }`}
              onClick={() => setRouteLineMode("byLine")}
              disabled={!showRouteLines}
            >
              By Line
            </button>
            {city === "Toronto" || city === "Pittsburgh" || city === "Baltimore" || city === "Phoenix" ? (
              <button
                className="route-mode-btn"
                style={{ opacity: 0.4, cursor: "not-allowed" }}
                disabled
                title="Speed limit data is not available for this city"
              >
                Speed Limit
              </button>
            ) : (
              <button
                className={`route-mode-btn ${
                  routeLineMode === "bySpeedLimit" ? "active" : ""
                }`}
                onClick={() => setRouteLineMode("bySpeedLimit")}
                disabled={!showRouteLines}
              >
                Speed Limit
              </button>
            )}
            <button
              className={`route-mode-btn ${
                routeLineMode === "bySeparation" ? "active" : ""
              }`}
              onClick={() => setRouteLineMode("bySeparation")}
              disabled={!showRouteLines}
            >
              Separation
            </button>
          </div>
          {/* Separation Legend - shown when separation mode is active */}
          {showRouteLines && routeLineMode === "bySeparation" && (
            <div className="separation-legend">
              <div className="separation-legend-item">
                <span className="separation-legend-line" style={{ backgroundColor: "#3b82f6" }}></span>
                <span>Tunnel / Trench</span>
              </div>
              <div className="separation-legend-item">
                <span className="separation-legend-line" style={{ backgroundColor: "#22c55e" }}></span>
                <span>Elevated</span>
              </div>
              <div className="separation-legend-item">
                <span className="separation-legend-line" style={{ backgroundColor: "#eab308" }}></span>
                <span>Separated At-Grade</span>
              </div>
              <div className="separation-legend-item">
                <span className="separation-legend-line" style={{ backgroundColor: "#f97316" }}></span>
                <span>Reserved Lane</span>
              </div>
              <div className="separation-legend-item">
                <span className="separation-legend-line" style={{ backgroundColor: "#ef4444" }}></span>
                <span>Mixed Traffic</span>
              </div>

              <div className="separation-legend-item">
                <span className="separation-legend-line" style={{ backgroundColor: "#6b7280" }}></span>
                <span>Unknown</span>
              </div>
            </div>
          )}
        </div>
        <div className="route-lines-toggle">
          <label>
            <input
              type="checkbox"
              checked={showStops}
              onChange={(e) => setShowStops(e.target.checked)}
            />
            Show stations
          </label>
        </div>
        <div className="route-lines-toggle">
          {city === "Philadelphia" || city === "Toronto" ? (
            <label
              style={{ opacity: 0.5, cursor: "not-allowed" }}
              title="Grade crossing data is not available for this city"
            >
              <input
                type="checkbox"
                checked={false}
                disabled
              />
              Show grade crossings (X)
            </label>
          ) : (
            <label>
              <input
                type="checkbox"
                checked={showCrossings}
                onChange={(e) => setShowCrossings(e.target.checked)}
              />
              Show grade crossings (X)
            </label>
          )}
        </div>
        <div className="route-lines-toggle">
          <label>
            <input
              type="checkbox"
              checked={showSwitches}
              onChange={(e) => setShowSwitches(e.target.checked)}
            />
            Show track switches (Y)
          </label>
        </div>
        <div className="route-lines-toggle">
          <label>
            <input
              type="checkbox"
              checked={hideStoppedTrains}
              onChange={(e) => setHideStoppedTrains(e.target.checked)}
            />
            Hide stopped trains (0 mph)
          </label>
        </div>
      </div>

      {/* Speed Filter */}
      <div className="control-group">
        <div className="control-label">Speed Filter</div>
        <div className="speed-filter">
          <div className="speed-slider-row">
            <label>Min: {speedFilter.minSpeed} mph</label>
            <input
              type="range"
              min="0"
              max="50"
              value={speedFilter.minSpeed}
              onChange={(e) =>
                setSpeedFilter({
                  ...speedFilter,
                  minSpeed: Math.min(
                    Number(e.target.value),
                    speedFilter.maxSpeed
                  ),
                })
              }
              className="speed-slider"
            />
          </div>
          <div className="speed-slider-row">
            <label>
              Max: {speedFilter.maxSpeed === 50 ? "50+" : speedFilter.maxSpeed}{" "}
              mph
            </label>
            <input
              type="range"
              min="0"
              max="50"
              value={speedFilter.maxSpeed}
              onChange={(e) =>
                setSpeedFilter({
                  ...speedFilter,
                  maxSpeed: Math.max(
                    Number(e.target.value),
                    speedFilter.minSpeed
                  ),
                })
              }
              className="speed-slider"
            />
          </div>
          <button
            className="reset-filter-btn"
            onClick={() => {
              setSpeedFilter({ minSpeed: 0, maxSpeed: 50, showNoData: true });
              setSelectedLines([...allLines] as string[]);
              setShowRouteLines(true);
              setShowStops(false);
              setShowCrossings(false);
              setShowSwitches(false);
              setHideStoppedTrains(false);
            }}
          >
            Reset Filters
          </button>
        </div>
      </div>

      {/* Speed Legend - two column layout: slow (left) to fast (right) */}
      <div className="control-group">
        <div className="control-label">Speed Legend (MPH)</div>
        <div className="speed-legend-grid">
          {/* Left column - slower speeds */}
          <div className="speed-legend-column">
            <div className="speed-legend-item">
              <span
                className="speed-legend-dot"
                style={{ backgroundColor: "#9b2d6b" }}
              ></span>
              <span>≤ 5</span>
            </div>
            <div className="speed-legend-item">
              <span
                className="speed-legend-dot"
                style={{ backgroundColor: "#ff3333" }}
              ></span>
              <span>5-10</span>
            </div>
            <div className="speed-legend-item">
              <span
                className="speed-legend-dot"
                style={{ backgroundColor: "#ff9933" }}
              ></span>
              <span>10-15</span>
            </div>
            <div className="speed-legend-item">
              <span
                className="speed-legend-dot"
                style={{ backgroundColor: "#ffdd33" }}
              ></span>
              <span>15-25</span>
            </div>
          </div>
          {/* Right column - faster speeds */}
          <div className="speed-legend-column">
            <div className="speed-legend-item">
              <span
                className="speed-legend-dot"
                style={{ backgroundColor: "#88ff33" }}
              ></span>
              <span>25-35</span>
            </div>
            <div className="speed-legend-item">
              <span
                className="speed-legend-dot"
                style={{ backgroundColor: "#33eebb" }}
              ></span>
              <span>35-50</span>
            </div>
            <div className="speed-legend-item">
              <span
                className="speed-legend-dot"
                style={{ backgroundColor: "#22ccff" }}
              ></span>
              <span>&gt; 50</span>
            </div>
            <div className="speed-legend-item">
              <span
                className="speed-legend-dot"
                style={{ backgroundColor: "#666666" }}
              ></span>
              <span>No data</span>
            </div>
          </div>
        </div>
      </div>

      {/* Line Statistics */}
      {lineStats.length > 0 && (
        <div className="control-group">
          <div className="control-label">Speed by Line</div>
          <div className="line-stats">
            {[...lineStats]
              .sort((a, b) => b.avgSpeed - a.avgSpeed)
              .map((stat) => (
                <div key={stat.line} className="line-stat-item">
                  <span
                    className={`line-stat-badge ${getBadgeWidthClass(city)}`}
                    style={{ backgroundColor: getLineColor(stat.line, city) }}
                    title={getLineInfo(stat.line, city)}
                  >
                    {getLineLabel(stat.line, city)}
                  </span>
                  <span className="line-stat-speed">
                    {stat.avgSpeed.toFixed(1)}
                  </span>
                  <span className="line-stat-label">avg</span>
                  <span className="line-stat-speed">
                    {stat.medianSpeed.toFixed(1)}
                  </span>
                  <span className="line-stat-label">median</span>
                  <span className="line-stat-count">
                    ({stat.count.toLocaleString()})
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Info */}
      <div className="info-section">
        <h3>About the {cityLine} Map</h3>
        <p>
          <strong>Speed data:</strong>{" "}
          {city === "LA" ||
          city === "Boston" ||
          city === "Portland" ||
          city === "Toronto" ||
          city === "Sacramento" ||
          city === "Pittsburgh" ||
          city === "Dallas" ||
          city === "Minneapolis" ||
          city === "Denver" ||
          city === "Salt Lake City"
            ? "Speed is provided directly by the transit agency's API, giving accurate real-time readings."
            : "Speed is calculated from GPS positions, measuring distance traveled between consecutive readings (~90 seconds apart)."}
        </p>
        <p>
          <strong>Data freshness:</strong> This map displays all recent data
          from the database.
        </p>
        {city === "SF" && (
          <>
            <p>
              <strong>Sunset Tunnel:</strong> The N Judah's Sunset Tunnel has no
              GPS signal inside, so data points cluster at the tunnel portals.
              The higher speeds shown there represent the actual average speed
              through the grade-separated tunnel section.
            </p>
            <p>
              <strong>F Line note:</strong> Grade crossings for the F Market
              line are hidden because it runs entirely on Market Street surface
              level, which would be confusing alongside the Market Street subway
              lines below.
            </p>
          </>
        )}
        {city === "Portland" && (
          <p>
            <strong>Downtown transit mall:</strong> Portland's MAX runs through
            downtown on a dedicated transit mall rather than traditional
            at-grade crossings, so fewer grade crossing markers appear in the
            city center.
          </p>
        )}
        {city === "Toronto" && (
          <p>
            <strong>Grade crossings:</strong> Toronto streetcars run embedded in
            city streets in mixed traffic, so OpenStreetMap doesn't tag these as
            railway grade crossings. The speed data still shows where streetcars
            slow down due to traffic conflicts.
          </p>
        )}
        {city === "Philadelphia" && (
          <p>
            <strong>Grade crossings:</strong> Philadelphia trolleys operate in
            mixed traffic on city streets, so OpenStreetMap doesn't tag these as
            railway grade crossings. The speed data still shows where trolleys
            slow down due to traffic conflicts.
          </p>
        )}
        {city === "Sacramento" && (
          <>
            <div className="data-warning">
              <strong>⚠️ Data Quality Issue:</strong> SacRT's API doesn't
              identify which vehicles are light rail vs. buses. We attempt to
              filter by track proximity, but some data points may be incorrect.
              This is left as-is until a solution can be found.
            </div>
            <p>
              <strong>Shared track:</strong> Gold and Blue lines share track
              through downtown Sacramento. Vehicles in this section are shown
              when either line is selected.
            </p>
          </>
        )}
        {city === "Pittsburgh" && (
          <p>
            <strong>Downtown subway:</strong> Pittsburgh's "The T" runs through
            a subway tunnel in downtown before emerging for surface operations
            in the South Hills suburbs — similar to SF Muni's Market Street
            subway. Compare speeds between the grade-separated downtown section
            and the at-grade suburban sections.
          </p>
        )}
        {city === "Dallas" && (
          <p>
            <strong>Largest US light rail:</strong> DART is the largest light
            rail system in the United States by route miles (93+ miles). Most
            operations are at-grade with some elevated and grade-separated
            sections.
          </p>
        )}
        {city === "Minneapolis" && (
          <p>
            <strong>Airport tunnel:</strong> The Blue Line runs through a tunnel
            under Minneapolis-St. Paul International Airport — one of the few
            grade-separated sections. Downtown operations run on surface streets
            in exclusive right-of-way without signal preemption.
          </p>
        )}
        {city === "Denver" && (
          <p>
            <strong>Mixed operations:</strong> Denver RTD operates a large light
            rail and commuter rail network with both at-grade and
            grade-separated sections. Some lines (like the A Line to the
            airport) are more grade-separated than others.
          </p>
        )}
        {city === "Salt Lake City" && (
          <p>
            <strong>TRAX system:</strong> UTA's TRAX light rail serves the Salt
            Lake Valley with three main lines plus the S-Line streetcar. Most
            operations are at-grade with some grade-separated overpasses and
            exclusive right-of-way sections.
          </p>
        )}
        {city === "San Jose" && (
          <p>
            <strong>VTA Light Rail:</strong> Santa Clara Valley Transportation
            Authority operates light rail with three lines (Blue, Green, Orange)
            serving Silicon Valley. Most operations are at-grade with some
            subway sections in downtown San Jose.
          </p>
        )}
        {city === "Seattle" && (
          <div className="data-warning">
            <strong>⚠️ No Data Available:</strong> Seattle Link data collection
            requires a Sound Transit API key. Route lines and infrastructure are
            shown, but no speed data is currently being collected.
          </div>
        )}
        {city === "San Diego" && (
          <div className="data-warning">
            <strong>⚠️ No Data Available:</strong> San Diego Trolley data
            collection requires an MTS API key. Route lines and infrastructure
            are shown, but no speed data is currently being collected.
          </div>
        )}
        <p>
          <strong>Grade crossings (X):</strong> Locations where the train tracks
          cross a road at street level. These may have gates, stop signs,
          traffic lights (with signal priority or preemption), or other controls
          that can affect train speeds.
        </p>
        <p>
          <strong>Track switches (Y):</strong> Moveable rail sections that allow
          trains to change tracks. Switches are often found at junctions where
          multiple lines meet or at terminal turnbacks.
        </p>
        <p>
          <strong>Speed limit overlay:</strong> When viewing route lines "By
          Speed Limit", grey sections indicate unknown speed limits.
        </p>
        <p className="data-attribution">
          Grade crossing, switch, and speed limit data from{" "}
          <a
            href="https://www.openrailwaymap.org/"
            target="_blank"
            rel="noopener noreferrer"
          >
            OpenRailwayMap
          </a>{" "}
          (OpenStreetMap)
        </p>
        <p className="data-attribution">
          Data from{" "}
          {city === "SF" ? (
            <a
              href="https://511.org/open-data"
              target="_blank"
              rel="noopener noreferrer"
            >
              511.org
            </a>
          ) : city === "LA" ? (
            <a
              href="https://developer.metro.net/"
              target="_blank"
              rel="noopener noreferrer"
            >
              LA Metro API
            </a>
          ) : city === "Seattle" ? (
            <a
              href="https://api.pugetsound.onebusaway.org/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Sound Transit OneBusAway API
            </a>
          ) : city === "Boston" ? (
            <a
              href="https://api-v3.mbta.com/"
              target="_blank"
              rel="noopener noreferrer"
            >
              MBTA V3 API
            </a>
          ) : city === "Portland" ? (
            <a
              href="https://developer.trimet.org/"
              target="_blank"
              rel="noopener noreferrer"
            >
              TriMet API
            </a>
          ) : city === "San Diego" ? (
            <a
              href="https://www.sdmts.com/business-center/app-developers"
              target="_blank"
              rel="noopener noreferrer"
            >
              MTS OneBusAway API
            </a>
          ) : city === "Toronto" ? (
            <a
              href="https://open.toronto.ca/"
              target="_blank"
              rel="noopener noreferrer"
            >
              TTC Open Data
            </a>
          ) : city === "Philadelphia" ? (
            <a
              href="https://www3.septa.org/developer/"
              target="_blank"
              rel="noopener noreferrer"
            >
              SEPTA API
            </a>
          ) : city === "Sacramento" ? (
            <a
              href="https://www.sacrt.com/transit-data-portal/"
              target="_blank"
              rel="noopener noreferrer"
            >
              SacRT GTFS-RT
            </a>
          ) : city === "Pittsburgh" ? (
            <a
              href="https://www.rideprt.org/inside-Pittsburgh-Regional-Transit/developer-resources/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Pittsburgh Regional Transit API
            </a>
          ) : city === "Dallas" ? (
            <a
              href="https://www.dart.org/about/dartdevelopers"
              target="_blank"
              rel="noopener noreferrer"
            >
              DART GTFS-RT
            </a>
          ) : city === "Minneapolis" ? (
            <a
              href="https://svc.metrotransit.org/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Metro Transit API
            </a>
          ) : city === "Denver" ? (
            <a
              href="https://www.rtd-denver.com/open-data"
              target="_blank"
              rel="noopener noreferrer"
            >
              RTD GTFS-RT
            </a>
          ) : city === "Salt Lake City" ? (
            <a
              href="https://developer.rideuta.com/"
              target="_blank"
              rel="noopener noreferrer"
            >
              UTA GTFS-RT
            </a>
          ) : city === "San Jose" ? (
            <a
              href="https://511.org/open-data/transit"
              target="_blank"
              rel="noopener noreferrer"
            >
              511.org
            </a>
          ) : (
            <span>Transit API</span>
          )}
          {city === "Portland" || city === "Boston" ? "" : " GTFS-realtime"}
        </p>
      </div>

      {/* Sacramento Warning Modal */}
      {showSacWarning && (
        <div className="modal-overlay" onClick={() => setShowSacWarning(false)}>
          <div
            className="modal-content sac-warning-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-icon">⚠️</div>
            <h2>Sacramento Data Quality Issue</h2>
            <p>
              <strong>
                SacRT does not provide live tracking for light rail.
              </strong>
            </p>
            <p>
              Their real-time API only includes buses. The data shown here is
              our best attempt to filter vehicles by proximity to track
              geometry, but it may include misidentified buses or missing
              trains.
            </p>
            <p className="modal-subtext">
              This limitation is on SacRT's end and cannot be fixed without them
              updating their data feed.
            </p>
            <button
              className="modal-close-btn"
              onClick={() => setShowSacWarning(false)}
            >
              I Understand
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
