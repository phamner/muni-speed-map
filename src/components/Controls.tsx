import { useState, useEffect } from "react";
import type {
  MuniLine,
  LAMetroLine,
  SeattleLinkLine,
  BostonGreenLine,
  PortlandMaxLine,
  SanDiegoTrolleyLine,
  TorontoStreetcarLine,
  PhillyTrolleyLine,
  SacramentoLightRailLine,
  City,
} from "../types";
import {
  LA_METRO_LINE_INFO,
  SEATTLE_LINK_LINE_INFO,
  BOSTON_GREEN_LINE_INFO,
  PORTLAND_MAX_LINE_INFO,
  SAN_DIEGO_TROLLEY_LINE_INFO,
  TORONTO_STREETCAR_LINE_INFO,
  PHILLY_TROLLEY_LINE_INFO,
  SACRAMENTO_LIGHT_RAIL_LINE_INFO,
  getLinesForCity,
} from "../types";
import type { SpeedFilter, ViewMode, LineStats } from "../App";

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
    return PORTLAND_MAX_LINE_INFO[line as PortlandMaxLine]?.color || "#666";
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
    return PORTLAND_MAX_LINE_INFO[line as PortlandMaxLine]?.letter || line;
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
  }
  return line;
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
    return PORTLAND_MAX_LINE_INFO[line as PortlandMaxLine]?.name;
  } else if (city === "San Diego") {
    return SAN_DIEGO_TROLLEY_LINE_INFO[line as SanDiegoTrolleyLine]?.name;
  } else if (city === "Toronto") {
    return TORONTO_STREETCAR_LINE_INFO[line as TorontoStreetcarLine]?.name;
  } else if (city === "Philadelphia") {
    return PHILLY_TROLLEY_LINE_INFO[line as PhillyTrolleyLine]?.name;
  } else if (city === "Sacramento") {
    return SACRAMENTO_LIGHT_RAIL_LINE_INFO[line as SacramentoLightRailLine]
      ?.name;
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
  showStops: boolean;
  setShowStops: (show: boolean) => void;
  showCrossings: boolean;
  setShowCrossings: (show: boolean) => void;
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
  showStops,
  setShowStops,
  showCrossings,
  setShowCrossings,
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
  };
  const cityLine = cityNames[city] || city;
  const systemLine = systemNames[city] || "Speed Map";

  return (
    <div className="controls-panel">
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
        <button
          className={`city-btn ${city === "San Diego" ? "active" : ""}`}
          onClick={() => setCity("San Diego")}
        >
          🌊 SD
        </button>
        {/* Row 2: Pacific NW + Central */}
        <button
          className={`city-btn ${city === "Seattle" ? "active" : ""}`}
          onClick={() => setCity("Seattle")}
        >
          ☕ Seattle
        </button>
        <button
          className={`city-btn ${city === "Portland" ? "active" : ""}`}
          onClick={() => setCity("Portland")}
        >
          🚲 PDX
        </button>
        <button
          className={`city-btn city-btn-warning ${
            city === "Sacramento" ? "active" : ""
          }`}
          onClick={() => setCity("Sacramento")}
          title="Data quality issues - SacRT doesn't tag light rail vehicles"
        >
          ⚠️ Sac
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
          className={`city-btn ${city === "Toronto" ? "active" : ""}`}
          onClick={() => setCity("Toronto")}
        >
          🍁 Toronto
        </button>
      </div>

      <div className="app-header">
        <span className="app-city">{cityLine}</span>
        <h1
          className={`app-title ${city === "Boston" ? "app-title-long" : ""}`}
        >
          {systemLine}
        </h1>
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
        <div className="control-label">View Mode</div>
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
              }`}
              style={
                {
                  "--line-color": getLineColor(line, city),
                } as React.CSSProperties
              }
              onClick={() => toggleLine(line)}
              title={getLineInfo(line, city)}
            >
              {getLineLabel(line, city)}
            </button>
          ))}
        </div>
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
          <label>
            <input
              type="checkbox"
              checked={showCrossings}
              onChange={(e) => setShowCrossings(e.target.checked)}
            />
            Show grade crossings
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
            <label>Max: {speedFilter.maxSpeed} mph</label>
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
              setShowStops(true);
            }}
          >
            Reset All Filters
          </button>
        </div>
      </div>

      {/* Speed Legend */}
      <div className="control-group">
        <div className="control-label">Speed Legend</div>
        <div className="speed-legend">
          <div className="speed-legend-item">
            <span
              className="speed-legend-dot"
              style={{ backgroundColor: "#ff3333" }}
            ></span>
            <span>&lt; 5 mph (very slow)</span>
          </div>
          <div className="speed-legend-item">
            <span
              className="speed-legend-dot"
              style={{ backgroundColor: "#ff9933" }}
            ></span>
            <span>5-10 mph (slow)</span>
          </div>
          <div className="speed-legend-item">
            <span
              className="speed-legend-dot"
              style={{ backgroundColor: "#ffdd33" }}
            ></span>
            <span>10-15 mph (moderate)</span>
          </div>
          <div className="speed-legend-item">
            <span
              className="speed-legend-dot"
              style={{ backgroundColor: "#88ff33" }}
            ></span>
            <span>15-25 mph (good)</span>
          </div>
          <div className="speed-legend-item">
            <span
              className="speed-legend-dot"
              style={{ backgroundColor: "#33ffff" }}
            ></span>
            <span>&gt; 25 mph (fast)</span>
          </div>
        </div>
      </div>

      {/* Line Statistics */}
      {lineStats.length > 0 && (
        <div className="control-group">
          <div className="control-label">Speed by Line</div>
          <div className="line-stats">
            {lineStats.map((stat) => (
              <div key={stat.line} className="line-stat-item">
                <span
                  className="line-stat-badge"
                  style={{ backgroundColor: getLineColor(stat.line, city) }}
                  title={getLineInfo(stat.line, city)}
                >
                  {getLineLabel(stat.line, city)}
                </span>
                <div className="line-stat-speeds">
                  <span className="line-stat-speed">
                    {stat.avgSpeed.toFixed(1)}
                  </span>
                  <span className="line-stat-label">avg</span>
                  <span className="line-stat-speed">
                    {stat.medianSpeed.toFixed(1)}
                  </span>
                  <span className="line-stat-label">median</span>
                </div>
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
          city === "Sacramento"
            ? "Speed is provided directly by the transit agency's API, giving accurate real-time readings."
            : "Speed is calculated from GPS positions, measuring distance traveled between consecutive readings (~90 seconds apart)."}
        </p>
        <p>
          <strong>Data freshness:</strong> This map displays the last 7 days of
          collected data.
        </p>
        {city === "SF" && (
          <>
            <p>
              <strong>Sunset Tunnel:</strong> The N Judah's Sunset Tunnel has no
              GPS signal, so trains appear to "jump" through it with no data
              points inside.
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
        {city !== "Toronto" && city !== "Philadelphia" && (
          <p className="data-attribution">
            Grade crossing data from{" "}
            <a
              href="https://www.openrailwaymap.org/"
              target="_blank"
              rel="noopener noreferrer"
            >
              OpenRailwayMap
            </a>{" "}
            (OpenStreetMap)
          </p>
        )}
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
          ) : (
            <span>Transit API</span>
          )}
          {city === "Portland" || city === "Boston"
            ? ""
            : " GTFS-realtime"}
        </p>
      </div>
      
      {/* Sacramento Warning Modal */}
      {showSacWarning && (
        <div className="modal-overlay" onClick={() => setShowSacWarning(false)}>
          <div className="modal-content sac-warning-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-icon">⚠️</div>
            <h2>Sacramento Data Quality Issue</h2>
            <p>
              <strong>SacRT does not provide live tracking for light rail.</strong>
            </p>
            <p>
              Their real-time API only includes buses. The data shown here is our 
              best attempt to filter vehicles by proximity to track geometry, but 
              it may include misidentified buses or missing trains.
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
