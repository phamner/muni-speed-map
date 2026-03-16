import { useState } from "react";
import { Users, BriefcaseBusiness, TramFront } from "lucide-react";
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
  const [mobileDensityOpen, setMobileDensityOpen] = useState(false);

  const handleDensitySelect = (mode: DensityMode) => {
    if (showPopulationDensity && densityMode === mode) {
      onPopulationDensityToggle?.(false);
    } else {
      onDensityModeChange?.(mode);
      onPopulationDensityToggle?.(true);
    }
    setMobileDensityOpen(false);
  };

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

        {/* Desktop: show all three density tiles directly */}
        <div
          className={`map-layer-tile density-tile-desktop ${showPopulationDensity && densityMode === "population" ? "active" : ""}`}
          onClick={() => handleDensitySelect("population")}
          title="Population density"
        >
          <div className="layer-preview population-preview">
            <Users className="layer-preview-icon" />
          </div>
          <span className="layer-label">Population</span>
        </div>

        <div
          className={`map-layer-tile density-tile-desktop ${showPopulationDensity && densityMode === "jobs" ? "active" : ""}`}
          onClick={() => handleDensitySelect("jobs")}
          title="Job density"
        >
          <div className="layer-preview jobs-preview">
            <BriefcaseBusiness className="layer-preview-icon" />
          </div>
          <span className="layer-label">Jobs</span>
        </div>

        <div
          className={`map-layer-tile density-tile-desktop ${showPopulationDensity && densityMode === "transit" ? "active" : ""}`}
          onClick={() => handleDensitySelect("transit")}
          title="Transit commute share"
        >
          <div className="layer-preview transit-preview">
            <TramFront className="layer-preview-icon" />
          </div>
          <span className="layer-label">Transit</span>
        </div>

        {/* Mobile: single "Density" tile that opens a sub-menu */}
        <div className="density-tile-mobile-wrapper">
          <div
            className={`map-layer-tile density-tile-mobile ${showPopulationDensity ? "active" : ""}`}
            onClick={() => setMobileDensityOpen(!mobileDensityOpen)}
            title="Density overlays"
          >
            <div
              className={`layer-preview ${
                showPopulationDensity
                  ? densityMode === "jobs"
                    ? "jobs-preview"
                    : densityMode === "transit"
                      ? "transit-preview"
                      : "population-preview"
                  : "census-neutral-preview"
              }`}
            >
              {showPopulationDensity && densityMode === "population" && (
                <Users className="layer-preview-icon" />
              )}
              {showPopulationDensity && densityMode === "jobs" && (
                <BriefcaseBusiness className="layer-preview-icon" />
              )}
              {showPopulationDensity && densityMode === "transit" && (
                <TramFront className="layer-preview-icon" />
              )}
            </div>
            <span className="layer-label">Census</span>
          </div>

          {mobileDensityOpen && (
            <div className="density-submenu">
              <div
                className={`density-submenu-item ${showPopulationDensity && densityMode === "population" ? "active" : ""}`}
                onClick={() => handleDensitySelect("population")}
              >
                <Users className="density-submenu-icon" />
                <span>Population</span>
              </div>
              <div
                className={`density-submenu-item ${showPopulationDensity && densityMode === "jobs" ? "active" : ""}`}
                onClick={() => handleDensitySelect("jobs")}
              >
                <BriefcaseBusiness className="density-submenu-icon" />
                <span>Jobs</span>
              </div>
              <div
                className={`density-submenu-item ${showPopulationDensity && densityMode === "transit" ? "active" : ""}`}
                onClick={() => handleDensitySelect("transit")}
              >
                <TramFront className="density-submenu-icon" />
                <span>Transit</span>
              </div>
              {showPopulationDensity && (
                <div
                  className="density-submenu-item density-submenu-off"
                  onClick={() => {
                    onPopulationDensityToggle?.(false);
                    setMobileDensityOpen(false);
                  }}
                >
                  <span>Off</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
