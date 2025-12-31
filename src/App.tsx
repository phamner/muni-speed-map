import { useState } from 'react';
import { SpeedMap } from './components/SpeedMap';
import { Controls } from './components/Controls';
import { MUNI_LINES } from './types';
import type { MuniLine } from './types';
import './App.css';

function App() {
  // Start with all lines selected
  const [selectedLines, setSelectedLines] = useState<MuniLine[]>([...MUNI_LINES]);
  const [vehicleCount, setVehicleCount] = useState(0);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  return (
    <div className="app">
      <Controls
        selectedLines={selectedLines}
        setSelectedLines={setSelectedLines}
        vehicleCount={vehicleCount}
        lastUpdate={lastUpdate}
      />
      <SpeedMap 
        selectedLines={selectedLines}
        onVehicleUpdate={(count, time) => {
          setVehicleCount(count);
          setLastUpdate(time);
        }}
      />
    </div>
  );
}

export default App;
