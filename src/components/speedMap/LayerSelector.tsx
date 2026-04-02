import { useState } from "react";
import { Users, BriefcaseBusiness, TramFront } from "lucide-react";
import type { BasemapMode, DensityMode } from "../../App";

const PREVIEW_TILE = {
  z: 12,
  x: 656,
  y: 1582,
} as const;

const MAP_PREVIEW_URL = `https://a.basemaps.cartocdn.com/dark_all/${PREVIEW_TILE.z}/${PREVIEW_TILE.x}/${PREVIEW_TILE.y}@2x.png`;
const SATELLITE_PREVIEW_URL = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${PREVIEW_TILE.z}/${PREVIEW_TILE.y}/${PREVIEW_TILE.x}`;
const TOPO_PREVIEW_URL = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/${PREVIEW_TILE.z}/${PREVIEW_TILE.y}/${PREVIEW_TILE.x}`;

interface LayerSelectorProps {
  basemapMode: BasemapMode;
  showPopulationDensity: boolean;
  densityMode: DensityMode;
  showTopo?: boolean;
  onBasemapModeChange?: (mode: BasemapMode) => void;
  onPopulationDensityToggle?: (show: boolean) => void;
  onDensityModeChange?: (mode: DensityMode) => void;
}

export function LayerSelector({
  basemapMode,
  showPopulationDensity,
  densityMode,
  showTopo = false,
  onBasemapModeChange,
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
        className={`map-layer-tile ${basemapMode === "map" ? "active" : ""}`}
        onClick={() => {
          if (basemapMode !== "map") onBasemapModeChange?.("map");
        }}
        title="Dark map"
      >
        <div
          className="layer-preview"
          style={{
            backgroundImage: `url('${MAP_PREVIEW_URL}')`,
          }}
        />
        <span className="layer-label">Map</span>
      </div>

      <div className="layer-tiles-panel">
        <div
          className={`map-layer-tile ${basemapMode === "satellite" ? "active" : ""}`}
          onClick={() => {
            onBasemapModeChange?.(
              basemapMode === "satellite" ? "map" : "satellite",
            );
          }}
          title="Satellite view"
        >
          <div
            className="layer-preview"
            style={{
              backgroundImage: `url('${SATELLITE_PREVIEW_URL}')`,
            }}
          />
          <span className="layer-label">Satellite</span>
        </div>

        {showTopo && (
          <div
            className={`map-layer-tile ${basemapMode === "topo" ? "active" : ""}`}
            onClick={() => {
              onBasemapModeChange?.(basemapMode === "topo" ? "map" : "topo");
            }}
            title="Topographic view"
          >
            <div
              className="layer-preview"
              style={{
                backgroundImage: `url('${TOPO_PREVIEW_URL}')`,
              }}
            />
            <span className="layer-label">Topographic</span>
          </div>
        )}

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
