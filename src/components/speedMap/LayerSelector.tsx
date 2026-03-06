import type { City } from "../../types";

interface LayerSelectorProps {
  city: City;
  showSatellite: boolean;
  showPopulationDensity: boolean;
  onSatelliteToggle?: (show: boolean) => void;
  onPopulationDensityToggle?: (show: boolean) => void;
}

export function LayerSelector({
  city,
  showSatellite,
  showPopulationDensity,
  onSatelliteToggle,
  onPopulationDensityToggle,
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
          className={`map-layer-tile ${showPopulationDensity ? "active" : ""}`}
          onClick={() => {
            onPopulationDensityToggle?.(!showPopulationDensity);
          }}
          title="Population density"
        >
          <div className="layer-preview population-preview" />
          <span className="layer-label">Density</span>
        </div>
      </div>
    </div>
  );
}
