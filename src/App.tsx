import { useState } from 'react';
import { SpeedMap } from './components/SpeedMap';
import { Controls } from './components/Controls';
import { MUNI_LINES } from './types';
import type { MuniLine } from './types';
import './App.css';

export interface SpeedFilter {
  minSpeed: number;
  maxSpeed: number;
  showNoData: boolean;
}

export type ViewMode = 'raw' | 'segments';

function App() {
  // Start with all lines selected
  const [selectedLines, setSelectedLines] = useState<MuniLine[]>([...MUNI_LINES]);
  const [vehicleCount, setVehicleCount] = useState(0);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [speedFilter, setSpeedFilter] = useState<SpeedFilter>({
    minSpeed: 0,
    maxSpeed: 50,
    showNoData: true,
  });
  const [showRouteLines, setShowRouteLines] = useState(true);
  const [showStops, setShowStops] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('raw');

  return (
    <div className="app">
      <Controls
        selectedLines={selectedLines}
        setSelectedLines={setSelectedLines}
        vehicleCount={vehicleCount}
        lastUpdate={lastUpdate}
        speedFilter={speedFilter}
        setSpeedFilter={setSpeedFilter}
        showRouteLines={showRouteLines}
        setShowRouteLines={setShowRouteLines}
        showStops={showStops}
        setShowStops={setShowStops}
        viewMode={viewMode}
        setViewMode={setViewMode}
      />
      <SpeedMap 
        selectedLines={selectedLines}
        speedFilter={speedFilter}
        showRouteLines={showRouteLines}
        showStops={showStops}
        viewMode={viewMode}
        onVehicleUpdate={(count, time) => {
          setVehicleCount(count);
          setLastUpdate(time);
        }}
      />
    </div>
  );
}

export default App;
