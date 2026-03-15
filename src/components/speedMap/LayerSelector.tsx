import type { DensityMode } from "../../App";

interface LayerSelectorProps {
  showSatellite: boolean;
  showPopulationDensity: boolean;
  densityMode: DensityMode;
  onSatelliteToggle?: (show: boolean) => void;
  onPopulationDensityToggle?: (show: boolean) => void;
  onDensityModeChange?: (mode: DensityMode) => void;
}

export function LayerSelector({
  showSatellite,
  showPopulationDensity,
  densityMode,
  onSatelliteToggle,
  onPopulationDensityToggle,
  onDensityModeChange,
}: LayerSelectorProps) {
  return (
    <div className="map-layer-selector">
      <div
        className={`map-layer-tile ${!showSatellite ? "active" : ""}`}
        onClick={() => {
          if (showSatellite) onSatelliteToggle?.(false);
        }}
        title="Dark map"
      >
        <div
          className="layer-preview"
          style={{
            backgroundImage:
              "url('https://a.basemaps.cartocdn.com/dark_all/12/656/1582@2x.png')",
          }}
        />
        <span className="layer-label">Map</span>
      </div>

      <div className="layer-tiles-panel">
        <div
          className={`map-layer-tile ${showSatellite ? "active" : ""}`}
          onClick={() => {
            onSatelliteToggle?.(!showSatellite);
          }}
          title="Satellite view"
        >
          <div
            className="layer-preview"
            style={{
              backgroundImage:
                "url('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/12/1582/656')",
            }}
          />
          <span className="layer-label">Satellite</span>
        </div>

        <div
          className={`map-layer-tile ${showPopulationDensity && densityMode === "population" ? "active" : ""}`}
          onClick={() => {
            if (showPopulationDensity && densityMode === "population") {
              onPopulationDensityToggle?.(false);
            } else {
              onDensityModeChange?.("population");
              onPopulationDensityToggle?.(true);
            }
          }}
          title="Population density"
        >
          <div className="layer-preview population-preview" />
          <span className="layer-label">Pop.</span>
        </div>

        <div
          className={`map-layer-tile ${showPopulationDensity && densityMode === "jobs" ? "active" : ""}`}
          onClick={() => {
            if (showPopulationDensity && densityMode === "jobs") {
              onPopulationDensityToggle?.(false);
            } else {
              onDensityModeChange?.("jobs");
              onPopulationDensityToggle?.(true);
            }
          }}
          title="Job density"
        >
          <div className="layer-preview jobs-preview" />
          <span className="layer-label">Jobs</span>
        </div>
      </div>
    </div>
  );
}
