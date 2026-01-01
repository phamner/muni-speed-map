import { useEffect, useState } from 'react';
import type { MuniLine } from '../types';
import { MUNI_LINES } from '../types';
import { getPositionCount, supabase } from '../lib/supabase';
import type { SpeedFilter, ViewMode } from '../App';

// Official SFMTA colors from GTFS
const MUNI_COLORS: Record<MuniLine, string> = {
  F: '#B49A36',
  J: '#A96614',
  K: '#437C93',
  L: '#942D83',
  M: '#008547',
  N: '#005B95',
  T: '#BF2B45',
};

interface ControlsProps {
  selectedLines: MuniLine[];
  setSelectedLines: (lines: MuniLine[]) => void;
  vehicleCount: number;
  lastUpdate: Date | null;
  speedFilter: SpeedFilter;
  setSpeedFilter: (filter: SpeedFilter) => void;
  showRouteLines: boolean;
  setShowRouteLines: (show: boolean) => void;
  showStops: boolean;
  setShowStops: (show: boolean) => void;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
}

export function Controls({ selectedLines, setSelectedLines, vehicleCount, lastUpdate, speedFilter, setSpeedFilter, showRouteLines, setShowRouteLines, showStops, setShowStops, viewMode, setViewMode }: ControlsProps) {
  const [dbPositionCount, setDbPositionCount] = useState<number>(0);
  const [dbConnected, setDbConnected] = useState<boolean>(false);

  useEffect(() => {
    // Check database connection and get position count
    async function checkDb() {
      if (!supabase) {
        setDbConnected(false);
        return;
      }
      
      try {
        const count = await getPositionCount();
        setDbPositionCount(count);
        setDbConnected(true);
      } catch {
        setDbConnected(false);
      }
    }
    
    checkDb();
    const interval = setInterval(checkDb, 30000); // Update every 30s
    return () => clearInterval(interval);
  }, []);

  const toggleLine = (line: MuniLine) => {
    if (selectedLines.includes(line)) {
      setSelectedLines(selectedLines.filter((l) => l !== line));
    } else {
      setSelectedLines([...selectedLines, line]);
    }
  };

  const selectAllLines = () => {
    setSelectedLines([...MUNI_LINES]);
  };

  const clearAllLines = () => {
    setSelectedLines([]);
  };

  return (
    <div className="controls-panel">
      <h1 className="app-title">Muni Speed Map</h1>
      <p className="app-subtitle">Real-time train tracking</p>

      {/* Data Status */}
      <div className="status-section">
        <div className="status-row">
          <span className="live-indicator"></span>
          <span>{vehicleCount.toLocaleString()} positions loaded</span>
        </div>
        {lastUpdate && (
          <div className="status-row muted">
            Latest: {lastUpdate.toLocaleTimeString()}
          </div>
        )}
      </div>

      {/* View Mode Toggle */}
      <div className="control-group">
        <div className="control-label">View Mode</div>
        <div className="view-mode-toggle">
          <button
            className={`view-mode-btn ${viewMode === 'raw' ? 'active' : ''}`}
            onClick={() => setViewMode('raw')}
          >
            Raw Data
          </button>
          <button
            className={`view-mode-btn ${viewMode === 'segments' ? 'active' : ''}`}
            onClick={() => setViewMode('segments')}
          >
            Segment Avg
          </button>
        </div>
      </div>

      {/* Line Filter */}
      <div className="control-group">
        <div className="control-label-row">
          <label className="control-label">Filter Lines</label>
          <div className="toggle-group">
            <button 
              className={`toggle-button ${selectedLines.length === MUNI_LINES.length ? 'active' : ''}`}
              onClick={selectAllLines}
            >
              All
            </button>
            <button 
              className={`toggle-button ${selectedLines.length === 0 ? 'active' : ''}`}
              onClick={clearAllLines}
            >
              None
            </button>
          </div>
        </div>
        <div className="line-buttons">
          {MUNI_LINES.map((line) => (
            <button
              key={line}
              className={`line-button ${selectedLines.includes(line) ? 'active' : 'inactive'}`}
              style={{
                '--line-color': MUNI_COLORS[line],
              } as React.CSSProperties}
              onClick={() => toggleLine(line)}
            >
              {line}
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
              onChange={(e) => setSpeedFilter({
                ...speedFilter,
                minSpeed: Math.min(Number(e.target.value), speedFilter.maxSpeed)
              })}
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
              onChange={(e) => setSpeedFilter({
                ...speedFilter,
                maxSpeed: Math.max(Number(e.target.value), speedFilter.minSpeed)
              })}
              className="speed-slider"
            />
          </div>
          <button
            className="reset-filter-btn"
            onClick={() => {
              setSpeedFilter({ minSpeed: 0, maxSpeed: 50, showNoData: true });
              setSelectedLines([...MUNI_LINES]);
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
            <span className="speed-dot" style={{ backgroundColor: '#ff3333' }}></span>
            <span>0–5 mph (very slow)</span>
          </div>
          <div className="speed-legend-item">
            <span className="speed-dot" style={{ backgroundColor: '#ff9933' }}></span>
            <span>5–10 mph (slow)</span>
          </div>
          <div className="speed-legend-item">
            <span className="speed-dot" style={{ backgroundColor: '#ffdd33' }}></span>
            <span>10–15 mph (moderate)</span>
          </div>
          <div className="speed-legend-item">
            <span className="speed-dot" style={{ backgroundColor: '#88ff33' }}></span>
            <span>15–25 mph (good)</span>
          </div>
          <div className="speed-legend-item">
            <span className="speed-dot" style={{ backgroundColor: '#33ffff' }}></span>
            <span>25+ mph (fast)</span>
          </div>
        </div>
      </div>

      {/* Database Status */}
      <div className="db-status">
        <div className="control-label">Database</div>
        {dbConnected ? (
          <div className="db-connected">
            <span className="db-dot connected"></span>
            <span>Connected</span>
            {dbPositionCount > 0 && (
              <span className="db-count">{dbPositionCount.toLocaleString()} positions</span>
            )}
          </div>
        ) : (
          <div className="db-disconnected">
            <span className="db-dot disconnected"></span>
            <span>Not connected</span>
          </div>
        )}
        {dbPositionCount === 0 && dbConnected && (
          <div className="db-hint">
            Run <code>npm run collect</code> to start collecting data
          </div>
        )}
      </div>

      {/* Info */}
      <div className="info-section">
        <h3>About This Map</h3>
        <p>
          Each dot shows a train's location and speed at a point in time.
        </p>
        <p>
          <strong style={{color: '#ff3333'}}>Red dots</strong> = slow areas where trains get delayed.
          <strong style={{color: '#33ffff'}}> Cyan dots</strong> = fast sections.
        </p>
        <p>
          Use the filters to find bottlenecks and identify where transit improvements would have the most impact.
        </p>
      </div>

      <div className="data-note">
        <p>
          Data from{' '}
          <a href="https://511.org/open-data" target="_blank" rel="noopener noreferrer">
            511.org
          </a>{' '}
          GTFS-realtime
        </p>
      </div>
    </div>
  );
}
