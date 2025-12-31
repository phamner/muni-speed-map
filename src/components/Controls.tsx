import { useEffect, useState } from 'react';
import type { MuniLine } from '../types';
import { MUNI_LINES } from '../types';
import { getPositionCount, supabase } from '../lib/supabase';

// Official SFMTA colors from GTFS
const MUNI_COLORS: Record<MuniLine, string> = {
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
}

export function Controls({ selectedLines, setSelectedLines, vehicleCount, lastUpdate }: ControlsProps) {
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

      {/* Line Filter */}
      <div className="control-group">
        <div className="control-label-row">
          <label className="control-label">Filter Lines</label>
          <div className="line-actions">
            <button className="text-button" onClick={selectAllLines}>
              All
            </button>
            <span className="divider">|</span>
            <button className="text-button" onClick={clearAllLines}>
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
        <h3>How It Works</h3>
        <p>
          1. <strong>Collector:</strong> Run <code>npm run collect</code> to gather train data
        </p>
        <p>
          2. <strong>Map:</strong> Shows train positions from collected data (refreshes from Supabase)
        </p>
        <p>
          3. <strong>Speed analysis:</strong> Coming soon — speed heatmaps by segment
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
